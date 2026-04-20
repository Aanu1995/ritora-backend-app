import { Injectable } from '@nestjs/common';
import {
  CatalogueSource,
  DataProvenance,
  LookupConfidence,
  LookupWarningCode,
} from '../shelf/shelf.types';
import { uniqueWarnings } from './catalogue-matching.utils';
import { CataloguePhotoStorageService } from './catalogue-photo-storage.service';
import type { UploadedCatalogueImage } from './catalogue-photo.types';
import {
  assertValidCataloguePhotoRequest,
  toCataloguePhotoExtractionInput,
} from './catalogue-photo.utils';
import { CatalogueSourceRuleService } from './catalogue-source-rule.service';
import { ResolvedLookupResponseDto } from './dto/resolved-lookup-response.dto';
import { OfficialPageProvider } from './official-page.provider';
import { OpenAiExtractorProvider } from './openai-extractor.provider';
import type {
  OfficialPageExtraction,
  ResolvedProductDraft,
} from './product-discovery.types';
import {
  fillMissingGuidance,
  fillMissingIdentity,
  fillMissingManufacturer,
  inferCategoryFromText,
  mergeIdentity,
} from './product-discovery.utils';

type ExtractionResult = NonNullable<
  Awaited<ReturnType<OpenAiExtractorProvider['extract']>>
>;

const TRUNCATED_INGREDIENT_PREFIXES = new Set([
  'ammonium',
  'calcium',
  'cocamidopropyl',
  'copper',
  'disodium',
  'glyceryl',
  'hydrolyzed',
  'magnesium',
  'peg',
  'potassium',
  'ppg',
  'sodium',
  'trisodium',
  'zinc',
]);

@Injectable()
export class CatalogueService {
  constructor(
    private readonly officialPageProvider: OfficialPageProvider,
    private readonly openAiExtractorProvider: OpenAiExtractorProvider,
    private readonly catalogueSourceRuleService: CatalogueSourceRuleService,
    private readonly cataloguePhotoStorageService: CataloguePhotoStorageService,
  ) {}

  async extractFromImages(
    images: UploadedCatalogueImage[],
    heroImageIndex: number,
    publicBaseUrl: string,
  ): Promise<ResolvedLookupResponseDto | null> {
    assertValidCataloguePhotoRequest(images, heroImageIndex);

    const photoExtraction =
      await this.openAiExtractorProvider.extractFromImages(
        toCataloguePhotoExtractionInput(images, heroImageIndex),
      );
    if (!photoExtraction) {
      return null;
    }

    const storedHeroImageUrl =
      await this.cataloguePhotoStorageService.saveHeroImage(
        images[heroImageIndex],
        publicBaseUrl,
      );
    let current = this.buildPhotoResolvedDraft(
      photoExtraction,
      storedHeroImageUrl,
    );
    const productUrl = current.manufacturer.productUrl;

    if (productUrl && this.needsOfficialPageCompletion(current)) {
      const extraction = await this.officialPageProvider.extract(productUrl);
      if (extraction) {
        current = await this.applyOfficialPageCompletionFromPhotos(
          current,
          extraction,
          productUrl,
        );
      }
    }

    current = this.finalizeResolved(current);
    await this.stripUntrustedUrlsFromResolved(current);

    return ResolvedLookupResponseDto.fromResolved(current);
  }

  private buildPhotoResolvedDraft(
    completion: ExtractionResult,
    storedHeroImageUrl: string,
  ): ResolvedProductDraft {
    const identity = mergeIdentity(completion.data.identity ?? {}, {
      imageUrls: [storedHeroImageUrl],
    });
    const manufacturer = {
      brand: completion.data.identity?.brand ?? undefined,
      ...(completion.data.manufacturer ?? {}),
    };

    if (
      !identity.category &&
      (identity.name || identity.description || manufacturer.brand)
    ) {
      identity.category = inferCategoryFromText(
        manufacturer.brand,
        identity.name,
        identity.description,
      );
    }

    if (identity.inciIngredients?.length && !identity.inciLastConfirmedAt) {
      identity.inciLastConfirmedAt = new Date().toISOString();
    }

    return {
      identity,
      guidance: completion.data.guidance ?? {},
      manufacturer,
      provenance: DataProvenance.PhotoLookup,
      source: CatalogueSource.UserPhotos,
      confidence: LookupConfidence.Low,
      reviewRequired: true,
      warnings: uniqueWarnings([
        LookupWarningCode.ReviewRequired,
        ...completion.warnings,
      ]),
      evidence: [...completion.evidence],
      cacheKey: {
        source: CatalogueSource.UserPhotos,
        id: null,
        url: null,
      },
      rawSource: {
        photoExtraction: completion.data,
      },
    };
  }

  private async applyOfficialPageCompletionFromPhotos(
    base: ResolvedProductDraft,
    extraction: OfficialPageExtraction,
    productUrl: string,
  ): Promise<ResolvedProductDraft> {
    let current: ResolvedProductDraft = {
      ...base,
      identity: this.fillMissingOfficialPageIdentity(
        base.identity,
        extraction.identity,
      ),
      manufacturer: fillMissingManufacturer(
        base.manufacturer,
        extraction.manufacturer,
      ),
      guidance: fillMissingGuidance(base.guidance, extraction.guidance),
      evidence: [...base.evidence, ...extraction.evidence],
      warnings: uniqueWarnings([
        ...base.warnings,
        ...(extraction.guidance.steps?.length ||
        extraction.guidance.cautions?.length
          ? [LookupWarningCode.GuidanceUnverified]
          : []),
        ...(extraction.identity.inciIngredients?.length
          ? [LookupWarningCode.IngredientsUnverified]
          : []),
      ]),
      cacheKey: {
        ...base.cacheKey,
        url: productUrl,
      },
      rawSource: {
        ...base.rawSource,
        officialPage: extraction.rawSource,
      },
    };
    const aiExtraction = await this.openAiExtractorProvider.extract(extraction);

    if (aiExtraction) {
      current = this.applyPhotoAwareAiCompletion(
        base,
        current,
        aiExtraction,
        'aiNormalizedOfficialPage',
      );
    }

    return current;
  }

  private applyPhotoAwareAiCompletion(
    base: ResolvedProductDraft,
    current: ResolvedProductDraft,
    completion: ExtractionResult,
    rawSourceKey: string,
  ): ResolvedProductDraft {
    const preferredIdentity = fillMissingIdentity(
      base.identity,
      completion.data.identity ?? {},
    );
    const preferredManufacturer = fillMissingManufacturer(
      base.manufacturer,
      completion.data.manufacturer ?? {},
    );
    const preferredGuidance = fillMissingGuidance(
      base.guidance,
      completion.data.guidance ?? {},
    );
    const identity = fillMissingIdentity(preferredIdentity, current.identity);
    const manufacturer = fillMissingManufacturer(
      preferredManufacturer,
      current.manufacturer,
    );
    const guidance = fillMissingGuidance(preferredGuidance, current.guidance);

    if (
      identity.inciIngredients?.length &&
      !identity.inciLastConfirmedAt &&
      completion.data.identity?.inciIngredients?.length
    ) {
      identity.inciLastConfirmedAt = new Date().toISOString();
    }

    return {
      ...current,
      identity,
      manufacturer,
      guidance,
      warnings: uniqueWarnings([...current.warnings, ...completion.warnings]),
      evidence: [...current.evidence, ...completion.evidence],
      rawSource: {
        ...current.rawSource,
        [rawSourceKey]: completion.data,
      },
    };
  }

  private fillMissingOfficialPageIdentity(
    base: ResolvedProductDraft['identity'],
    extraction: OfficialPageExtraction['identity'],
  ): ResolvedProductDraft['identity'] {
    const filledIdentity = fillMissingIdentity(base, extraction);
    const baseIngredients = base.inciIngredients ?? [];
    const extractedIngredients = extraction.inciIngredients ?? [];
    const preferredIngredients =
      baseIngredients.length > 0 ? baseIngredients : extractedIngredients;

    return {
      ...filledIdentity,
      brand: base.brand ?? extraction.brand ?? filledIdentity.brand,
      name: base.name ?? extraction.name ?? filledIdentity.name,
      category: base.category ?? extraction.category ?? filledIdentity.category,
      barcode: base.barcode ?? extraction.barcode ?? filledIdentity.barcode,
      imageUrls: base.imageUrls ?? filledIdentity.imageUrls,
      inciIngredients:
        preferredIngredients.length > 0 ? preferredIngredients : undefined,
      inciLastConfirmedAt:
        preferredIngredients.length > 0
          ? baseIngredients.length > 0
            ? (base.inciLastConfirmedAt ?? filledIdentity.inciLastConfirmedAt)
            : (extraction.inciLastConfirmedAt ??
              base.inciLastConfirmedAt ??
              filledIdentity.inciLastConfirmedAt)
          : filledIdentity.inciLastConfirmedAt,
    };
  }

  private needsOfficialPageCompletion(resolved: ResolvedProductDraft): boolean {
    return (
      !resolved.identity.description ||
      !resolved.identity.benefits?.length ||
      this.hasLikelyTruncatedIngredients(resolved.identity.inciIngredients) ||
      !resolved.identity.suitedFor?.length ||
      !resolved.guidance.cautions?.length ||
      !resolved.manufacturer.parentCompany ||
      !resolved.manufacturer.countryOfManufacture ||
      !resolved.manufacturer.supportEmail
    );
  }

  private hasLikelyTruncatedIngredients(
    ingredients: string[] | null | undefined,
  ): boolean {
    if (!ingredients?.length) {
      return false;
    }

    const lastIngredient = ingredients.at(-1)?.trim().toLowerCase() ?? '';
    if (!lastIngredient) {
      return false;
    }

    const normalized = lastIngredient.replace(/[.,;:\s/]+$/g, '');
    if (!normalized) {
      return false;
    }

    return TRUNCATED_INGREDIENT_PREFIXES.has(normalized);
  }

  private async stripUntrustedUrlsFromResolved(
    resolved: ResolvedProductDraft,
  ): Promise<void> {
    const productUrl = resolved.manufacturer.productUrl;
    if (productUrl) {
      const evaluation =
        await this.catalogueSourceRuleService.evaluateUrl(productUrl);
      if (evaluation.blocked) {
        resolved.manufacturer.productUrl = null;
        resolved.manufacturer.websiteUrl = null;
      }
    }

    if (!resolved.evidence.length) {
      return;
    }

    const filteredEvidence = [];
    for (const item of resolved.evidence) {
      if (!item.url) {
        filteredEvidence.push(item);
        continue;
      }

      const evaluation = await this.catalogueSourceRuleService.evaluateUrl(
        item.url,
      );
      if (!evaluation.blocked) {
        filteredEvidence.push(item);
      }
    }

    resolved.evidence = filteredEvidence;
  }

  private finalizeResolved(
    resolved: ResolvedProductDraft,
  ): ResolvedProductDraft {
    const hasGuidance =
      Boolean(resolved.guidance.steps?.length) ||
      Boolean(resolved.guidance.cautions?.length) ||
      resolved.guidance.waitMinutes !== undefined;
    const hasIngredients = Boolean(resolved.identity.inciIngredients?.length);
    const hasDescription = Boolean(resolved.identity.description);
    const hasBenefits = Boolean(resolved.identity.benefits?.length);
    const hasSuitedFor = Boolean(resolved.identity.suitedFor?.length);
    const hasManufacturerDetails =
      Boolean(resolved.manufacturer.supportEmail) ||
      Boolean(resolved.manufacturer.parentCompany) ||
      Boolean(resolved.manufacturer.countryOfOrigin) ||
      Boolean(resolved.manufacturer.countryOfManufacture);
    const hasPhotoIdentity =
      Boolean(resolved.identity.brand?.trim()) &&
      Boolean(resolved.identity.name?.trim());
    const hasRichData =
      hasDescription ||
      hasIngredients ||
      hasGuidance ||
      hasBenefits ||
      hasSuitedFor ||
      hasManufacturerDetails;
    const confidence =
      hasRichData || hasPhotoIdentity
        ? LookupConfidence.Medium
        : LookupConfidence.Low;
    const warnings = uniqueWarnings([
      ...resolved.warnings,
      ...(hasRichData ? [] : [LookupWarningCode.PartialData]),
    ]);

    return {
      ...resolved,
      confidence,
      reviewRequired: true,
      warnings,
    };
  }
}

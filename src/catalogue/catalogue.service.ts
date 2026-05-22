import { Injectable } from '@nestjs/common';
import {
  CatalogueSource,
  DataProvenance,
  LookupConfidence,
  LookupWarningCode,
} from '../shelf/shelf.types';
import { uniqueWarnings } from './catalogue-matching.utils';
import {
  finalizeResolved,
  needsDiscoveryCompletion,
  needsOfficialPageCompletion,
  refineResolvedCategory,
} from './catalogue-resolution.utils';
import { CataloguePhotoProcessorService } from './catalogue-photo-processor.service';
import type {
  CataloguePhotoExtractionInput,
  UploadedCatalogueImage,
} from './catalogue-photo.types';
import { assertValidCataloguePhotoRequest } from './catalogue-photo.utils';
import { CatalogueSourceRuleService } from './catalogue-source-rule.service';
import { ResolvedLookupResponseDto } from './dto/resolved-lookup-response.dto';
import { OfficialPageProvider } from './official-page.provider';
import { OpenAiExtractorProvider } from './openai-extractor.provider';
import type {
  OfficialPageExtraction,
  ResolvedProductDraft,
} from './product-discovery.types';
import {
  sanitizeBenefitList,
  sanitizeSuitedForList,
} from './product-claim-sanitizers';
import {
  fillMissingGuidance,
  fillMissingIdentity,
  fillMissingManufacturer,
  inferCategoryFromText,
  mergeIdentity,
  refineCategoryFromText,
} from './product-discovery.utils';

type ExtractionResult = NonNullable<
  Awaited<ReturnType<OpenAiExtractorProvider['extract']>>
>;

@Injectable()
export class CatalogueService {
  constructor(
    private readonly officialPageProvider: OfficialPageProvider,
    private readonly openAiExtractorProvider: OpenAiExtractorProvider,
    private readonly catalogueSourceRuleService: CatalogueSourceRuleService,
    private readonly cataloguePhotoProcessorService: CataloguePhotoProcessorService,
  ) {}

  async extractFromImages(
    images: UploadedCatalogueImage[],
    heroImageIndex: number,
  ): Promise<ResolvedLookupResponseDto | null> {
    assertValidCataloguePhotoRequest(images, heroImageIndex);
    const processedPhotoBatch =
      await this.cataloguePhotoProcessorService.prepareForExtraction(
        images,
        heroImageIndex,
      );

    const photoExtraction = await this.extractProductFromPreparedPhotos(
      processedPhotoBatch.extractionInput,
    );
    if (!photoExtraction) {
      return null;
    }

    let current = this.buildPhotoResolvedDraft(photoExtraction);
    current = refineResolvedCategory(current);
    const productUrl = current.manufacturer.productUrl;

    if (productUrl && needsOfficialPageCompletion(current)) {
      const extraction = await this.officialPageProvider.extract(productUrl);
      if (extraction) {
        current = await this.applyOfficialPageCompletionFromPhotos(
          current,
          extraction,
          productUrl,
        );
      }
    }

    current = refineResolvedCategory(current);
    if (needsDiscoveryCompletion(current)) {
      const completion =
        await this.openAiExtractorProvider.completeMissingFields(current);
      if (completion) {
        current = this.applyPhotoAwareAiCompletion(
          current,
          current,
          completion,
          'webDiscoveryCompletion',
        );
        current = refineResolvedCategory(current);
      }
    }

    current = finalizeResolved(current);
    await this.stripUntrustedUrlsFromResolved(current);

    return ResolvedLookupResponseDto.fromResolved(current);
  }

  private async extractProductFromPreparedPhotos(
    extractionInput: CataloguePhotoExtractionInput,
  ): Promise<ExtractionResult | null> {
    return this.openAiExtractorProvider.extractFromImages(extractionInput);
  }

  private buildPhotoResolvedDraft(
    completion: ExtractionResult,
  ): ResolvedProductDraft {
    const identity = mergeIdentity(
      {
        ...(completion.data.identity ?? {}),
        imageUrls: undefined,
      },
      {},
    );
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

    identity.category = refineCategoryFromText(
      identity.category,
      manufacturer.brand,
      identity.brand,
      identity.name,
      identity.description,
      identity.benefits,
      identity.suitedFor,
    );

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
        extraction.guidance.cautions?.length ||
        extraction.guidance.applicationMethod ||
        extraction.guidance.quantity
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
    const officialIdentity = {
      ...extraction,
      benefits: sanitizeBenefitList(extraction.benefits),
      suitedFor: sanitizeSuitedForList(extraction.suitedFor),
    };
    const filledIdentity = fillMissingIdentity(base, officialIdentity);
    const baseIngredients = base.inciIngredients ?? [];
    const extractedIngredients = officialIdentity.inciIngredients ?? [];
    const preferredIngredients =
      baseIngredients.length > 0 ? baseIngredients : extractedIngredients;

    return {
      ...filledIdentity,
      brand: base.brand ?? officialIdentity.brand ?? filledIdentity.brand,
      name: base.name ?? officialIdentity.name ?? filledIdentity.name,
      category:
        base.category ?? officialIdentity.category ?? filledIdentity.category,
      barcode:
        base.barcode ?? officialIdentity.barcode ?? filledIdentity.barcode,
      imageUrls: base.imageUrls ?? filledIdentity.imageUrls,
      inciIngredients:
        preferredIngredients.length > 0 ? preferredIngredients : undefined,
      inciLastConfirmedAt:
        preferredIngredients.length > 0
          ? baseIngredients.length > 0
            ? (base.inciLastConfirmedAt ?? filledIdentity.inciLastConfirmedAt)
            : (officialIdentity.inciLastConfirmedAt ??
              base.inciLastConfirmedAt ??
              filledIdentity.inciLastConfirmedAt)
          : filledIdentity.inciLastConfirmedAt,
    };
  }

  private async stripUntrustedUrlsFromResolved(
    resolved: ResolvedProductDraft,
  ): Promise<void> {
    const productUrl = resolved.manufacturer.productUrl;
    const productUrlEvaluation = productUrl
      ? this.catalogueSourceRuleService.evaluateUrl(productUrl)
      : Promise.resolve(null);
    const filteredEvidence = Promise.all(
      resolved.evidence.map(async (item) => {
        if (!item.url) {
          return item;
        }

        const evaluation = await this.catalogueSourceRuleService.evaluateUrl(
          item.url,
        );
        return evaluation.blocked ? null : item;
      }),
    );
    const [productEvaluation, evidence] = await Promise.all([
      productUrlEvaluation,
      filteredEvidence,
    ]);

    if (productEvaluation?.blocked) {
      resolved.manufacturer.productUrl = null;
      resolved.manufacturer.websiteUrl = null;
    }

    resolved.evidence = evidence.filter(
      (item): item is ResolvedProductDraft['evidence'][number] => item !== null,
    );
  }
}

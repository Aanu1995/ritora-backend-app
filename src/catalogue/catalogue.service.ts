import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { assertSafeExternalHttpUrl } from '../common/utils/url-security';
import {
  normalizeApplicationGuidanceSnapshot,
  normalizeCatalogueIdentitySnapshot,
  normalizeManufacturerInfoSnapshot,
} from '../shelf/shelf-payload-normalizer';
import {
  CatalogueSource,
  DataProvenance,
  LookupConfidence,
  LookupWarningCode,
} from '../shelf/shelf.types';
import { ResolveCandidateDto } from './dto/resolve-candidate.dto';
import { ResolvedLookupResponseDto } from './dto/resolved-lookup-response.dto';
import {
  analyzeTextFit,
  tokenizeNormalizedText,
  uniqueWarnings,
} from './catalogue-matching.utils';
import { CataloguePhotoStorageService } from './catalogue-photo-storage.service';
import { CatalogueSourceRuleService } from './catalogue-source-rule.service';
import type { UploadedCatalogueImage } from './catalogue-photo.types';
import { CatalogueProduct } from './entities/catalogue-product.entity';
import { OfficialPageProvider } from './official-page.provider';
import { OpenAiExtractorProvider } from './openai-extractor.provider';
import { OpenBeautyFactsProvider } from './open-beauty-facts.provider';
import { ProductPageDiscoveryProvider } from './product-page-discovery.provider';
import type {
  OfficialPageExtraction,
  ResolvedProductDraft,
} from './product-discovery.types';
import {
  fillMissingGuidance,
  fillMissingIdentity,
  fillMissingManufacturer,
  inferCategoryFromText,
  mergeGuidance,
  mergeIdentity,
  mergeManufacturer,
  normalizeBarcode,
  normalizeSearchValue,
  normalizeUrl,
} from './product-discovery.utils';
type AiCompletionResult = NonNullable<
  Awaited<ReturnType<OpenAiExtractorProvider['completeMissingFields']>>
>;
type EnrichmentStrategy = {
  allowKnownProductUrlEnrichment: boolean;
  allowOfficialPageDiscovery: boolean;
  allowAiNormalization: boolean;
  allowAiCompletion: boolean;
  allowAiBarcodeFallback: boolean;
};

const FULL_LOOKUP_ENRICHMENT: EnrichmentStrategy = {
  allowKnownProductUrlEnrichment: true,
  allowOfficialPageDiscovery: true,
  allowAiNormalization: true,
  allowAiCompletion: true,
  allowAiBarcodeFallback: true,
};
const BARCODE_SCAN_ENRICHMENT: EnrichmentStrategy = {
  allowKnownProductUrlEnrichment: false,
  allowOfficialPageDiscovery: false,
  allowAiNormalization: false,
  allowAiCompletion: false,
  allowAiBarcodeFallback: false,
};
const PHOTO_LOOKUP_ENRICHMENT: EnrichmentStrategy = {
  allowKnownProductUrlEnrichment: true,
  allowOfficialPageDiscovery: false,
  allowAiNormalization: true,
  allowAiCompletion: false,
  allowAiBarcodeFallback: false,
};
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
const SUPPORTED_UPLOAD_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

@Injectable()
export class CatalogueService {
  constructor(
    @InjectRepository(CatalogueProduct)
    private readonly catalogueRepository: Repository<CatalogueProduct>,
    private readonly openBeautyFactsProvider: OpenBeautyFactsProvider,
    private readonly officialPageProvider: OfficialPageProvider,
    private readonly openAiExtractorProvider: OpenAiExtractorProvider,
    private readonly productPageDiscoveryProvider: ProductPageDiscoveryProvider,
    private readonly catalogueSourceRuleService: CatalogueSourceRuleService,
    private readonly cataloguePhotoStorageService: CataloguePhotoStorageService,
  ) {}

  async extractFromImages(
    images: UploadedCatalogueImage[],
    heroImageIndex: number,
    publicBaseUrl: string,
  ): Promise<ResolvedLookupResponseDto | null> {
    this.assertUploadedImages(images);
    this.assertHeroImageIndex(heroImageIndex, images.length);

    const photoExtraction = await this.openAiExtractorProvider.extractFromImages(
      {
        images: images.map((image) => ({
          buffer: image.buffer,
          mimetype: image.mimetype,
        })),
        heroImageIndex,
      },
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

    if (this.needsDiscoveryCompletion(current)) {
      const discoveredOfficialPage = await this.findOfficialPageExtraction(
        current,
        PHOTO_LOOKUP_ENRICHMENT,
      );

      if (discoveredOfficialPage) {
        current = await this.applyOfficialPageCompletionFromPhotos(
          current,
          discoveredOfficialPage.extraction,
          discoveredOfficialPage.url,
          PHOTO_LOOKUP_ENRICHMENT,
        );
      }
    }

    current = this.finalizeResolved(current);
    await this.stripUntrustedUrlsFromResolved(current);

    return ResolvedLookupResponseDto.fromResolved(current);
  }

  async resolveBarcode(
    barcode: string,
    strategy: EnrichmentStrategy = FULL_LOOKUP_ENRICHMENT,
  ): Promise<ResolvedLookupResponseDto | null> {
    const normalizedBarcode = normalizeBarcode(barcode);
    if (!normalizedBarcode) {
      return null;
    }

    if (normalizedBarcode.length > 64) {
      throw new BadRequestException('Invalid barcode');
    }

    const cached = await this.findByBarcode(normalizedBarcode);
    if (cached) {
      if (cached.source_type === CatalogueSource.OfficialPage) {
        const openBeautyFactsResult =
          await this.openBeautyFactsProvider.resolveBarcode(
            normalizedBarcode,
            DataProvenance.BarcodeLookup,
          );
        if (openBeautyFactsResult) {
          const resolved = await this.enrichExternalResult(
            openBeautyFactsResult,
            strategy,
          );
          await this.upsertDiscoveredProduct(resolved);

          return ResolvedLookupResponseDto.fromResolved(resolved);
        }
      }

      return this.resolveCachedProduct(
        cached,
        DataProvenance.BarcodeLookup,
        strategy,
      );
    }

    const openBeautyFactsResult =
      await this.openBeautyFactsProvider.resolveBarcode(
        normalizedBarcode,
        DataProvenance.BarcodeLookup,
      );
    if (!openBeautyFactsResult) {
      if (!strategy.allowAiBarcodeFallback) {
        return null;
      }

      const aiFallback = await this.buildAiBarcodeFallback(normalizedBarcode);
      if (!aiFallback) {
        return null;
      }

      const resolved = await this.enrichExternalResult(aiFallback, strategy);
      await this.upsertDiscoveredProduct(resolved);

      return ResolvedLookupResponseDto.fromResolved(resolved);
    }

    const resolved = await this.enrichExternalResult(
      openBeautyFactsResult,
      strategy,
    );
    await this.upsertDiscoveredProduct(resolved);

    return ResolvedLookupResponseDto.fromResolved(resolved);
  }

  async resolveBarcodeForScan(
    barcode: string,
  ): Promise<ResolvedLookupResponseDto | null> {
    return this.resolveBarcode(barcode, BARCODE_SCAN_ENRICHMENT);
  }

  async resolveCandidate(
    dto: ResolveCandidateDto,
  ): Promise<ResolvedLookupResponseDto | null> {
    if (dto.source === CatalogueSource.RitoraCatalogue) {
      const cached = await this.catalogueRepository.findOne({
        where: { id: dto.id },
      });

      if (!cached) {
        throw new NotFoundException('Catalogue product not found');
      }

      return this.resolveCachedProduct(
        cached,
        DataProvenance.Catalogue,
        FULL_LOOKUP_ENRICHMENT,
      );
    }

    if (dto.source === CatalogueSource.OfficialPage) {
      return dto.url ? this.resolveUrl(dto.url) : null;
    }

    const cached = await this.findCachedExternalCandidate(dto.source, dto.id);
    if (cached) {
      return this.resolveCachedProduct(
        cached,
        DataProvenance.Catalogue,
        FULL_LOOKUP_ENRICHMENT,
      );
    }

    if (dto.source !== CatalogueSource.OpenBeautyFacts) {
      throw new BadRequestException('Unsupported candidate source');
    }

    const openBeautyFactsResult =
      await this.openBeautyFactsProvider.resolveBarcode(
        dto.id,
        DataProvenance.Catalogue,
      );
    if (!openBeautyFactsResult) {
      return null;
    }

    const resolved = await this.enrichExternalResult(
      openBeautyFactsResult,
      FULL_LOOKUP_ENRICHMENT,
    );
    await this.upsertDiscoveredProduct(resolved);

    return ResolvedLookupResponseDto.fromResolved(resolved);
  }

  async resolveUrl(url: string): Promise<ResolvedLookupResponseDto | null> {
    assertSafeExternalHttpUrl(url, 'Resolve URL');

    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl) {
      return null;
    }

    const cached = await this.findByProductUrl(normalizedUrl);
    if (cached) {
      return this.resolveCachedProduct(
        cached,
        DataProvenance.UrlFetch,
        FULL_LOOKUP_ENRICHMENT,
      );
    }

    const extraction = await this.officialPageProvider.extract(normalizedUrl);
    if (!extraction) {
      return null;
    }

    const resolved = await this.buildOfficialPageResult(
      extraction,
      normalizedUrl,
      DataProvenance.UrlFetch,
    );
    await this.upsertDiscoveredProduct(resolved);

    return ResolvedLookupResponseDto.fromResolved(resolved);
  }

  private async enrichExternalResult(
    base: ResolvedProductDraft,
    strategy: EnrichmentStrategy,
  ): Promise<ResolvedProductDraft> {
    let current = base;
    const discoveredOfficialPage = await this.findOfficialPageExtraction(
      current,
      strategy,
    );

    if (discoveredOfficialPage) {
      current = await this.applyOfficialPageExtraction(
        current,
        discoveredOfficialPage.extraction,
        discoveredOfficialPage.url,
        strategy,
      );
    }

    if (strategy.allowAiCompletion && this.needsDiscoveryCompletion(current)) {
      current = await this.completeMissingFields(
        current,
        current.manufacturer.productUrl
          ? 'aiDiscoveryPostOfficial'
          : 'aiDiscovery',
      );
    }

    return this.finalizeResolved(current);
  }

  private async buildOfficialPageResult(
    extraction: OfficialPageExtraction,
    url: string,
    provenance: DataProvenance,
    strategy: EnrichmentStrategy = FULL_LOOKUP_ENRICHMENT,
  ): Promise<ResolvedProductDraft> {
    let current: ResolvedProductDraft = {
      identity: extraction.identity,
      guidance: extraction.guidance,
      manufacturer: extraction.manufacturer,
      provenance,
      source: CatalogueSource.OfficialPage,
      confidence: LookupConfidence.High,
      reviewRequired: true,
      warnings: uniqueWarnings([
        LookupWarningCode.ReviewRequired,
        ...(extraction.guidance.steps?.length ||
        extraction.guidance.cautions?.length
          ? [LookupWarningCode.GuidanceUnverified]
          : []),
        ...(extraction.identity.inciIngredients?.length
          ? [LookupWarningCode.IngredientsUnverified]
          : []),
      ]),
      evidence: extraction.evidence,
      cacheKey: {
        source: CatalogueSource.OfficialPage,
        id: extraction.identity.barcode ?? null,
        url,
      },
      rawSource: {
        officialPage: extraction.rawSource,
      },
    };
    const aiExtraction = strategy.allowAiNormalization
      ? await this.openAiExtractorProvider.extract(extraction)
      : null;

    if (aiExtraction) {
      current = this.applyAiNormalizedOfficialPageExtraction(
        current,
        aiExtraction,
        'aiNormalizedOfficialPage',
      );
    }

    if (strategy.allowAiCompletion && this.needsDiscoveryCompletion(current)) {
      current = await this.completeMissingFields(
        current,
        'aiDiscoveryPostOfficial',
      );
    }

    return this.finalizeResolved(current);
  }

  private buildPhotoResolvedDraft(
    completion: AiCompletionResult,
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
      evidence: [],
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

  private async buildAiBarcodeFallback(
    barcode: string,
  ): Promise<ResolvedProductDraft | null> {
    const seed: ResolvedProductDraft = {
      identity: {
        barcode,
      },
      guidance: {},
      manufacturer: {},
      provenance: DataProvenance.BarcodeLookup,
      source: CatalogueSource.OfficialPage,
      confidence: LookupConfidence.Low,
      reviewRequired: true,
      warnings: [LookupWarningCode.ReviewRequired],
      evidence: [],
      cacheKey: {
        source: CatalogueSource.OfficialPage,
        id: barcode,
        url: null,
      },
      rawSource: {
        barcode,
      },
    };
    const completion =
      await this.openAiExtractorProvider.completeMissingFields(seed);

    if (!completion) {
      return null;
    }

    const brand = completion.data.identity?.brand?.trim();
    const name = completion.data.identity?.name?.trim();
    if (!brand || !name) {
      return null;
    }

    return this.applyAiCompletion(seed, completion, 'aiDiscoveryByBarcode');
  }

  private async applyOfficialPageEnrichment(
    base: ResolvedProductDraft,
    productUrl: string,
    strategy: EnrichmentStrategy,
  ): Promise<ResolvedProductDraft> {
    const extraction = await this.officialPageProvider.extract(productUrl);
    if (!extraction) {
      return base;
    }

    return this.applyOfficialPageExtraction(
      base,
      extraction,
      productUrl,
      strategy,
    );
  }

  private async applyOfficialPageExtraction(
    base: ResolvedProductDraft,
    extraction: OfficialPageExtraction,
    productUrl: string,
    strategy: EnrichmentStrategy,
  ): Promise<ResolvedProductDraft> {
    const mergedIdentity = this.mergeOfficialPageIdentity(
      base.identity,
      extraction.identity,
    );
    let current: ResolvedProductDraft = {
      ...base,
      identity: mergedIdentity,
      manufacturer: mergeManufacturer(
        base.manufacturer,
        extraction.manufacturer,
      ),
      guidance: mergeGuidance(base.guidance, extraction.guidance),
      source: base.source,
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
        source: base.cacheKey.source,
        id:
          base.cacheKey.id ??
          base.identity.barcode ??
          extraction.identity.barcode ??
          null,
        url: productUrl,
      },
      rawSource: {
        ...base.rawSource,
        officialPage: extraction.rawSource,
      },
    };
    const aiExtraction = strategy.allowAiNormalization
      ? await this.openAiExtractorProvider.extract(extraction)
      : null;

    if (aiExtraction) {
      current = this.applyAiNormalizedOfficialPageExtraction(
        current,
        aiExtraction,
        'aiNormalizedOfficialPage',
      );
    }

    return current;
  }

  private async applyOfficialPageCompletionFromPhotos(
    base: ResolvedProductDraft,
    extraction: OfficialPageExtraction,
    productUrl: string,
    strategy: EnrichmentStrategy,
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
        source: base.cacheKey.source,
        id: base.cacheKey.id,
        url: productUrl,
      },
      rawSource: {
        ...base.rawSource,
        officialPage: extraction.rawSource,
      },
    };
    const aiExtraction = strategy.allowAiNormalization
      ? await this.openAiExtractorProvider.extract(extraction)
      : null;

    if (aiExtraction) {
      current = this.applyAiCompletion(
        current,
        aiExtraction,
        'aiNormalizedOfficialPage',
      );
    }

    return current;
  }

  private async findOfficialPageExtraction(
    base: ResolvedProductDraft,
    strategy: EnrichmentStrategy,
  ): Promise<{ url: string; extraction: OfficialPageExtraction } | null> {
    const knownProductUrl = base.manufacturer.productUrl;
    if (strategy.allowKnownProductUrlEnrichment && knownProductUrl) {
      const extraction =
        await this.officialPageProvider.extract(knownProductUrl);
      if (!extraction) {
        return null;
      }

      return {
        url: knownProductUrl,
        extraction,
      };
    }

    if (!strategy.allowOfficialPageDiscovery) {
      return null;
    }

    const candidates = await this.productPageDiscoveryProvider.discover(base);
    for (const candidate of candidates) {
      const extraction = await this.officialPageProvider.extract(candidate.url);
      if (!extraction) {
        continue;
      }

      if (!this.matchesOfficialPage(base, extraction)) {
        continue;
      }

      return {
        url: candidate.url,
        extraction,
      };
    }

    return null;
  }

  private matchesOfficialPage(
    base: ResolvedProductDraft,
    extraction: OfficialPageExtraction,
  ): boolean {
    const baseBrand = normalizeSearchValue(base.identity.brand ?? '');
    const extractedBrand = normalizeSearchValue(
      extraction.identity.brand ?? '',
    );
    const baseName = normalizeSearchValue(base.identity.name ?? '');
    const extractedName = normalizeSearchValue(extraction.identity.name ?? '');
    const baseBarcode = normalizeBarcode(base.identity.barcode ?? '');
    const extractedBarcode = normalizeBarcode(
      extraction.identity.barcode ?? '',
    );

    if (baseBarcode && extractedBarcode && baseBarcode === extractedBarcode) {
      return true;
    }

    if (baseBarcode && extractedBarcode && baseBarcode !== extractedBarcode) {
      return false;
    }

    if (
      baseBrand &&
      extractedBrand &&
      !baseBrand.includes(extractedBrand) &&
      !extractedBrand.includes(baseBrand)
    ) {
      return false;
    }

    if (!baseName || !extractedName) {
      return Boolean(extractedBrand);
    }

    const textFit = analyzeTextFit(baseName, extractedName);

    if (textFit.candidateLooksLikeBundle && !textFit.queryHasBundleIntent) {
      return false;
    }

    if (
      textFit.hasUnexpectedProductType &&
      !textFit.queryHasBundleIntent &&
      textFit.tokenCoverage < 1
    ) {
      return false;
    }

    if (baseName === extractedName) {
      return true;
    }

    const baseTokens = tokenizeNormalizedText(baseName);
    const extractedTokens = new Set(tokenizeNormalizedText(extractedName));
    const matchedTokenCount = baseTokens.filter((token) =>
      extractedTokens.has(token),
    ).length;
    const tokenCoverage =
      baseTokens.length === 0 ? 0 : matchedTokenCount / baseTokens.length;

    return tokenCoverage >= 0.6;
  }

  private async completeMissingFields(
    base: ResolvedProductDraft,
    rawSourceKey: string,
  ): Promise<ResolvedProductDraft> {
    if (!this.needsDiscoveryCompletion(base)) {
      return base;
    }

    const completion =
      await this.openAiExtractorProvider.completeMissingFields(base);
    if (!completion) {
      return base;
    }

    return this.applyAiCompletion(base, completion, rawSourceKey);
  }

  private applyAiCompletion(
    base: ResolvedProductDraft,
    completion: AiCompletionResult,
    rawSourceKey: string,
  ): ResolvedProductDraft {
    const identity = fillMissingIdentity(
      base.identity,
      completion.data.identity ?? {},
    );
    const manufacturer = fillMissingManufacturer(
      base.manufacturer,
      completion.data.manufacturer ?? {},
    );
    const guidance = fillMissingGuidance(
      base.guidance,
      completion.data.guidance ?? {},
    );

    return {
      ...base,
      identity,
      manufacturer,
      guidance,
      warnings: uniqueWarnings([...base.warnings, ...completion.warnings]),
      evidence: [...base.evidence, ...completion.evidence],
      cacheKey: {
        source: manufacturer.productUrl
          ? CatalogueSource.OfficialPage
          : base.cacheKey.source,
        id: base.cacheKey.id,
        url: manufacturer.productUrl ?? base.cacheKey.url,
      },
      rawSource: {
        ...base.rawSource,
        [rawSourceKey]: completion.data,
      },
    };
  }

  private applyAiNormalizedOfficialPageExtraction(
    base: ResolvedProductDraft,
    completion: AiCompletionResult,
    rawSourceKey: string,
  ): ResolvedProductDraft {
    const identity = mergeIdentity(base.identity, completion.data.identity ?? {});
    const manufacturer = mergeManufacturer(
      base.manufacturer,
      completion.data.manufacturer ?? {},
    );
    const guidance = mergeGuidance(base.guidance, completion.data.guidance ?? {});

    if (
      completion.data.identity?.inciIngredients?.length &&
      !identity.inciLastConfirmedAt
    ) {
      identity.inciLastConfirmedAt = new Date().toISOString();
    }

    return {
      ...base,
      identity,
      manufacturer,
      guidance,
      warnings: uniqueWarnings([...base.warnings, ...completion.warnings]),
      evidence: [...base.evidence, ...completion.evidence],
      cacheKey: {
        source: manufacturer.productUrl
          ? CatalogueSource.OfficialPage
          : base.cacheKey.source,
        id: base.cacheKey.id,
        url: manufacturer.productUrl ?? base.cacheKey.url,
      },
      rawSource: {
        ...base.rawSource,
        [rawSourceKey]: completion.data,
      },
    };
  }

  private needsDiscoveryCompletion(resolved: ResolvedProductDraft): boolean {
    return (
      !resolved.identity.brand ||
      !resolved.identity.name ||
      !resolved.identity.description ||
      !resolved.identity.benefits?.length ||
      this.hasLikelyTruncatedIngredients(resolved.identity.inciIngredients) ||
      !resolved.identity.suitedFor?.length ||
      !resolved.guidance.cautions?.length ||
      !resolved.manufacturer.parentCompany ||
      !resolved.manufacturer.countryOfManufacture ||
      !resolved.manufacturer.supportEmail ||
      !resolved.manufacturer.productUrl
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
    const hasOfficialSource = resolved.source === CatalogueSource.OfficialPage;
    const hasPhotoIdentity =
      resolved.source === CatalogueSource.UserPhotos &&
      Boolean(resolved.identity.brand?.trim()) &&
      Boolean(resolved.identity.name?.trim());
    const hasRichData =
      hasDescription ||
      hasIngredients ||
      hasGuidance ||
      hasBenefits ||
      hasSuitedFor ||
      hasManufacturerDetails;
    const confidence = hasOfficialSource
      ? hasRichData
        ? LookupConfidence.High
        : LookupConfidence.Medium
      : hasRichData || hasPhotoIdentity
        ? LookupConfidence.Medium
        : LookupConfidence.Low;
    const warnings = uniqueWarnings([
      ...resolved.warnings,
      ...(hasRichData ? [] : [LookupWarningCode.PartialData]),
    ]);
    const hasAiNormalizedData = warnings.includes(
      LookupWarningCode.AiNormalized,
    );
    const explicitlyNeedsReview = warnings.includes(
      LookupWarningCode.ReviewRequired,
    );

    return {
      ...resolved,
      confidence,
      reviewRequired:
        resolved.source !== CatalogueSource.RitoraCatalogue &&
        (explicitlyNeedsReview ||
          confidence !== LookupConfidence.High ||
          hasAiNormalizedData),
      warnings,
    };
  }

  private async upsertDiscoveredProduct(
    resolved: ResolvedProductDraft,
  ): Promise<CatalogueProduct> {
    const lookupCandidates: Array<{
      barcode?: string;
      source_type?: CatalogueSource;
      source_id?: string;
      source_url?: string;
    }> = [];

    if (resolved.identity.barcode) {
      lookupCandidates.push({ barcode: resolved.identity.barcode });
    }

    if (resolved.cacheKey.id) {
      lookupCandidates.push({
        source_type: resolved.cacheKey.source,
        source_id: resolved.cacheKey.id,
      });
    }

    if (resolved.cacheKey.url) {
      lookupCandidates.push({
        source_type: CatalogueSource.OfficialPage,
        source_url: normalizeUrl(resolved.cacheKey.url),
      });
    }

    let product: CatalogueProduct | null = null;
    for (const candidate of lookupCandidates) {
      product = await this.catalogueRepository.findOne({
        where: candidate,
      });

      if (product) {
        break;
      }
    }

    const next = product ?? this.catalogueRepository.create();
    const brand =
      resolved.identity.brand?.trim() ?? next.brand ?? 'Unknown brand';
    const name =
      resolved.identity.name?.trim() ?? next.name ?? 'Unknown product';
    const category = resolved.identity.category ?? next.category;

    next.brand = brand;
    next.name = name;
    next.category = category;
    next.barcode = resolved.identity.barcode ?? next.barcode ?? null;
    next.brand_search = normalizeSearchValue(brand);
    next.name_search = normalizeSearchValue(name);
    next.source_type = resolved.source;
    next.source_id = resolved.cacheKey.id ?? next.source_id ?? null;
    next.source_url = resolved.cacheKey.url
      ? normalizeUrl(resolved.cacheKey.url)
      : (next.source_url ?? null);
    next.confidence = resolved.confidence;
    next.review_required = resolved.reviewRequired;
    next.warnings = resolved.warnings;
    next.raw_source = resolved.rawSource;
    next.last_synced_at = new Date();
    const mergedIdentity = mergeIdentity(
      next.identity ?? {},
      resolved.identity,
    );
    const mergedGuidance = mergeGuidance(
      next.guidance ?? {},
      resolved.guidance,
    );
    const mergedManufacturer = mergeManufacturer(
      next.manufacturer ?? {},
      resolved.manufacturer,
    );

    next.identity = normalizeCatalogueIdentitySnapshot({
      brand,
      name,
      category,
      barcode: resolved.identity.barcode ?? next.identity?.barcode ?? null,
      imageUrls: mergedIdentity.imageUrls ?? [],
      sizeMl: mergedIdentity.sizeMl ?? null,
      description: mergedIdentity.description ?? null,
      benefits: mergedIdentity.benefits ?? [],
      suitedFor: mergedIdentity.suitedFor ?? [],
      inciIngredients: mergedIdentity.inciIngredients ?? [],
      inciLastConfirmedAt: mergedIdentity.inciLastConfirmedAt ?? null,
    });
    next.guidance = normalizeApplicationGuidanceSnapshot({
      applicationMethod: mergedGuidance.applicationMethod ?? null,
      quantity: mergedGuidance.quantity ?? null,
      steps: mergedGuidance.steps ?? [],
      cautions: mergedGuidance.cautions ?? [],
      waitMinutes: mergedGuidance.waitMinutes ?? null,
    });
    next.manufacturer = normalizeManufacturerInfoSnapshot(
      {
        brand: resolved.manufacturer.brand ?? next.manufacturer?.brand ?? brand,
        parentCompany: mergedManufacturer.parentCompany ?? null,
        countryOfOrigin: mergedManufacturer.countryOfOrigin ?? null,
        countryOfManufacture: mergedManufacturer.countryOfManufacture ?? null,
        supportEmail: mergedManufacturer.supportEmail ?? null,
        productUrl: mergedManufacturer.productUrl ?? null,
        websiteUrl: mergedManufacturer.websiteUrl ?? null,
      },
      next.identity.brand,
    );

    return this.catalogueRepository.save(next);
  }

  private async findCachedExternalCandidate(
    source: CatalogueSource,
    id: string,
  ): Promise<CatalogueProduct | null> {
    return this.catalogueRepository.findOne({
      where: {
        source_type: source,
        source_id: id,
      },
      order: {
        updated_at: 'DESC',
      },
    });
  }

  private async findByBarcode(
    barcode: string,
  ): Promise<CatalogueProduct | null> {
    return this.catalogueRepository
      .createQueryBuilder('product')
      .where('product.barcode = :barcode', { barcode })
      .orderBy(
        `CASE
          WHEN product.source_type = '${CatalogueSource.RitoraCatalogue}' THEN 0
          WHEN product.source_type = '${CatalogueSource.OpenBeautyFacts}' THEN 1
          WHEN product.source_type = '${CatalogueSource.OfficialPage}' THEN 2
          ELSE 3
        END`,
        'ASC',
      )
      .getOne();
  }

  private mergeOfficialPageIdentity(
    base: ResolvedProductDraft['identity'],
    extraction: OfficialPageExtraction['identity'],
  ): ResolvedProductDraft['identity'] {
    const mergedIdentity = mergeIdentity(base, extraction);
    const baseIngredients = base.inciIngredients ?? [];
    const extractedIngredients = extraction.inciIngredients ?? [];
    const preferredIngredients = this.choosePreferredIngredientList(
      baseIngredients,
      extractedIngredients,
    );

    return {
      ...mergedIdentity,
      brand: base.brand ?? extraction.brand ?? mergedIdentity.brand,
      name: base.name ?? extraction.name ?? mergedIdentity.name,
      category: base.category ?? extraction.category ?? mergedIdentity.category,
      barcode: base.barcode ?? extraction.barcode ?? mergedIdentity.barcode,
      inciIngredients:
        preferredIngredients.length > 0 ? preferredIngredients : undefined,
      inciLastConfirmedAt:
        preferredIngredients.length > 0
          ? baseIngredients.length >= preferredIngredients.length
            ? (base.inciLastConfirmedAt ??
              extraction.inciLastConfirmedAt ??
              mergedIdentity.inciLastConfirmedAt)
            : (extraction.inciLastConfirmedAt ??
              base.inciLastConfirmedAt ??
              mergedIdentity.inciLastConfirmedAt)
          : mergedIdentity.inciLastConfirmedAt,
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

  private assertUploadedImages(images: UploadedCatalogueImage[]): void {
    if (images.length < 2 || images.length > 6) {
      throw new BadRequestException('Upload between 2 and 6 images');
    }

    images.forEach((image, index) => {
      this.assertUploadedImage(image, `images[${index}]`);
    });
  }

  private assertHeroImageIndex(
    heroImageIndex: number,
    imageCount: number,
  ): void {
    if (
      !Number.isInteger(heroImageIndex) ||
      heroImageIndex < 0 ||
      heroImageIndex >= imageCount
    ) {
      throw new BadRequestException('Invalid heroImageIndex');
    }
  }

  private assertUploadedImage(
    file: UploadedCatalogueImage | null | undefined,
    fieldName: string,
  ): asserts file is UploadedCatalogueImage {
    if (!file || !file.buffer?.length) {
      throw new BadRequestException(`${fieldName} is required`);
    }

    if (!SUPPORTED_UPLOAD_IMAGE_TYPES.has(file.mimetype)) {
      throw new BadRequestException(`${fieldName} must be a supported image`);
    }
  }

  private choosePreferredIngredientList(
    baseIngredients: string[],
    extractedIngredients: string[],
  ): string[] {
    if (extractedIngredients.length === 0) {
      return baseIngredients;
    }

    if (baseIngredients.length === 0) {
      return extractedIngredients;
    }

    if (this.hasLikelyTruncatedIngredients(extractedIngredients)) {
      return baseIngredients;
    }

    if (extractedIngredients.length + 2 < baseIngredients.length) {
      return baseIngredients;
    }

    return extractedIngredients;
  }

  private async findByProductUrl(
    normalizedUrl: string,
  ): Promise<CatalogueProduct | null> {
    return this.catalogueRepository
      .createQueryBuilder('product')
      .where(
        new Brackets((qb) => {
          qb.where(
            `LOWER(REGEXP_REPLACE(COALESCE(product.manufacturer->>'productUrl', ''), '/+$', '')) = :url`,
            { url: normalizedUrl },
          ).orWhere(`product.source_url = :url`, { url: normalizedUrl });
        }),
      )
      .orderBy(
        `CASE
          WHEN product.source_type = '${CatalogueSource.RitoraCatalogue}' THEN 0
          WHEN product.source_type = '${CatalogueSource.OfficialPage}' THEN 1
          ELSE 2
        END`,
        'ASC',
      )
      .getOne();
  }

  private async resolveCachedProduct(
    product: CatalogueProduct,
    provenance: DataProvenance,
    strategy: EnrichmentStrategy,
  ): Promise<ResolvedLookupResponseDto> {
    const cached = this.toResolvedDraft(product, provenance);
    const hasStaleIngredients = this.hasLikelyTruncatedIngredients(
      cached.identity.inciIngredients,
    );
    const shouldDropStaleCache =
      hasStaleIngredients &&
      product.source_type === CatalogueSource.OfficialPage;

    if (shouldDropStaleCache) {
      await this.catalogueRepository.delete({ id: product.id });

      const refreshed = await this.resolveFreshAfterDroppingStaleCache(product);
      if (refreshed) {
        return refreshed;
      }
    }

    if (!this.needsDiscoveryCompletion(cached)) {
      return ResolvedLookupResponseDto.fromResolved(cached);
    }

    const effectiveStrategy = shouldDropStaleCache
      ? FULL_LOOKUP_ENRICHMENT
      : strategy;
    const enriched = await this.enrichExternalResult(cached, effectiveStrategy);
    await this.upsertDiscoveredProduct(enriched);

    return ResolvedLookupResponseDto.fromResolved(enriched);
  }

  private async resolveFreshAfterDroppingStaleCache(
    product: CatalogueProduct,
  ): Promise<ResolvedLookupResponseDto | null> {
    const productUrl = product.manufacturer?.productUrl ?? null;
    if (product.source_type === CatalogueSource.OfficialPage && productUrl) {
      return this.resolveUrl(productUrl);
    }

    const barcode = product.barcode ?? product.identity?.barcode ?? null;
    if (barcode) {
      return this.resolveBarcode(barcode, FULL_LOOKUP_ENRICHMENT);
    }

    if (
      product.source_type === CatalogueSource.OpenBeautyFacts &&
      product.source_id
    ) {
      return this.resolveCandidate({
        id: product.source_id,
        source: CatalogueSource.OpenBeautyFacts,
      });
    }

    return null;
  }

  private toResolvedDraft(
    product: CatalogueProduct,
    provenance: DataProvenance,
  ): ResolvedProductDraft {
    const title = `${product.brand} ${product.name}`.trim();
    const evidence =
      product.source_url || product.manufacturer?.productUrl
        ? [
            {
              source: product.source_type,
              url: product.source_url ?? product.manufacturer.productUrl,
              title,
            },
          ]
        : [];

    return {
      identity: product.identity,
      guidance: product.guidance,
      manufacturer: product.manufacturer,
      provenance,
      source: product.source_type,
      confidence: product.confidence,
      reviewRequired: product.review_required,
      warnings: product.warnings,
      evidence,
      cacheKey: {
        source: product.source_type,
        id: product.source_id,
        url: product.source_url ?? product.manufacturer?.productUrl ?? null,
      },
      rawSource: product.raw_source ?? {},
    };
  }
}

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import {
  decodeCursor,
  encodeCursor,
  type PaginatedResult,
} from '../common/utils/cursor-pagination';
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
  ProductCategory,
} from '../shelf/shelf.types';
import { CatalogueSearchQueryDto } from './dto/catalogue-search-query.dto';
import { CatalogueSuggestionResponseDto } from './dto/catalogue-suggestion-response.dto';
import { ResolveCandidateDto } from './dto/resolve-candidate.dto';
import { ResolvedLookupResponseDto } from './dto/resolved-lookup-response.dto';
import { CatalogueSourceRuleService } from './catalogue-source-rule.service';
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
  analyzeSearchTextFit,
  BARCODE_QUERY_PATTERN,
  hasAcceptedBestMatch,
  INTERNAL_CURSOR_FINGERPRINT,
  type InternalCursorTuple,
  rankSearchCandidates,
  SEARCH_BEST_MATCH_CACHED_LIMIT,
  SEARCH_BEST_MATCH_EXTERNAL_LIMIT,
  type SearchCandidate,
  type SearchStageCursorTuple,
  shouldResolveCachedCandidateImmediately,
  type RankedSearchCandidate,
  tokenizeSearchValue,
  uniqueWarnings,
} from './catalogue-search.utils';
import {
  fillMissingGuidance,
  fillMissingIdentity,
  fillMissingManufacturer,
  mergeGuidance,
  mergeIdentity,
  mergeManufacturer,
  normalizeBarcode,
  normalizeSearchValue,
  normalizeUrl,
} from './product-discovery.utils';

type CachedSearchPage = {
  items: CatalogueSuggestionResponseDto[];
  nextCursor: string | null;
};
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
const INTERACTIVE_SEARCH_ENRICHMENT: EnrichmentStrategy = {
  allowKnownProductUrlEnrichment: true,
  allowOfficialPageDiscovery: true,
  allowAiNormalization: false,
  allowAiCompletion: false,
  allowAiBarcodeFallback: false,
};
const FAST_OFFICIAL_SEARCH_CANDIDATE_LIMIT = 2;
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
    @InjectRepository(CatalogueProduct)
    private readonly catalogueRepository: Repository<CatalogueProduct>,
    private readonly openBeautyFactsProvider: OpenBeautyFactsProvider,
    private readonly officialPageProvider: OfficialPageProvider,
    private readonly openAiExtractorProvider: OpenAiExtractorProvider,
    private readonly productPageDiscoveryProvider: ProductPageDiscoveryProvider,
    private readonly catalogueSourceRuleService: CatalogueSourceRuleService,
  ) {}

  async search(
    query: CatalogueSearchQueryDto,
  ): Promise<PaginatedResult<CatalogueSuggestionResponseDto>> {
    const normalizedQuery = normalizeSearchValue(query.q);
    const fingerprint = `catalogue:${normalizedQuery}:${query.limit}`;

    if (normalizedQuery.length < 2) {
      return {
        items: [],
        nextCursor: null,
      };
    }

    let stage: SearchStageCursorTuple[0] = 'internal';
    let internalCursor: string | null = null;
    let externalPage = 1;

    if (query.cursor) {
      const decoded = decodeCursor(query.cursor);
      if (decoded.fingerprint !== fingerprint) {
        throw new BadRequestException('Cursor does not match this request');
      }

      const [nextStage, value] = decoded.tuple as SearchStageCursorTuple;
      if (nextStage === 'internal') {
        stage = 'internal';
        internalCursor = String(value);
      } else {
        stage = 'external';
        externalPage = Number(value);
      }
    }

    if (stage === 'external') {
      return this.searchOpenBeautyFacts(
        normalizedQuery,
        query.limit,
        externalPage,
        fingerprint,
      );
    }

    const cachedPage = await this.searchCachedCatalogue(
      normalizedQuery,
      query.limit,
      internalCursor,
    );

    if (cachedPage.nextCursor || cachedPage.items.length === query.limit) {
      return {
        items: cachedPage.items,
        nextCursor: cachedPage.nextCursor
          ? encodeCursor({
              fingerprint,
              tuple: ['internal', cachedPage.nextCursor],
            })
          : null,
      };
    }

    const remaining = query.limit - cachedPage.items.length;
    const external = await this.openBeautyFactsProvider.search(
      normalizedQuery,
      1,
    );
    const externalItems = external.items
      .slice(0, remaining)
      .map((item) => CatalogueSuggestionResponseDto.fromSuggestion(item));

    return {
      items: [...cachedPage.items, ...externalItems],
      nextCursor: external.hasMore
        ? encodeCursor({
            fingerprint,
            tuple: ['external', 2],
          })
        : null,
    };
  }

  async searchBestMatch(
    query: string,
  ): Promise<ResolvedLookupResponseDto | null> {
    const rawQuery = query.trim();
    const normalizedQuery = normalizeSearchValue(rawQuery);
    const strategy = INTERACTIVE_SEARCH_ENRICHMENT;
    if (normalizedQuery.length < 2) {
      return null;
    }

    const normalizedBarcode = normalizeBarcode(rawQuery);
    if (BARCODE_QUERY_PATTERN.test(normalizedBarcode)) {
      return this.resolveBarcode(normalizedBarcode, strategy);
    }

    const cachedCandidates =
      await this.searchCachedBestMatchCandidates(normalizedQuery);
    const rankedCachedCandidates = rankSearchCandidates(
      normalizedQuery,
      cachedCandidates,
    );
    const bestCachedCandidate = rankedCachedCandidates[0];
    const secondCachedCandidate = rankedCachedCandidates[1];

    if (
      shouldResolveCachedCandidateImmediately(
        bestCachedCandidate,
        secondCachedCandidate,
      )
    ) {
      const resolved = await this.resolveSearchCandidate(
        bestCachedCandidate,
        strategy,
      );
      if (
        resolved &&
        this.isAcceptableSearchResult(normalizedQuery, resolved)
      ) {
        return this.completeAcceptedSearchResultIfNeeded(resolved);
      }
    }

    const externalCandidates =
      await this.searchExternalBestMatchCandidates(normalizedQuery);
    const rankedCandidates = rankSearchCandidates(normalizedQuery, [
      ...cachedCandidates,
      ...externalCandidates,
    ]);
    const bestCandidate = rankedCandidates[0];
    const secondBestCandidate = rankedCandidates[1];

    if (
      !hasAcceptedBestMatch(bestCandidate, secondBestCandidate, normalizedQuery)
    ) {
      const officialPageMatch = await this.resolveOfficialPageBestMatch(
        normalizedQuery,
        strategy,
      );

      if (officialPageMatch) {
        return this.completeAcceptedSearchResultIfNeeded(officialPageMatch);
      }

      return this.resolveQueryWithAi(rawQuery);
    }

    const candidateLimit = Math.min(rankedCandidates.length, 3);
    for (const candidate of rankedCandidates.slice(0, candidateLimit)) {
      const resolved = await this.resolveSearchCandidate(candidate, strategy);
      if (
        resolved &&
        this.isAcceptableSearchResult(normalizedQuery, resolved)
      ) {
        return this.completeAcceptedSearchResultIfNeeded(resolved);
      }
    }

    const fallback = await this.resolveOfficialPageBestMatch(
      normalizedQuery,
      strategy,
    );

    if (fallback) {
      return this.completeAcceptedSearchResultIfNeeded(fallback);
    }

    return this.resolveQueryWithAi(rawQuery);
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

  private async searchCachedCatalogue(
    normalizedQuery: string,
    limit: number,
    cursor: string | null,
  ): Promise<CachedSearchPage> {
    const fingerprint = `${INTERNAL_CURSOR_FINGERPRINT}:${normalizedQuery}:${limit}`;
    const searchLike = `%${normalizedQuery}%`;
    const prefixQuery = `${normalizedQuery}%`;
    const brandExpression = `LOWER(COALESCE(product.brand_search, product.brand))`;
    const nameExpression = `LOWER(COALESCE(product.name_search, product.name))`;
    const combinedExpression = `LOWER(TRIM(CONCAT(COALESCE(product.brand_search, product.brand), ' ', COALESCE(product.name_search, product.name))))`;
    const sourcePriorityExpression = `CASE
      WHEN product.source_type = '${CatalogueSource.RitoraCatalogue}' THEN 0
      WHEN product.source_type = '${CatalogueSource.OfficialPage}' THEN 1
      ELSE 2
    END`;
    const relevanceExpression = `CASE
      WHEN ${combinedExpression} = :exactQuery OR ${brandExpression} = :exactQuery OR ${nameExpression} = :exactQuery THEN 0
      WHEN ${combinedExpression} LIKE :prefixQuery OR ${brandExpression} LIKE :prefixQuery OR ${nameExpression} LIKE :prefixQuery THEN 1
      ELSE 2
    END`;

    const queryBuilder = this.catalogueRepository
      .createQueryBuilder('product')
      .addSelect(relevanceExpression, 'relevance')
      .addSelect(sourcePriorityExpression, 'source_priority')
      .where(
        new Brackets((qb) => {
          qb.where(`${combinedExpression} LIKE :searchLike`)
            .orWhere(`${brandExpression} LIKE :searchLike`)
            .orWhere(`${nameExpression} LIKE :searchLike`);
        }),
      )
      .setParameters({
        exactQuery: normalizedQuery,
        prefixQuery,
        searchLike,
      });

    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (decoded.fingerprint !== fingerprint) {
        throw new BadRequestException('Cursor does not match this request');
      }

      const [relevance, priority, brand, name, id] =
        decoded.tuple as InternalCursorTuple;

      queryBuilder.andWhere(
        new Brackets((qb) => {
          qb.where(`${relevanceExpression} > :cursorRelevance`, {
            cursorRelevance: Number(relevance),
          })
            .orWhere(
              new Brackets((inner) => {
                inner
                  .where(`${relevanceExpression} = :cursorRelevance`, {
                    cursorRelevance: Number(relevance),
                  })
                  .andWhere(`${sourcePriorityExpression} > :cursorPriority`, {
                    cursorPriority: Number(priority),
                  });
              }),
            )
            .orWhere(
              new Brackets((inner) => {
                inner
                  .where(`${relevanceExpression} = :cursorRelevance`, {
                    cursorRelevance: Number(relevance),
                  })
                  .andWhere(`${sourcePriorityExpression} = :cursorPriority`, {
                    cursorPriority: Number(priority),
                  })
                  .andWhere(`${brandExpression} > :cursorBrand`, {
                    cursorBrand: String(brand),
                  });
              }),
            )
            .orWhere(
              new Brackets((inner) => {
                inner
                  .where(`${relevanceExpression} = :cursorRelevance`, {
                    cursorRelevance: Number(relevance),
                  })
                  .andWhere(`${sourcePriorityExpression} = :cursorPriority`, {
                    cursorPriority: Number(priority),
                  })
                  .andWhere(`${brandExpression} = :cursorBrand`, {
                    cursorBrand: String(brand),
                  })
                  .andWhere(`${nameExpression} > :cursorName`, {
                    cursorName: String(name),
                  });
              }),
            )
            .orWhere(
              new Brackets((inner) => {
                inner
                  .where(`${relevanceExpression} = :cursorRelevance`, {
                    cursorRelevance: Number(relevance),
                  })
                  .andWhere(`${sourcePriorityExpression} = :cursorPriority`, {
                    cursorPriority: Number(priority),
                  })
                  .andWhere(`${brandExpression} = :cursorBrand`, {
                    cursorBrand: String(brand),
                  })
                  .andWhere(`${nameExpression} = :cursorName`, {
                    cursorName: String(name),
                  })
                  .andWhere(`product.id > :cursorId`, {
                    cursorId: String(id),
                  });
              }),
            );
        }),
      );
    }

    const { entities, raw } = await queryBuilder
      .orderBy('relevance', 'ASC')
      .addOrderBy('source_priority', 'ASC')
      .addOrderBy(brandExpression, 'ASC')
      .addOrderBy(nameExpression, 'ASC')
      .addOrderBy('product.id', 'ASC')
      .take(limit + 1)
      .getRawAndEntities();

    const hasMore = entities.length > limit;
    const pageEntities = hasMore ? entities.slice(0, limit) : entities;
    const pageRaw = hasMore
      ? (raw.slice(0, limit) as Array<Record<string, unknown>>)
      : (raw as Array<Record<string, unknown>>);
    const lastEntity = pageEntities.at(-1);
    const lastRaw = pageRaw.at(-1);

    let nextCursor: string | null = null;
    if (hasMore && lastEntity && lastRaw) {
      const relevance =
        typeof lastRaw.relevance === 'number'
          ? lastRaw.relevance
          : Number(lastRaw.relevance ?? 2);
      const priority =
        typeof lastRaw.source_priority === 'number'
          ? lastRaw.source_priority
          : Number(lastRaw.source_priority ?? 2);

      nextCursor = encodeCursor({
        fingerprint,
        tuple: [
          relevance,
          priority,
          normalizeSearchValue(lastEntity.brand),
          normalizeSearchValue(lastEntity.name),
          lastEntity.id,
        ],
      });
    }

    return {
      items: pageEntities.map((product) =>
        CatalogueSuggestionResponseDto.fromEntity(product),
      ),
      nextCursor,
    };
  }

  private async searchOpenBeautyFacts(
    normalizedQuery: string,
    limit: number,
    page: number,
    fingerprint: string,
  ): Promise<PaginatedResult<CatalogueSuggestionResponseDto>> {
    const result = await this.openBeautyFactsProvider.search(
      normalizedQuery,
      page,
    );
    const items = result.items
      .slice(0, limit)
      .map((item) => CatalogueSuggestionResponseDto.fromSuggestion(item));

    let nextCursor: string | null = null;
    if (result.hasMore) {
      nextCursor = encodeCursor({
        fingerprint,
        tuple: ['external', page + 1],
      });
    }

    return { items, nextCursor };
  }

  private async searchCachedBestMatchCandidates(
    normalizedQuery: string,
  ): Promise<SearchCandidate[]> {
    const cachedPage = await this.searchCachedCatalogue(
      normalizedQuery,
      SEARCH_BEST_MATCH_CACHED_LIMIT,
      null,
    );

    return cachedPage.items
      .filter((item) => item.source !== CatalogueSource.OfficialPage)
      .map((item) => ({
        ...item,
        origin: 'cached',
      }));
  }

  private async searchExternalBestMatchCandidates(
    normalizedQuery: string,
  ): Promise<SearchCandidate[]> {
    const result = await this.openBeautyFactsProvider.search(
      normalizedQuery,
      1,
    );
    const suggestions = result.items.slice(0, SEARCH_BEST_MATCH_EXTERNAL_LIMIT);

    return suggestions.map((suggestion) => ({
      ...CatalogueSuggestionResponseDto.fromSuggestion(suggestion),
      origin: 'external',
    }));
  }

  private async resolveSearchCandidate(
    candidate: RankedSearchCandidate,
    strategy: EnrichmentStrategy,
  ): Promise<ResolvedLookupResponseDto | null> {
    if (candidate.origin === 'cached') {
      const product = await this.catalogueRepository.findOne({
        where: { id: candidate.id },
      });

      if (!product) {
        return null;
      }

      return this.resolveCachedProduct(
        product,
        DataProvenance.Catalogue,
        strategy,
      );
    }

    if (!candidate.barcode) {
      return null;
    }

    if (candidate.source === CatalogueSource.OpenBeautyFacts) {
      const openBeautyFactsResult =
        await this.openBeautyFactsProvider.resolveBarcode(
          candidate.barcode,
          DataProvenance.Catalogue,
        );
      if (!openBeautyFactsResult) {
        return null;
      }

      const resolved = await this.enrichExternalResult(
        openBeautyFactsResult,
        strategy,
      );
      await this.upsertDiscoveredProduct(resolved);

      return ResolvedLookupResponseDto.fromResolved(resolved);
    }

    return this.resolveBarcode(candidate.barcode, strategy);
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
      current = this.applyAiCompletion(
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

    const candidates = await this.productPageDiscoveryProvider.search(base);
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

    const searchFit = analyzeSearchTextFit(baseName, extractedName);

    if (searchFit.candidateLooksLikeBundle && !searchFit.queryHasBundleIntent) {
      return false;
    }

    if (
      searchFit.hasUnexpectedProductType &&
      !searchFit.queryHasBundleIntent &&
      searchFit.tokenCoverage < 1
    ) {
      return false;
    }

    if (baseName === extractedName) {
      return true;
    }

    const baseTokens = tokenizeSearchValue(baseName);
    const extractedTokens = new Set(tokenizeSearchValue(extractedName));
    const matchedTokenCount = baseTokens.filter((token) =>
      extractedTokens.has(token),
    ).length;
    const tokenCoverage =
      baseTokens.length === 0 ? 0 : matchedTokenCount / baseTokens.length;

    return tokenCoverage >= 0.6;
  }

  private isAcceptableSearchResult(
    normalizedQuery: string,
    resolved: ResolvedLookupResponseDto,
  ): boolean {
    const brand = normalizeSearchValue(resolved.identity.brand ?? '');
    const name = normalizeSearchValue(resolved.identity.name ?? '');
    const combined = normalizeSearchValue(`${brand} ${name}`);
    const {
      tokenCoverage,
      queryHasBundleIntent,
      candidateLooksLikeBundle,
      hasUnexpectedProductType,
    } = analyzeSearchTextFit(normalizedQuery, combined);

    if (!brand || !name) {
      return false;
    }

    if (tokenCoverage < 0.75) {
      return false;
    }

    if (candidateLooksLikeBundle && !queryHasBundleIntent) {
      return false;
    }

    if (
      hasUnexpectedProductType &&
      !queryHasBundleIntent &&
      tokenCoverage < 1
    ) {
      return false;
    }

    return true;
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

  private async resolveOfficialPageBestMatch(
    normalizedQuery: string,
    strategy: EnrichmentStrategy = FULL_LOOKUP_ENRICHMENT,
  ): Promise<ResolvedLookupResponseDto | null> {
    const candidates =
      await this.productPageDiscoveryProvider.searchQuery(normalizedQuery);
    const resolvedCandidates: Array<{
      resolved: ResolvedLookupResponseDto;
      candidate: SearchCandidate;
    }> = [];

    const candidateLimit = strategy.allowAiCompletion
      ? 3
      : FAST_OFFICIAL_SEARCH_CANDIDATE_LIMIT;

    for (const candidate of candidates.slice(0, candidateLimit)) {
      const extraction = await this.officialPageProvider.extract(candidate.url);
      if (!extraction) {
        continue;
      }

      const draft = await this.buildOfficialPageResult(
        extraction,
        candidate.url,
        DataProvenance.Catalogue,
        strategy,
      );
      const resolved = ResolvedLookupResponseDto.fromResolved(draft);
      if (!resolved) {
        continue;
      }

      resolvedCandidates.push({
        resolved,
        candidate: {
          id: candidate.url,
          source: resolved.source,
          brand: resolved.identity.brand ?? '',
          name: resolved.identity.name ?? '',
          category: resolved.identity.category ?? ProductCategory.Other,
          imageUrls: resolved.identity.imageUrls ?? [],
          sizeMl: resolved.identity.sizeMl ?? null,
          barcode: resolved.identity.barcode ?? null,
          confidence: resolved.confidence,
          reviewRequired: resolved.reviewRequired,
          origin: 'external',
        },
      });
    }

    const rankedCandidates = rankSearchCandidates(
      normalizedQuery,
      resolvedCandidates.map((entry) => entry.candidate),
    );

    for (const rankedCandidate of rankedCandidates) {
      if (rankedCandidate.tokenCoverage < 0.6) {
        continue;
      }

      const resolved = resolvedCandidates.find(
        (entry) => entry.candidate.id === rankedCandidate.id,
      )?.resolved;

      if (
        resolved &&
        this.isAcceptableSearchResult(normalizedQuery, resolved)
      ) {
        return resolved;
      }
    }

    return null;
  }

  private async completeAcceptedSearchResultIfNeeded(
    resolved: ResolvedLookupResponseDto,
  ): Promise<ResolvedLookupResponseDto> {
    const draft = this.toResolvedDraftFromLookup(resolved);
    let completedDraft = this.cloneResolvedDraft(draft);

    if (!this.needsInteractiveSearchCompletion(completedDraft)) {
      return resolved;
    }

    await this.fillMissingIngredientsFromSearchResults(completedDraft);

    if (!this.needsBlockingInteractiveSearchCompletion(completedDraft)) {
      return this.persistCompletedInteractiveSearchResult(
        completedDraft,
        draft,
      );
    }

    const completionSeed =
      this.toInteractiveSearchCompletionSeed(completedDraft);
    const completion =
      await this.openAiExtractorProvider.completeInteractiveMissingFields(
        completionSeed,
      );

    if (completion) {
      completedDraft = this.applyAiCompletion(
        completedDraft,
        completion,
        'aiInteractiveSearch',
      );
    }
    if (!completedDraft.identity.inciIngredients?.length) {
      const ingredientCompletion =
        await this.openAiExtractorProvider.discoverIngredients(completionSeed);
      if (ingredientCompletion) {
        const ingredientDraft = this.applyAiCompletion(
          completedDraft,
          ingredientCompletion,
          'aiIngredientDiscovery',
        );
        completedDraft.identity.inciLastConfirmedAt = ingredientDraft.identity
          .inciIngredients?.length
          ? new Date().toISOString()
          : completedDraft.identity.inciLastConfirmedAt;
        completedDraft.identity.inciIngredients =
          ingredientDraft.identity.inciIngredients;
        completedDraft.warnings = uniqueWarnings([
          ...completedDraft.warnings,
          ...ingredientDraft.warnings,
        ]);
        completedDraft.evidence = [
          ...completedDraft.evidence,
          ...ingredientDraft.evidence,
        ];
      }
    }

    if (
      !completion &&
      this.needsBlockingInteractiveSearchCompletion(completedDraft)
    ) {
      return resolved;
    }

    return this.persistCompletedInteractiveSearchResult(completedDraft, draft);
  }

  private async persistCompletedInteractiveSearchResult(
    completedDraft: ResolvedProductDraft,
    originalDraft: ResolvedProductDraft,
  ): Promise<ResolvedLookupResponseDto> {
    completedDraft.manufacturer.productUrl =
      originalDraft.manufacturer.productUrl;
    completedDraft.manufacturer.websiteUrl =
      originalDraft.manufacturer.websiteUrl;

    const completed = this.finalizeResolved(completedDraft);
    await this.stripUntrustedUrlsFromResolved(completed);
    await this.upsertDiscoveredProduct(completed);

    return ResolvedLookupResponseDto.fromResolved(completed);
  }

  private cloneResolvedDraft(
    draft: ResolvedProductDraft,
  ): ResolvedProductDraft {
    return {
      ...draft,
      identity: {
        ...draft.identity,
        imageUrls: [...(draft.identity.imageUrls ?? [])],
        benefits: [...(draft.identity.benefits ?? [])],
        suitedFor: [...(draft.identity.suitedFor ?? [])],
        inciIngredients: [...(draft.identity.inciIngredients ?? [])],
      },
      guidance: {
        ...draft.guidance,
        steps: [...(draft.guidance.steps ?? [])],
        cautions: [...(draft.guidance.cautions ?? [])],
      },
      manufacturer: {
        ...draft.manufacturer,
      },
      warnings: [...draft.warnings],
      evidence: [...draft.evidence],
      cacheKey: {
        ...draft.cacheKey,
      },
      rawSource: {
        ...draft.rawSource,
      },
    };
  }

  private async fillMissingIngredientsFromSearchResults(
    resolved: ResolvedProductDraft,
  ): Promise<void> {
    if (resolved.identity.inciIngredients?.length) {
      return;
    }

    const query = [
      resolved.identity.brand,
      resolved.identity.name,
      'ingredients',
    ]
      .filter(Boolean)
      .join(' ');
    if (!query.trim()) {
      return;
    }

    const candidates =
      await this.productPageDiscoveryProvider.searchGenericQuery(query);
    const extractionResults = await Promise.all(
      candidates.slice(0, 5).map(async (candidate, index) => {
        const extraction = await this.officialPageProvider.extract(candidate.url);
        const ingredients = extraction?.identity.inciIngredients ?? [];

        return {
          candidate,
          extraction,
          ingredients,
          index,
        };
      }),
    );

    const bestIngredientResult = extractionResults
      .filter((entry) => entry.ingredients.length > 0)
      .sort((left, right) => {
        if (right.ingredients.length !== left.ingredients.length) {
          return right.ingredients.length - left.ingredients.length;
        }

        return left.index - right.index;
      })[0];

    if (!bestIngredientResult) {
      return;
    }

    resolved.identity.inciIngredients = bestIngredientResult.ingredients;
    resolved.identity.inciLastConfirmedAt =
      bestIngredientResult.extraction?.identity.inciLastConfirmedAt ??
      new Date().toISOString();
    resolved.warnings = uniqueWarnings([
      ...resolved.warnings,
      LookupWarningCode.IngredientsUnverified,
    ]);
    resolved.evidence = [
      ...resolved.evidence,
      ...(bestIngredientResult.extraction?.evidence ?? []),
    ];
  }

  private async resolveQueryWithAi(
    query: string,
  ): Promise<ResolvedLookupResponseDto | null> {
    const completion = await this.openAiExtractorProvider.searchByQuery(query);
    if (!completion) {
      return null;
    }

    const seed: ResolvedProductDraft = {
      identity: {},
      guidance: {},
      manufacturer: {},
      provenance: DataProvenance.Catalogue,
      source: CatalogueSource.OfficialPage,
      confidence: LookupConfidence.Low,
      reviewRequired: true,
      warnings: [LookupWarningCode.ReviewRequired],
      evidence: [],
      cacheKey: {
        source: CatalogueSource.OfficialPage,
        id: null,
        url: null,
      },
      rawSource: {},
    };
    const completed = this.finalizeResolved(
      this.applyAiCompletion(seed, completion, 'aiSearchByQuery'),
    );
    await this.stripUntrustedUrlsFromResolved(completed);

    const resolved = ResolvedLookupResponseDto.fromResolved(completed);
    if (!this.isAcceptableSearchResult(normalizeSearchValue(query), resolved)) {
      return null;
    }

    await this.upsertDiscoveredProduct(completed);
    return resolved;
  }

  private toResolvedDraftFromLookup(
    resolved: ResolvedLookupResponseDto,
  ): ResolvedProductDraft {
    return {
      identity: resolved.identity,
      guidance: resolved.guidance,
      manufacturer: resolved.manufacturer,
      provenance: resolved.provenance,
      source: resolved.source,
      confidence: resolved.confidence,
      reviewRequired: resolved.reviewRequired,
      warnings: resolved.warnings,
      evidence: resolved.evidence,
      cacheKey: {
        source: resolved.source,
        id: resolved.identity.barcode ?? null,
        url: resolved.manufacturer.productUrl ?? null,
      },
      rawSource: {},
    };
  }

  private needsInteractiveSearchCompletion(
    resolved: ResolvedProductDraft,
  ): boolean {
    return (
      !resolved.identity.description ||
      !resolved.identity.benefits?.length ||
      !resolved.identity.suitedFor?.length ||
      !resolved.identity.inciIngredients?.length ||
      !resolved.manufacturer.parentCompany ||
      !resolved.manufacturer.countryOfManufacture ||
      !resolved.manufacturer.supportEmail
    );
  }

  private needsBlockingInteractiveSearchCompletion(
    resolved: ResolvedProductDraft,
  ): boolean {
    return (
      !resolved.identity.description ||
      !resolved.identity.inciIngredients?.length
    );
  }

  private toInteractiveSearchCompletionSeed(
    resolved: ResolvedProductDraft,
  ): ResolvedProductDraft {
    return {
      ...resolved,
      manufacturer: {
        ...resolved.manufacturer,
        productUrl: null,
        websiteUrl: null,
      },
      cacheKey: {
        ...resolved.cacheKey,
        url: null,
      },
      rawSource: {},
    };
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
      : hasRichData
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

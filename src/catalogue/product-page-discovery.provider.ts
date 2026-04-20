import { Injectable, Logger } from '@nestjs/common';
import {
  getPreferredBrandHostPatterns,
  urlMatchesHostPatterns,
} from './brand-host-registry';
import { humanizeProductUrlSegment } from '../common/utils/product-name';
import { CatalogueSourceRuleService } from './catalogue-source-rule.service';
import type { ResolvedProductDraft } from './product-discovery.types';
import { normalizeSearchValue, normalizeUrl } from './product-discovery.utils';
import { OpenAiExtractorProvider } from './openai-extractor.provider';

type SearchResult = {
  url: string;
  title: string;
  snippet: string | null;
  origin?: 'generic' | 'ai';
};

type RankedSearchResult = {
  result: SearchResult;
  score: number;
};

const SEARCH_ENDPOINT = 'https://html.duckduckgo.com/html/';
const REQUEST_TIMEOUT_MS = 3000;
const MAX_RESULTS = 6;
const REQUEST_HEADERS = {
  Accept: 'text/html,application/xhtml+xml',
  'User-Agent': 'Ritora/1.0 (+https://getritora.com)',
};
const AI_DISCOVERY_RESULT_BONUS = 60;
const AI_DISCOVERY_HOST_BONUS = 90;
const KNOWN_BRAND_HOST_BONUS = 180;
const KNOWN_BRAND_HOST_MISMATCH_PENALTY = -140;

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeDuckDuckGoUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const absoluteValue = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;

  try {
    const url = new URL(absoluteValue);
    if (url.hostname.endsWith('duckduckgo.com')) {
      const redirectTarget = url.searchParams.get('uddg');
      return redirectTarget
        ? normalizeUrl(decodeURIComponent(redirectTarget))
        : null;
    }

    return normalizeUrl(absoluteValue);
  } catch {
    return null;
  }
}

function tokenize(value: string): string[] {
  return normalizeSearchValue(value)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function decodeUrlForSearch(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

function readableTitleFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const slug = pathname.split('/').filter(Boolean).at(-1) ?? pathname;
    const readableTitle = humanizeProductUrlSegment(decodeUrlForSearch(slug));

    return readableTitle || url;
  } catch {
    return url;
  }
}

function getHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function looksLikeLowSignalTitle(value: string): boolean {
  const normalizedTitle = normalizeSearchValue(value);

  return (
    normalizedTitle.includes('adding to cart') ||
    normalizedTitle.includes('please wait for verification') ||
    normalizedTitle.includes('search results') ||
    normalizedTitle.includes('product search')
  );
}

function looksLikeProductUrl(url: string): boolean {
  const normalized = normalizeSearchValue(decodeUrlForSearch(url));

  return (
    normalized.includes('/product/') ||
    normalized.includes('/product-detail') ||
    normalized.includes('/product/detail.html') ||
    normalized.includes('/products/') ||
    normalized.includes('/shop/')
  );
}

function buildTokenSets(
  ...values: Array<string | null | undefined>
): string[][] {
  return values
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => tokenize(value))
    .filter((tokens) => tokens.length > 0);
}

function scoreResult(
  result: SearchResult,
  tokenSets: string[][],
  trustScoreAdjustment: number,
  preferredHosts: Set<string>,
  knownBrandHosts: Set<string>,
): number {
  const normalizedTitle = normalizeSearchValue(result.title);
  const normalizedSnippet = normalizeSearchValue(result.snippet ?? '');
  const normalizedPath = normalizeSearchValue(decodeUrlForSearch(result.url));
  const haystack = `${normalizedTitle} ${normalizedSnippet} ${normalizedPath}`;

  if (looksLikeLowSignalTitle(result.title)) {
    return Number.NEGATIVE_INFINITY;
  }

  const bestScore = tokenSets
    .map((tokens) => {
      const matchedTokenCount = tokens.filter((token) =>
        haystack.includes(token),
      ).length;
      const tokenCoverage =
        tokens.length === 0 ? 0 : matchedTokenCount / tokens.length;

      if (tokenCoverage < 0.45) {
        return Number.NEGATIVE_INFINITY;
      }

      let score = matchedTokenCount * 22;
      score += tokenCoverage * 100;

      if (matchedTokenCount === tokens.length) {
        score += 60;
      }

      if (looksLikeProductUrl(result.url)) {
        score += 20;
      }

      const hostname = getHostname(result.url);
      if (hostname) {
        if (preferredHosts.has(hostname)) {
          score += AI_DISCOVERY_HOST_BONUS;
        }

        if (knownBrandHosts.size > 0) {
          score += urlMatchesHostPatterns(result.url, knownBrandHosts)
            ? KNOWN_BRAND_HOST_BONUS
            : KNOWN_BRAND_HOST_MISMATCH_PENALTY;
        }
      }

      if (result.origin === 'ai') {
        score += AI_DISCOVERY_RESULT_BONUS;
      }

      score += trustScoreAdjustment;

      return score;
    })
    .filter((candidate) => Number.isFinite(candidate))
    .sort((left, right) => right - left)[0];

  return Number.isFinite(bestScore) ? bestScore : Number.NEGATIVE_INFINITY;
}

@Injectable()
export class ProductPageDiscoveryProvider {
  private readonly logger = new Logger(ProductPageDiscoveryProvider.name);

  constructor(
    private readonly openAiExtractorProvider: OpenAiExtractorProvider,
    private readonly catalogueSourceRuleService: CatalogueSourceRuleService,
  ) {}

  async discover(draft: ResolvedProductDraft): Promise<SearchResult[]> {
    const brand = draft.identity.brand ?? draft.manufacturer.brand ?? '';
    const name = draft.identity.name ?? '';
    const barcode = draft.identity.barcode ?? '';

    if (!brand.trim() || !name.trim()) {
      return [];
    }

    const tokenSets = buildTokenSets(`${brand} ${name}`, name);
    const [genericResults, aiResults] = await Promise.all([
      this.searchQueries(
        this.buildDiscoveryQueryVariants(brand, name, barcode),
      ),
      this.discoverOfficialResults({
        query: `${brand} ${name}`,
        brand,
        name,
        barcode: barcode || undefined,
      }),
    ]);

    return this.rankResults(
      this.mergeUniqueResults(genericResults, aiResults),
      tokenSets,
      this.buildPreferredHosts(aiResults),
      new Set(
        getPreferredBrandHostPatterns({
          brand,
          query: `${brand} ${name}`.trim(),
        }),
      ),
    );
  }

  private buildDiscoveryQueryVariants(
    brand: string,
    name: string,
    barcode: string,
  ): string[] {
    const variants = new Set<string>();
    const brandAndName = [brand, name].filter(Boolean).join(' ');
    const fullName = [brand, name, barcode].filter(Boolean).join(' ');

    variants.add(brandAndName);
    variants.add(`${brandAndName} official`);
    variants.add(`${name} official`);

    if (fullName && fullName !== brandAndName) {
      variants.add(fullName);
    }

    return Array.from(variants);
  }

  private async searchQueries(queries: string[]): Promise<SearchResult[]> {
    const deduped = new Map<string, SearchResult>();

    for (const query of queries) {
      const results = await this.fetchSearchResults(query);
      for (const result of results) {
        if (!deduped.has(result.url)) {
          deduped.set(result.url, result);
        }
      }
    }

    return Array.from(deduped.values());
  }

  private async fetchSearchResults(query: string): Promise<SearchResult[]> {
    const params = new URLSearchParams({ q: query });

    try {
      const response = await fetch(`${SEARCH_ENDPOINT}?${params.toString()}`, {
        headers: REQUEST_HEADERS,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        this.logger.warn(
          `Product page discovery search failed with status ${response.status}`,
        );
        return [];
      }

      const html = await response.text();
      const results = Array.from(
        html.matchAll(
          /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
        ),
      );

      const parsedResults = results.map((match, index) => {
        const url = decodeDuckDuckGoUrl(match[1]);
        if (!url) {
          return null;
        }

        const title = stripHtml(match[2]);
        const snippetMatch = html
          .slice(match.index ?? 0)
          .match(
            /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i,
          );
        const snippet = stripHtml(snippetMatch?.[1] ?? snippetMatch?.[2] ?? '');

        return {
          url,
          title,
          snippet: snippet || null,
          origin: 'generic' as const,
          index,
        };
      });

      return parsedResults
        .filter(
          (
            result,
          ): result is SearchResult & {
            origin: 'generic';
            index: number;
          } => result !== null,
        )
        .sort((left, right) => left.index - right.index)
        .map((result) => ({
          url: result.url,
          title: result.title,
          snippet: result.snippet,
          origin: result.origin,
        }));
    } catch (error) {
      this.logger.warn(
        `Product page discovery search failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      return [];
    }
  }

  private async discoverOfficialResults(input: {
    query: string;
    brand?: string;
    name?: string;
    barcode?: string;
  }): Promise<SearchResult[]> {
    const urls =
      await this.openAiExtractorProvider.discoverOfficialProductUrls(input);

    return urls.map((url) => ({
      url,
      title: readableTitleFromUrl(url),
      snippet: null,
      origin: 'ai' as const,
    }));
  }

  private async rankResults(
    results: SearchResult[],
    tokenSets: string[][],
    preferredHosts: Set<string>,
    knownBrandHosts: Set<string> = new Set(),
  ): Promise<SearchResult[]> {
    const scoredResults = await Promise.all(
      results.map(async (result): Promise<RankedSearchResult | null> => {
        const trustEvaluation =
          await this.catalogueSourceRuleService.evaluateUrl(result.url);

        if (trustEvaluation.blocked) {
          return null;
        }

        const score = scoreResult(
          result,
          tokenSets,
          trustEvaluation.scoreAdjustment,
          preferredHosts,
          knownBrandHosts,
        );

        if (!Number.isFinite(score)) {
          return null;
        }

        return { result, score };
      }),
    );

    return scoredResults
      .filter((entry): entry is RankedSearchResult => Boolean(entry))
      .sort((left, right) => right.score - left.score)
      .slice(0, MAX_RESULTS)
      .map((entry) => entry.result);
  }

  private mergeUniqueResults(...groups: SearchResult[][]): SearchResult[] {
    const deduped = new Map<string, SearchResult>();

    for (const group of groups) {
      for (const result of group) {
        const existing = deduped.get(result.url);
        if (!existing || existing.origin !== 'ai') {
          deduped.set(result.url, result);
        }
      }
    }

    return Array.from(deduped.values());
  }

  private buildPreferredHosts(results: SearchResult[]): Set<string> {
    const hosts = new Set<string>();

    for (const result of results) {
      const hostname = getHostname(result.url);
      if (hostname) {
        hosts.add(hostname);
      }
    }

    return hosts;
  }
}

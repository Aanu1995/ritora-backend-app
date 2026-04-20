import {
  CatalogueSource,
  LookupConfidence,
  LookupWarningCode,
} from '../shelf/shelf.types';
import { CatalogueSuggestionResponseDto } from './dto/catalogue-suggestion-response.dto';
import {
  normalizeBarcode,
  normalizeSearchValue,
} from './product-discovery.utils';

export type InternalCursorTuple = [number, number, string, string, string];
export type SearchStageCursorTuple =
  | ['internal', string]
  | ['external', number];

export type SearchCandidateOrigin = 'cached' | 'external';

export type SearchCandidate = CatalogueSuggestionResponseDto & {
  origin: SearchCandidateOrigin;
};

export type RankedSearchCandidate = SearchCandidate & {
  score: number;
  exactMatch: boolean;
  tokenCoverage: number;
};

export type SearchTextFit = {
  tokenCoverage: number;
  queryHasBundleIntent: boolean;
  candidateLooksLikeBundle: boolean;
  hasUnexpectedProductType: boolean;
};

export const INTERNAL_CURSOR_FINGERPRINT = 'catalogue-db';
export const SEARCH_BEST_MATCH_CACHED_LIMIT = 6;
export const SEARCH_BEST_MATCH_EXTERNAL_LIMIT = 6;
export const BARCODE_QUERY_PATTERN = /^\d{8,14}$/;
const BUNDLE_TERMS = [
  'bundle',
  'bundles',
  'set',
  'kit',
  'duo',
  'trio',
  'combo',
  'collection',
  'routine',
  'regimen',
  'pack',
];
const PRODUCT_TYPE_TOKENS = new Set([
  'cleanser',
  'toner',
  'mist',
  'essence',
  'serum',
  'ampoule',
  'cream',
  'lotion',
  'moisturizer',
  'moisturiser',
  'mask',
  'balm',
  'gel',
  'oil',
  'sunscreen',
  'sun',
  'spf',
  'wash',
  'exfoliant',
  'exfoliator',
  'treatment',
]);

export function tokenizeSearchValue(value: string): string[] {
  return normalizeSearchValue(value)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

export function extractRequestedSizeMl(query: string): number | null {
  const match = query.match(/(\d+(?:[.,]\d+)?)\s*ml\b/i);
  if (!match) {
    return null;
  }

  return Number(match[1].replace(',', '.'));
}

export function uniqueWarnings(
  warnings: LookupWarningCode[],
): LookupWarningCode[] {
  return Array.from(new Set(warnings));
}

export function rankSearchCandidates(
  normalizedQuery: string,
  candidates: SearchCandidate[],
): RankedSearchCandidate[] {
  return candidates
    .map((candidate) => scoreSearchCandidate(normalizedQuery, candidate))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      const leftCombined = normalizeSearchValue(`${left.brand} ${left.name}`);
      const rightCombined = normalizeSearchValue(
        `${right.brand} ${right.name}`,
      );

      return leftCombined.localeCompare(rightCombined);
    });
}

export function hasBundleIntent(value: string): boolean {
  const normalized = normalizeSearchValue(value);

  return (
    BUNDLE_TERMS.some((term) => normalized.includes(term)) ||
    normalized.includes('+') ||
    /\bpack of\b/i.test(normalized)
  );
}

export function analyzeSearchTextFit(
  normalizedQuery: string,
  candidateValue: string,
): SearchTextFit {
  const queryTokens = tokenizeSearchValue(normalizedQuery);
  const candidateTokens = new Set(tokenizeSearchValue(candidateValue));
  const matchedTokenCount = queryTokens.filter((token) =>
    candidateTokens.has(token),
  ).length;
  const tokenCoverage =
    queryTokens.length === 0 ? 0 : matchedTokenCount / queryTokens.length;
  const queryHasBundleIntent = hasBundleIntent(normalizedQuery);
  const candidateLooksLikeBundle = hasBundleIntent(candidateValue);
  const queryProductTypes = new Set(
    queryTokens.filter((token) => PRODUCT_TYPE_TOKENS.has(token)),
  );
  const candidateProductTypes = Array.from(candidateTokens).filter((token) =>
    PRODUCT_TYPE_TOKENS.has(token),
  );
  const hasUnexpectedProductType = candidateProductTypes.some(
    (token) => !queryProductTypes.has(token),
  );

  return {
    tokenCoverage,
    queryHasBundleIntent,
    candidateLooksLikeBundle,
    hasUnexpectedProductType,
  };
}

export function shouldResolveCachedCandidateImmediately(
  bestCandidate: RankedSearchCandidate | undefined,
  secondCandidate: RankedSearchCandidate | undefined,
): boolean {
  if (!bestCandidate || bestCandidate.origin !== 'cached') {
    return false;
  }

  if (!bestCandidate.exactMatch) {
    return false;
  }

  if (!secondCandidate) {
    return true;
  }

  return bestCandidate.score - secondCandidate.score >= 40;
}

export function hasAcceptedBestMatch(
  bestCandidate: RankedSearchCandidate | undefined,
  secondCandidate: RankedSearchCandidate | undefined,
  normalizedQuery: string,
): boolean {
  if (!bestCandidate) {
    return false;
  }

  if (bestCandidate.exactMatch) {
    return true;
  }

  if (bestCandidate.score < 180) {
    return false;
  }

  if (bestCandidate.tokenCoverage < 0.6) {
    return false;
  }

  if (!secondCandidate) {
    return true;
  }

  const queryTokens = tokenizeSearchValue(normalizedQuery);
  const minimumGap = queryTokens.length <= 1 ? 70 : 40;
  const scoreGap = bestCandidate.score - secondCandidate.score;

  if (scoreGap >= minimumGap) {
    return true;
  }

  return (
    bestCandidate.tokenCoverage === 1 &&
    secondCandidate.tokenCoverage < bestCandidate.tokenCoverage
  );
}

function scoreSearchCandidate(
  normalizedQuery: string,
  candidate: SearchCandidate,
): RankedSearchCandidate {
  const normalizedBrand = normalizeSearchValue(candidate.brand);
  const normalizedName = normalizeSearchValue(candidate.name);
  const normalizedCombined = normalizeSearchValue(
    `${candidate.brand} ${candidate.name}`,
  );
  const queryTokens = tokenizeSearchValue(normalizedQuery);
  const candidateTokens = new Set(
    tokenizeSearchValue(`${candidate.brand} ${candidate.name}`),
  );
  const matchedTokenCount = queryTokens.filter((token) =>
    candidateTokens.has(token),
  ).length;
  const {
    tokenCoverage,
    queryHasBundleIntent,
    candidateLooksLikeBundle,
    hasUnexpectedProductType,
  } = analyzeSearchTextFit(
    normalizedQuery,
    `${candidate.brand} ${candidate.name}`,
  );
  const requestedSizeMl = extractRequestedSizeMl(normalizedQuery);
  const normalizedBarcode = candidate.barcode
    ? normalizeBarcode(candidate.barcode)
    : null;
  const exactBarcodeMatch =
    normalizedBarcode !== null && normalizedBarcode === normalizedQuery;
  const exactCombinedMatch = normalizedCombined === normalizedQuery;
  const exactNameMatch = normalizedName === normalizedQuery;
  const exactMatch = exactBarcodeMatch || exactCombinedMatch || exactNameMatch;

  let score = 0;

  if (exactBarcodeMatch) {
    score += 1000;
  }
  if (exactCombinedMatch) {
    score += 500;
  }
  if (exactNameMatch) {
    score += 450;
  }
  if (normalizedBrand === normalizedQuery) {
    score += 120;
  }
  if (normalizedCombined.startsWith(normalizedQuery)) {
    score += 240;
  }
  if (normalizedName.startsWith(normalizedQuery)) {
    score += 220;
  }
  if (normalizedBrand.startsWith(normalizedQuery)) {
    score += 80;
  }
  if (matchedTokenCount > 0) {
    score += matchedTokenCount * 50;
  }
  if (tokenCoverage === 1 && queryTokens.length > 1) {
    score += 100;
  }
  if (requestedSizeMl !== null && candidate.sizeMl === requestedSizeMl) {
    score += 25;
  }
  if (candidateLooksLikeBundle && !queryHasBundleIntent) {
    score -= 260;
  }
  if (hasUnexpectedProductType && !queryHasBundleIntent) {
    score -= 120;
  }

  score += getSourcePriorityScore(candidate);
  score += getConfidenceScore(candidate.confidence);

  if (candidate.reviewRequired) {
    score -= 5;
  }

  return {
    ...candidate,
    score,
    exactMatch,
    tokenCoverage,
  };
}

function getSourcePriorityScore(candidate: SearchCandidate): number {
  let score = candidate.origin === 'cached' ? 25 : 0;

  if (candidate.source === CatalogueSource.RitoraCatalogue) {
    score += 30;
  } else if (candidate.source === CatalogueSource.OfficialPage) {
    score += 20;
  } else if (candidate.source === CatalogueSource.OpenBeautyFacts) {
    score += 10;
  }

  return score;
}

function getConfidenceScore(confidence: LookupConfidence): number {
  if (confidence === LookupConfidence.High) {
    return 30;
  }

  if (confidence === LookupConfidence.Medium) {
    return 15;
  }

  return 0;
}

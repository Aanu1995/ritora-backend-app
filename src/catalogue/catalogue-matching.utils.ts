import { LookupWarningCode } from '../shelf/shelf.types';
import { normalizeSearchValue } from './product-discovery.utils';

export type TextFit = {
  tokenCoverage: number;
  queryHasBundleIntent: boolean;
  candidateLooksLikeBundle: boolean;
  hasUnexpectedProductType: boolean;
};

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

export function tokenizeNormalizedText(value: string): string[] {
  return normalizeSearchValue(value)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

export function uniqueWarnings(
  warnings: LookupWarningCode[],
): LookupWarningCode[] {
  return Array.from(new Set(warnings));
}

function hasBundleIntent(value: string): boolean {
  const normalized = normalizeSearchValue(value);

  return (
    BUNDLE_TERMS.some((term) => normalized.includes(term)) ||
    normalized.includes('+') ||
    /\bpack of\b/i.test(normalized)
  );
}

export function analyzeTextFit(
  normalizedQuery: string,
  candidateValue: string,
): TextFit {
  const queryTokens = tokenizeNormalizedText(normalizedQuery);
  const candidateTokens = new Set(tokenizeNormalizedText(candidateValue));
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

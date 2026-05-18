import {
  AnalysisConfidence,
  type ProductMatchResult,
} from './ingredients.types';

const COMPLETE_INCI_MIN_TOKENS = 5;
const HIGH_CONFIDENCE_MIN_DIRECT_MATCHES = 3;
const HIGH_CONFIDENCE_MIN_STRONG_MATCHES = 4;
const HIGH_CONFIDENCE_MIN_RESOLVED_TOKENS = 4;
const STRONG_MATCH_CONFIDENCE = 0.8;
const DIRECT_MATCH_CONFIDENCE = 0.9;

export function resolveProductCheckConfidence(
  match: ProductMatchResult,
): AnalysisConfidence {
  if (
    match.totalTokens === 0 ||
    match.resolvedTokens === 0 ||
    match.matchedIngredients.length === 0
  ) {
    return AnalysisConfidence.Low;
  }

  const matchedIngredientCount = match.matchedIngredients.length;
  const strongMatchCount = match.matchedIngredients.filter(
    (matched) => matched.confidence >= STRONG_MATCH_CONFIDENCE,
  ).length;
  const directMatchCount = match.matchedIngredients.filter(
    (matched) => matched.confidence >= DIRECT_MATCH_CONFIDENCE,
  ).length;
  const tokenRatio = match.resolvedTokens / match.totalTokens;

  if (match.totalTokens >= COMPLETE_INCI_MIN_TOKENS) {
    if (strongMatchCount === 0) {
      return AnalysisConfidence.Low;
    }

    if (
      directMatchCount >= HIGH_CONFIDENCE_MIN_DIRECT_MATCHES ||
      (match.resolvedTokens >= HIGH_CONFIDENCE_MIN_RESOLVED_TOKENS &&
        directMatchCount >= 2) ||
      strongMatchCount >= HIGH_CONFIDENCE_MIN_STRONG_MATCHES
    ) {
      return AnalysisConfidence.High;
    }

    return AnalysisConfidence.Medium;
  }

  if (
    (tokenRatio === 1 && strongMatchCount === matchedIngredientCount) ||
    (match.resolvedTokens >= HIGH_CONFIDENCE_MIN_DIRECT_MATCHES &&
      directMatchCount >= 2)
  ) {
    return AnalysisConfidence.High;
  }

  if (strongMatchCount === 0) {
    return AnalysisConfidence.Low;
  }

  return AnalysisConfidence.Medium;
}

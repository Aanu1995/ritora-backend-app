import {
  SuggestionGapActionKind,
  SuggestionGapRecommendationJson,
  SuggestionGapRecommendationResponseJson,
} from '../suggestions.constants';

export function normalizeSuggestionGapKey(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'gap';
}

export function applyGapRecommendationActions(
  gaps: SuggestionGapRecommendationJson[] | null,
  actionByKey?: ReadonlyMap<string, SuggestionGapActionKind>,
): SuggestionGapRecommendationResponseJson[] {
  return (gaps ?? []).flatMap((gap) => {
    const key = normalizeSuggestionGapKey(gap.ingredientOrCategory);
    const action = actionByKey?.get(key) ?? null;
    if (action === 'dismissed') return [];
    return [{ ...gap, userAction: action }];
  });
}

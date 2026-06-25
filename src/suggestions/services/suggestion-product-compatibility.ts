import type { SuggestionProductScore } from '../suggestion-context.types';

const LAYERING_WARNING_PATTERN =
  /(?:do not|don't|avoid|separate|split|alternate).{0,60}(?:layer|combine|mix|same routine|together|from|with)|(?:layer|combine|mix).{0,60}(?:irritat|unstable|less comfortable|not recommended)/i;

const ACTIVE_GROUP_TEXT: Record<string, string[]> = {
  retinoid: ['retinol', 'retinal', 'retinoid', 'retinoids'],
  aha: ['aha', 'alpha hydroxy', 'glycolic', 'lactic', 'mandelic'],
  bha: ['bha', 'beta hydroxy', 'salicylic'],
  pha: ['pha', 'polyhydroxy', 'gluconolactone', 'lactobionic'],
  vitamin_c: ['vitamin c', 'ascorbic', 'ascorbyl'],
  benzoyl_peroxide: ['benzoyl peroxide'],
  azelaic_acid: ['azelaic acid'],
  niacinamide: ['niacinamide'],
};

export function hasIngredientAnalysisLayeringConflict(
  left: SuggestionProductScore,
  right: SuggestionProductScore,
): boolean {
  if (left.productId === right.productId) return false;
  return [
    ...(left.ingredientConflicts ?? []),
    ...(right.ingredientConflicts ?? []),
  ].some(
    (conflict) =>
      conflict.productIds.includes(left.productId) &&
      conflict.productIds.includes(right.productId),
  );
}

export function hasSpecificTextLayeringConflict(
  left: SuggestionProductScore,
  right: SuggestionProductScore,
): boolean {
  return (
    hasLayeringWarningAgainstProduct(left, right) ||
    hasLayeringWarningAgainstProduct(right, left)
  );
}

function hasLayeringWarningAgainstProduct(
  source: SuggestionProductScore,
  target: SuggestionProductScore,
): boolean {
  const warnings = [
    ...source.cautionReasons,
    ...(source.guidanceCautions ?? []),
  ].filter((warning) => LAYERING_WARNING_PATTERN.test(warning));

  return warnings.some(
    (warning) =>
      mentionsProduct(warning, target) || mentionsTargetActive(warning, target),
  );
}

function mentionsProduct(
  text: string,
  product: SuggestionProductScore,
): boolean {
  const normalized = normalizeText(text);
  const candidates = [product.name, `${product.brand} ${product.name}`]
    .map(normalizeText)
    .filter((value) => value.length >= 4);
  return candidates.some((candidate) => normalized.includes(candidate));
}

function mentionsTargetActive(
  text: string,
  product: SuggestionProductScore,
): boolean {
  const normalized = normalizeText(text);
  const activePhrases = product.activeTags.flatMap(
    (tag) => ACTIVE_GROUP_TEXT[tag] ?? [tag.replaceAll('_', ' ')],
  );
  if (
    product.activeTags.length > 0 &&
    /(?:other|another|multiple).{0,20}(?:active|strong active|acid|exfoliant)/i.test(
      text,
    )
  ) {
    return true;
  }
  return activePhrases
    .map(normalizeText)
    .filter((value) => value.length >= 3)
    .some((phrase) => normalized.includes(phrase));
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9%+ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

import { LookupConfidence, LookupWarningCode } from '../shelf/shelf.types';
import { uniqueWarnings } from './catalogue-matching.utils';
import type { ResolvedProductDraft } from './product-discovery.types';
import { refineCategoryFromText } from './product-discovery.utils';

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

export function needsOfficialPageCompletion(
  resolved: ResolvedProductDraft,
): boolean {
  return (
    !resolved.identity.description ||
    !resolved.identity.benefits?.length ||
    hasLikelyTruncatedIngredients(resolved.identity.inciIngredients) ||
    !resolved.identity.suitedFor?.length ||
    !resolved.guidance.cautions?.length ||
    !resolved.guidance.applicationMethod ||
    !resolved.guidance.quantity ||
    !resolved.manufacturer.parentCompany ||
    !resolved.manufacturer.countryOfManufacture ||
    !resolved.manufacturer.supportEmail
  );
}

export function needsDiscoveryCompletion(
  resolved: ResolvedProductDraft,
): boolean {
  const missingProductFacts =
    !resolved.identity.description ||
    !resolved.identity.benefits?.length ||
    hasLikelyTruncatedIngredients(resolved.identity.inciIngredients) ||
    !resolved.identity.suitedFor?.length ||
    !resolved.identity.inciIngredients?.length ||
    !resolved.guidance.steps?.length ||
    !resolved.guidance.cautions?.length ||
    !resolved.guidance.applicationMethod ||
    !resolved.guidance.quantity;

  if (!missingProductFacts) {
    return false;
  }

  if (!resolved.identity.brand && !resolved.manufacturer.brand) {
    return false;
  }

  return Boolean(resolved.identity.name || resolved.identity.barcode);
}

export function refineResolvedCategory(
  resolved: ResolvedProductDraft,
): ResolvedProductDraft {
  return {
    ...resolved,
    identity: {
      ...resolved.identity,
      category: refineCategoryFromText(
        resolved.identity.category,
        resolved.manufacturer.brand,
        resolved.identity.brand,
        resolved.identity.name,
        resolved.identity.description,
        resolved.identity.benefits,
        resolved.identity.suitedFor,
      ),
    },
  };
}

export function finalizeResolved(
  resolved: ResolvedProductDraft,
): ResolvedProductDraft {
  const hasGuidance =
    Boolean(resolved.guidance.applicationMethod) ||
    Boolean(resolved.guidance.quantity) ||
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

  return {
    ...resolved,
    confidence:
      hasRichData || hasPhotoIdentity
        ? LookupConfidence.Medium
        : LookupConfidence.Low,
    reviewRequired: true,
    warnings: uniqueWarnings([
      ...resolved.warnings,
      ...(hasRichData ? [] : [LookupWarningCode.PartialData]),
    ]),
  };
}

function hasLikelyTruncatedIngredients(
  ingredients: string[] | null | undefined,
): boolean {
  if (!ingredients?.length) {
    return false;
  }

  const normalized = ingredients
    .at(-1)
    ?.trim()
    .toLowerCase()
    .replace(/[.,;:\s/]+$/g, '');

  return Boolean(normalized && TRUNCATED_INGREDIENT_PREFIXES.has(normalized));
}

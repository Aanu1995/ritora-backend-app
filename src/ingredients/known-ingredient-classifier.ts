import {
  applyCategorySafetyDefaults,
  defaultOverlapSeverityForCategory,
} from './ingredient-safety-rules';
import type { IngredientClassification } from './ingredient-classifier.port';
import { IngredientCategory } from './ingredients.types';

const KNOWN_INGREDIENT_CONFIDENCE = 0.68;

type KnownIngredientRule = {
  category: IngredientCategory;
  canonicalName: string;
  irritationRisk?: boolean;
  match: RegExp;
  overlapSeverity?: IngredientClassification['overlapSeverity'];
  photosensitizing?: boolean;
  phSensitive?: boolean | ((normalizedToken: string) => boolean);
  requiresSpf?: boolean;
  summaryEn: string;
};

const KNOWN_INGREDIENT_RULES: readonly KnownIngredientRule[] = [
  {
    canonicalName: 'Retinoid',
    category: IngredientCategory.Retinoid,
    irritationRisk: true,
    match:
      /\b(retinol|retinal(?:dehyde)?|retinyl\s+\w+|hydroxypinacolone retinoate|tretinoin|adapalene|retinoate)\b/,
    photosensitizing: true,
    requiresSpf: true,
    summaryEn: 'A vitamin A style active associated with renewal support.',
  },
  {
    canonicalName: 'Alpha hydroxy acid',
    category: IngredientCategory.Aha,
    irritationRisk: true,
    match:
      /\b(glycolic acid|lactic acid|mandelic acid|malic acid|tartaric acid|citric acid)\b/,
    photosensitizing: true,
    phSensitive: true,
    requiresSpf: true,
    summaryEn: 'An exfoliating acid category that can increase sensitivity.',
  },
  {
    canonicalName: 'Beta hydroxy acid',
    category: IngredientCategory.Bha,
    irritationRisk: true,
    match: /\b(salicylic acid|betaine salicylate|willow bark)\b/,
    summaryEn:
      'An exfoliating acid category often used for pores or blemishes.',
  },
  {
    canonicalName: 'Polyhydroxy acid',
    category: IngredientCategory.Pha,
    irritationRisk: true,
    match: /\b(gluconolactone|lactobionic acid|maltobionic acid)\b/,
    photosensitizing: true,
    phSensitive: true,
    requiresSpf: true,
    summaryEn: 'A gentler exfoliating acid category.',
  },
  {
    canonicalName: 'Benzoyl peroxide',
    category: IngredientCategory.BenzoylPeroxide,
    irritationRisk: true,
    match: /\bbenzoyl peroxide\b/,
    summaryEn: 'An acne-focused active that can be drying or irritating.',
  },
  {
    canonicalName: 'Vitamin C',
    category: IngredientCategory.VitaminC,
    match:
      /\b(l-ascorbic acid|ascorbic acid|ethyl ascorbic acid|ascorbyl glucoside|sodium ascorbyl phosphate|magnesium ascorbyl phosphate|tetrahexyldecyl ascorbate|ascorbyl tetraisopalmitate)\b/,
    phSensitive: (token) => /\b(l-ascorbic acid|ascorbic acid)\b/.test(token),
    summaryEn: 'An antioxidant brightening active in the vitamin C family.',
  },
  {
    canonicalName: 'Niacinamide',
    category: IngredientCategory.Niacinamide,
    match: /\bniacinamide\b/,
    summaryEn: 'A barrier and tone support active.',
  },
  {
    canonicalName: 'Hydroquinone',
    category: IngredientCategory.Hydroquinone,
    irritationRisk: true,
    match: /\bhydroquinone\b/,
    photosensitizing: true,
    requiresSpf: true,
    summaryEn: 'A strong brightening active that needs cautious use.',
  },
  {
    canonicalName: 'Azelaic acid',
    category: IngredientCategory.AzelaicAcid,
    irritationRisk: true,
    match: /\bazelaic acid\b/,
    summaryEn: 'A multi-purpose active used for tone, redness, and blemishes.',
  },
  {
    canonicalName: 'Tyrosinase inhibitor',
    category: IngredientCategory.TyrosinaseInhibitor,
    match:
      /\b(alpha[-\s]?arbutin|arbutin|kojic acid|tranexamic acid|licorice|glycyrrhiza)\b/,
    summaryEn: 'A brightening-support category that targets uneven tone.',
  },
  {
    canonicalName: 'Bakuchiol',
    category: IngredientCategory.Bakuchiol,
    match: /\bbakuchiol\b/,
    summaryEn: 'A retinoid-adjacent cosmetic active.',
  },
  {
    canonicalName: 'Sulphur',
    category: IngredientCategory.Sulphur,
    irritationRisk: true,
    match: /\b(sulfur|sulphur)\b/,
    summaryEn: 'A blemish-focused active that can be drying.',
  },
  {
    canonicalName: 'Peptide',
    category: IngredientCategory.Peptide,
    match:
      /\b(peptide|palmitoyl|tripeptide|tetrapeptide|hexapeptide|copper tripeptide|acetyl hexapeptide)\b/,
    summaryEn: 'A peptide-family ingredient used for skin support.',
  },
  {
    canonicalName: 'Ceramides',
    category: IngredientCategory.Barrier,
    match: /\b(ceramide|cholesterol|phytosphingosine|squalane|panthenol)\b/,
    summaryEn: 'A barrier-supporting ingredient family.',
  },
  {
    canonicalName: 'Hyaluronic acid',
    category: IngredientCategory.Humectant,
    match:
      /\b(glycerin|hyaluronic acid|sodium hyaluronate|hyaluronate|betaine|urea|propylene glycol|butylene glycol|sorbitol|aloe)\b/,
    summaryEn: 'A hydration-supporting humectant ingredient family.',
  },
  {
    canonicalName: 'Antioxidant',
    category: IngredientCategory.Antioxidant,
    match:
      /\b(tocopherol|vitamin e|ferulic acid|resveratrol|green tea|camellia sinensis|ubiquinone|coenzyme q10)\b/,
    summaryEn: 'An antioxidant-support ingredient family.',
  },
  {
    canonicalName: 'Mineral sunscreen filter',
    category: IngredientCategory.MineralSpf,
    match: /\b(zinc oxide|titanium dioxide)\b/,
    requiresSpf: true,
    summaryEn: 'A mineral sunscreen filter.',
  },
  {
    canonicalName: 'Chemical sunscreen filter',
    category: IngredientCategory.ChemicalSpf,
    match:
      /\b(avobenzone|octocrylene|octinoxate|octisalate|homosalate|ensulizole|oxybenzone|tinosorb|uvinul|mexoryl|bemotrizinol|bisoctrizole|diethylamino hydroxybenzoyl hexyl benzoate|ethylhexyl triazone)\b/,
    requiresSpf: true,
    summaryEn: 'A chemical sunscreen filter.',
  },
] as const;

export function completeKnownIngredientClassifications(
  requestedTokens: readonly string[],
  classifications: readonly IngredientClassification[],
): IngredientClassification[] {
  const classificationsByToken = new Map(
    classifications.map((classification) => [
      normalizeTokenKey(classification.rawToken),
      classification,
    ]),
  );

  for (const rawToken of requestedTokens) {
    const tokenKey = normalizeTokenKey(rawToken);
    if (!tokenKey || classificationsByToken.has(tokenKey)) {
      continue;
    }

    const fallback = classifyKnownIngredient(rawToken);
    if (fallback) {
      classificationsByToken.set(tokenKey, fallback);
    }
  }

  return requestedTokens.flatMap((rawToken) => {
    const classification = classificationsByToken.get(
      normalizeTokenKey(rawToken),
    );
    return classification ? [classification] : [];
  });
}

function classifyKnownIngredient(
  rawToken: string,
): IngredientClassification | null {
  const normalizedToken = normalizeTokenKey(rawToken);
  const rule = KNOWN_INGREDIENT_RULES.find((candidate) =>
    candidate.match.test(normalizedToken),
  );
  if (!rule) {
    return null;
  }

  const guarded = applyCategorySafetyDefaults({
    category: rule.category,
    irritationRisk: rule.irritationRisk ?? false,
    overlapSeverity:
      rule.overlapSeverity ?? defaultOverlapSeverityForCategory(rule.category),
    phSensitive:
      typeof rule.phSensitive === 'function'
        ? rule.phSensitive(normalizedToken)
        : (rule.phSensitive ?? false),
    photosensitizing: rule.photosensitizing ?? false,
    requiresSpf: rule.requiresSpf ?? false,
  });

  return {
    rawToken,
    canonicalName: canonicalNameForToken(rawToken, rule),
    category: rule.category,
    confidence: KNOWN_INGREDIENT_CONFIDENCE,
    summaryEn: rule.summaryEn,
    ...guarded,
  };
}

function canonicalNameForToken(
  rawToken: string,
  rule: KnownIngredientRule,
): string {
  const trimmed = rawToken.trim().replace(/\s+/g, ' ');
  if (!trimmed) {
    return rule.canonicalName;
  }
  if (
    [
      IngredientCategory.Barrier,
      IngredientCategory.Humectant,
      IngredientCategory.Antioxidant,
      IngredientCategory.MineralSpf,
      IngredientCategory.ChemicalSpf,
    ].includes(rule.category)
  ) {
    return titleCase(trimmed);
  }
  return rule.canonicalName;
}

function normalizeTokenKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (match) => match.toUpperCase());
}

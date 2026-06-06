import {
  applyCategorySafetyDefaults,
  categorySummary,
  defaultOverlapSeverityForCategory,
} from './ingredient-safety-rules';
import type { IngredientClassification } from './ingredient-classifier.port';
import { AnalysisSeverity, IngredientCategory } from './ingredients.types';

const MAX_TOKEN_CHARS = 100;
const MIN_ACCEPTED_CONFIDENCE = 0.5;
export const INGREDIENT_CLASSIFICATION_CONTRACT_VERSION = 'v2';
export const INGREDIENT_CLASSIFICATION_UNKNOWN_CATEGORY = 'unknown';

export const INGREDIENT_CLASSIFICATION_REQUEST_CATEGORY_VALUES =
  Object.values(IngredientCategory);
export const INGREDIENT_CLASSIFICATION_REQUEST_SEVERITY_VALUES =
  Object.values(AnalysisSeverity);

type ParsedIngredientClassification = {
  rawToken?: unknown;
  canonicalName?: unknown;
  category?: unknown;
  confidence?: unknown;
  summaryEn?: unknown;
  phSensitive?: unknown;
  photosensitizing?: unknown;
  requiresSpf?: unknown;
  irritationRisk?: unknown;
  overlapSeverity?: unknown;
};

export type ParsedIngredientClassificationResponse = {
  classifications?: ParsedIngredientClassification[];
};

export const INGREDIENT_CLASSIFICATION_RESPONSE_FORMAT = {
  type: 'json_schema',
  name: 'ritora_ingredient_classification',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['classifications'],
    properties: {
      classifications: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'rawToken',
            'canonicalName',
            'category',
            'confidence',
            'summaryEn',
            'phSensitive',
            'photosensitizing',
            'requiresSpf',
            'irritationRisk',
            'overlapSeverity',
          ],
          properties: {
            rawToken: { type: 'string' },
            canonicalName: { type: 'string' },
            category: {
              type: 'string',
              enum: [
                ...INGREDIENT_CLASSIFICATION_REQUEST_CATEGORY_VALUES,
                INGREDIENT_CLASSIFICATION_UNKNOWN_CATEGORY,
              ],
            },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            summaryEn: { type: 'string' },
            phSensitive: { type: 'boolean' },
            photosensitizing: { type: 'boolean' },
            requiresSpf: { type: 'boolean' },
            irritationRisk: { type: 'boolean' },
            overlapSeverity: {
              type: 'string',
              enum: INGREDIENT_CLASSIFICATION_REQUEST_SEVERITY_VALUES,
            },
          },
        },
      },
    },
  },
} as const;

export function ingredientClassificationSystemPrompt(): string {
  return [
    'Role: act as a cosmetic INCI token safety classifier for Ritora ingredient analysis.',
    'Task: classify each supplied token by its cosmetic ingredient role and routine-safety relevance.',
    'Decision inputs:',
    '- tokens: the exact ingredient tokens to classify.',
    '- allowedCategories: the only category enum values you may use.',
    `- unknownCategory: use "${INGREDIENT_CLASSIFICATION_UNKNOWN_CATEGORY}" for tokens that do not name an allowed category, a common synonym of an allowed category, or an ingredient role covered by allowedCategories.`,
    '- severityValues: the only overlapSeverity enum values you may use.',
    'Hard rules:',
    '- Return exactly one classification object for every token in tokens.',
    '- Preserve rawToken exactly as supplied. Do not rewrite, merge, split, translate, or add tokens.',
    '- Do not invent ingredients, related ingredients, product claims, usage instructions, diagnoses, treatments, or prescriptions.',
    '- Classify by cosmetic ingredient role and the token text only. Do not classify from marketing claims. Never use user profile, product category, product marketing, routine goals, or assumed product type.',
    '- Use only allowed category, severity, and boolean fields from the schema.',
    'Category selection policy:',
    '- Map only to allowedCategories. High-overlap active categories are retinoid, aha, bha, benzoyl-peroxide, and hydroquinone.',
    '- Medium-overlap active categories are pha, vitamin-c, azelaic-acid, and tyrosinase-inhibitor.',
    '- Supportive categories are niacinamide, bakuchiol, sulphur, peptide, barrier, humectant, antioxidant, mineral-spf, and chemical-spf only when the token is an INCI name, common synonym, or unambiguous filter/active name for that role.',
    '- For ambiguous botanical blends, extract names, unclear trade names, or generic complexes, classify only when the token text itself names an allowed category or common synonym; otherwise use unknown.',
    '- For generic bases, solvents, fragrance, emulsifiers, preservatives, colorants, texture agents, or pH adjusters, use unknown unless the token explicitly matches an allowed safety category.',
    'Safety flag policy:',
    '- Set irritationRisk=true for retinoid, aha, bha, pha, benzoyl-peroxide, hydroquinone, sulphur, or a token that explicitly indicates an irritating active.',
    '- Photosensitizing or SPF-support categories are retinoid, aha, bha, pha, and hydroquinone; set photosensitizing=true and requiresSpf=true for those categories.',
    '- Set phSensitive=true for aha and for vitamin-c only when the token indicates low-pH ascorbic acid style vitamin C.',
    '- Choose overlapSeverity from severityValues by category: high for high-overlap active categories, medium for medium-overlap active categories, low for supportive categories and unknown.',
    'Unknown policy:',
    `- Use category "${INGREDIENT_CLASSIFICATION_UNKNOWN_CATEGORY}" when the token does not name an allowed safety category, active class, sunscreen filter, barrier ingredient, humectant, antioxidant, or support ingredient covered by allowedCategories, or when the category is uncertain.`,
    '- Unknown classifications must still keep the original rawToken and conservative false safety flags unless the token directly supports a flag.',
    'Output format:',
    'Keep JSON keys, enum values, severity values, category values, and original token strings exactly as provided by the schema/input.',
    'summaryEn must be a short English ingredient-role summary based only on the token, not product marketing.',
    'Return JSON only.',
  ].join(' ');
}

export function cleanClassificationTokens(tokens: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];

  for (const token of tokens) {
    const trimmed = token.trim().replace(/\s+/g, ' ');
    const key = normalizeTokenKey(trimmed);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    cleaned.push(trimmed.slice(0, MAX_TOKEN_CHARS));
  }

  return cleaned;
}

export function sanitizeClassifications(input: {
  parsed: ParsedIngredientClassification[] | undefined;
  requestedTokens: string[];
}): IngredientClassification[] {
  const requestedByKey = new Map(
    input.requestedTokens.map((token) => [normalizeTokenKey(token), token]),
  );
  const classifications: IngredientClassification[] = [];
  const acceptedKeys = new Set<string>();

  for (const item of input.parsed ?? []) {
    const rawToken = stringOrNull(item.rawToken);
    const rawKey = rawToken ? normalizeTokenKey(rawToken) : '';
    const requestedToken = requestedByKey.get(rawKey);
    if (!requestedToken || acceptedKeys.has(rawKey)) {
      continue;
    }

    const category = parseIngredientCategory(item.category);
    const confidence = finiteNumber(item.confidence);
    if (
      !category ||
      confidence === null ||
      confidence < MIN_ACCEPTED_CONFIDENCE
    ) {
      continue;
    }

    const canonicalName =
      sanitizeText(stringOrNull(item.canonicalName), 80) ?? requestedToken;
    const overlapSeverity =
      parseAnalysisSeverity(item.overlapSeverity) ??
      defaultOverlapSeverityForCategory(category);
    const guarded = applyCategorySafetyDefaults({
      category,
      phSensitive: booleanValue(item.phSensitive),
      photosensitizing: booleanValue(item.photosensitizing),
      requiresSpf: booleanValue(item.requiresSpf),
      irritationRisk: booleanValue(item.irritationRisk),
      overlapSeverity,
    });

    classifications.push({
      rawToken: requestedToken,
      canonicalName,
      category,
      confidence: Math.min(Math.max(confidence, 0), 0.82),
      summaryEn:
        sanitizeText(stringOrNull(item.summaryEn), 180) ??
        categorySummary(canonicalName, category),
      ...guarded,
    });
    acceptedKeys.add(rawKey);
  }

  return classifications;
}

function normalizeTokenKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function sanitizeText(value: string | null, maxLength: number): string | null {
  if (!value) {
    return null;
  }

  const cleaned = replaceControlCharacters(value).trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function replaceControlCharacters(value: string): string {
  let output = '';

  for (const character of value) {
    const code = character.charCodeAt(0);
    output += code <= 31 || code === 127 ? ' ' : character;
  }

  return output;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function parseIngredientCategory(value: unknown): IngredientCategory | null {
  if (
    typeof value !== 'string' ||
    value === INGREDIENT_CLASSIFICATION_UNKNOWN_CATEGORY ||
    !INGREDIENT_CLASSIFICATION_REQUEST_CATEGORY_VALUES.includes(
      value as IngredientCategory,
    )
  ) {
    return null;
  }

  return value as IngredientCategory;
}

function parseAnalysisSeverity(value: unknown): AnalysisSeverity | null {
  if (
    typeof value !== 'string' ||
    !INGREDIENT_CLASSIFICATION_REQUEST_SEVERITY_VALUES.includes(
      value as AnalysisSeverity,
    )
  ) {
    return null;
  }

  return value as AnalysisSeverity;
}

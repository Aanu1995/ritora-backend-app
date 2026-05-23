import {
  applyCategorySafetyDefaults,
  categorySummary,
  defaultOverlapSeverityForCategory,
} from './ingredient-safety-rules';
import type { IngredientClassification } from './ingredient-classifier.port';
import { AnalysisSeverity, IngredientCategory } from './ingredients.types';

const MAX_TOKEN_CHARS = 100;
const MIN_ACCEPTED_CONFIDENCE = 0.5;
export const INGREDIENT_CLASSIFICATION_CONTRACT_VERSION = 'v1';
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
    'You classify cosmetic INCI tokens for Ritora routine-safety analysis.',
    'Return one classification per token when possible.',
    `Use only the allowed category enum, or "${INGREDIENT_CLASSIFICATION_UNKNOWN_CATEGORY}" when the token is not useful for skincare safety analysis.`,
    'Do not diagnose, prescribe, or invent ingredients that are not present.',
    'Classify by cosmetic ingredient role, not by marketing claims.',
    'For low-pH acids, retinoid-like actives, exfoliating acids, acne actives, brighteners, peptides, barrier ingredients, humectants, antioxidants, and sunscreen filters, choose the closest allowed safety category.',
    'For generic bases, solvents, fragrance, emulsifiers, preservatives, colorants, texture agents, or ambiguous blends, use unknown unless a safety category is clearly supported by the token.',
    'Use conservative safety flags; when unsure, prefer irritationRisk true for strong actives and unknown for unclear tokens.',
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

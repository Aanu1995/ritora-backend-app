import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  INGREDIENT_CLASSIFIER_PORT,
  type IngredientClassification,
  type IngredientClassifierPort,
} from './ingredient-classifier.port';
import type { IngredientAnalysisAiTrackingContext } from './ingredient-analysis-ai-usage-metrics';
import {
  applyCategorySafetyDefaults,
  categorySummary,
} from './ingredient-safety-rules';
import type {
  IngredientDefinition,
  MatchedIngredient,
  ProductForAnalysis,
  ProductMatchResult,
} from './ingredients.types';

export const MAX_UNIQUE_INGREDIENT_CLASSIFICATION_TOKENS_PER_ANALYSIS = 150;

@Injectable()
export class IngredientIntelligenceService {
  private readonly logger = new Logger(IngredientIntelligenceService.name);

  constructor(
    @Inject(INGREDIENT_CLASSIFIER_PORT)
    private readonly classifier: IngredientClassifierPort,
  ) {}

  async matchProduct(
    product: ProductForAnalysis,
    tracking?: IngredientAnalysisAiTrackingContext,
  ): Promise<ProductMatchResult> {
    const [result] = await this.matchProducts([product], tracking);
    return result;
  }

  async matchProducts(
    products: ProductForAnalysis[],
    tracking?: IngredientAnalysisAiTrackingContext,
  ): Promise<ProductMatchResult[]> {
    const tokenSelection = uniqueTokens(
      products.flatMap((product) => product.inciIngredients),
      MAX_UNIQUE_INGREDIENT_CLASSIFICATION_TOKENS_PER_ANALYSIS,
    );
    if (tokenSelection.droppedTokenCount > 0) {
      this.logger.warn(
        JSON.stringify({
          event: 'ingredient_classification_token_cap_applied',
          classifiedTokenLimit:
            MAX_UNIQUE_INGREDIENT_CLASSIFICATION_TOKENS_PER_ANALYSIS,
          droppedTokenCount: tokenSelection.droppedTokenCount,
        }),
      );
    }

    const classifications = await this.classifySafely(
      tokenSelection.tokens,
      tracking,
    );
    const classificationsByToken = new Map(
      classifications.map((classification) => [
        normalizeTokenKey(classification.rawToken),
        classification,
      ]),
    );

    return products.map((product) =>
      this.matchProductFromClassifications(product, classificationsByToken),
    );
  }

  private async classifySafely(
    tokens: string[],
    tracking?: IngredientAnalysisAiTrackingContext,
  ): Promise<IngredientClassification[]> {
    if (tokens.length === 0) {
      return [];
    }

    try {
      return await this.classifier.classify(
        tracking ? { tokens, tracking } : { tokens },
      );
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'ingredient_classification_unavailable',
          tokenCount: tokens.length,
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
      );
      return [];
    }
  }

  private matchProductFromClassifications(
    product: ProductForAnalysis,
    classificationsByToken: ReadonlyMap<string, IngredientClassification>,
  ): ProductMatchResult {
    const matchedIngredients = new Map<string, MatchedIngredient>();
    const unresolvedTokens: string[] = [];
    let totalTokens = 0;
    let resolvedTokens = 0;

    for (const rawToken of product.inciIngredients) {
      const token = rawToken.trim();
      if (!token) {
        continue;
      }

      totalTokens += 1;
      const classification = classificationsByToken.get(
        normalizeTokenKey(token),
      );
      if (!classification) {
        unresolvedTokens.push(rawToken);
        continue;
      }

      resolvedTokens += 1;
      const match = toMatchedIngredient(classification);
      const current = matchedIngredients.get(match.ingredient.slug);
      if (!current || current.confidence < match.confidence) {
        matchedIngredients.set(match.ingredient.slug, match);
      }
    }

    return {
      product,
      matchedIngredients: Array.from(matchedIngredients.values()),
      unresolvedTokens,
      totalTokens,
      resolvedTokens,
    };
  }
}

function toMatchedIngredient(
  classification: IngredientClassification,
): MatchedIngredient {
  const guarded = applyCategorySafetyDefaults(classification);
  const displayName = cleanDisplayName(classification.canonicalName);
  const slug = slugify(displayName) || slugify(classification.rawToken);
  const ingredient: IngredientDefinition = {
    slug,
    displayNameEn: displayName,
    summaryEn:
      cleanSummary(classification.summaryEn) ??
      categorySummary(displayName, classification.category),
    category: classification.category,
    aliases: [],
    categoryPatterns: [],
    overlapSeverity: guarded.overlapSeverity,
    phSensitive: guarded.phSensitive || undefined,
    photosensitizing: guarded.photosensitizing || undefined,
    requiresSpf: guarded.requiresSpf || undefined,
    irritationRisk: guarded.irritationRisk || undefined,
  };

  return {
    ingredient,
    rawToken: classification.rawToken,
    normalizedSlug: slug,
    concentrationPct: extractConcentrationPct(classification.rawToken),
    confidence: Math.min(Math.max(classification.confidence, 0), 0.82),
    inferred: true,
  };
}

function uniqueTokens(
  tokens: string[],
  limit: number,
): { tokens: string[]; droppedTokenCount: number } {
  const seen = new Set<string>();
  const unique: string[] = [];
  let droppedTokenCount = 0;

  for (const token of tokens) {
    const trimmed = token.trim().replace(/\s+/g, ' ');
    const key = normalizeTokenKey(trimmed);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    if (unique.length >= limit) {
      droppedTokenCount += 1;
      continue;
    }

    unique.push(trimmed);
  }

  return { tokens: unique, droppedTokenCount };
}

function normalizeTokenKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

function cleanDisplayName(value: string): string {
  const cleaned = replaceControlCharacters(value).trim();
  return cleaned ? cleaned.slice(0, 80) : 'Classified ingredient';
}

function cleanSummary(value: string): string | null {
  const cleaned = replaceControlCharacters(value).trim();
  return cleaned ? cleaned.slice(0, 180) : null;
}

function replaceControlCharacters(value: string): string {
  let output = '';

  for (const character of value) {
    const code = character.charCodeAt(0);
    output += code <= 31 || code === 127 ? ' ' : character;
  }

  return output;
}

function extractConcentrationPct(rawToken: string): number | null {
  const concentrationMatch = rawToken.match(/(\d+(?:\.\d+)?)\s*%/);
  return concentrationMatch ? Number(concentrationMatch[1]) : null;
}

import { Injectable } from '@nestjs/common';
import { IngredientCatalogService } from './ingredient-catalog.service';
import type {
  MatchedIngredient,
  ProductForAnalysis,
  ProductMatchResult,
} from './ingredients.types';

type NormalizedToken = {
  normalizedSlug: string;
  concentrationPct: number | null;
};

/**
 * Normalises raw INCI tokens and resolves them to catalogue ingredients
 * via three confidence bands: exact slug → alias → category regex.
 *
 * All catalogue lookups go through IngredientCatalogService — no hardcoded
 * arrays live here.
 */
@Injectable()
export class MatchingService {
  constructor(private readonly catalog: IngredientCatalogService) {}

  normalizeToken(rawToken: string): NormalizedToken {
    const concentrationMatch = rawToken.match(/(\d+(?:\.\d+)?)\s*%/);
    const concentrationPct = concentrationMatch
      ? Number(concentrationMatch[1])
      : null;
    const withoutConcentration = rawToken.replace(/(\d+(?:\.\d+)?)\s*%/g, ' ');
    const normalizedSlug = withoutConcentration
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\([^)]*\)/g, ' ')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, '-');

    return {
      normalizedSlug,
      concentrationPct,
    };
  }

  matchProduct(product: ProductForAnalysis): ProductMatchResult {
    const matchedIngredients = new Map<string, MatchedIngredient>();
    const unresolvedTokens: string[] = [];
    let totalTokens = 0;
    let resolvedTokens = 0;

    for (const rawToken of product.inciIngredients) {
      if (!rawToken.trim()) {
        continue;
      }

      totalTokens += 1;
      const normalized = this.normalizeToken(rawToken);

      if (!normalized.normalizedSlug) {
        unresolvedTokens.push(rawToken);
        continue;
      }

      const match = this.matchToken(rawToken, normalized);
      if (!match) {
        unresolvedTokens.push(rawToken);
        continue;
      }

      resolvedTokens += 1;
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

  private matchToken(
    rawToken: string,
    normalized: NormalizedToken,
  ): MatchedIngredient | null {
    const exact = this.catalog.getIngredientBySlug(normalized.normalizedSlug);
    if (exact) {
      return {
        ingredient: exact,
        rawToken,
        normalizedSlug: normalized.normalizedSlug,
        concentrationPct: normalized.concentrationPct,
        confidence: 1,
        inferred: false,
      };
    }

    const alias = this.catalog.getIngredientByAlias(normalized.normalizedSlug);
    if (alias) {
      return {
        ingredient: alias,
        rawToken,
        normalizedSlug: normalized.normalizedSlug,
        concentrationPct: normalized.concentrationPct,
        confidence: 0.9,
        inferred: false,
      };
    }

    for (const fallback of this.catalog.getCategoryFallbacks()) {
      if (!fallback.pattern.test(normalized.normalizedSlug)) {
        continue;
      }
      return {
        ingredient: fallback.ingredient,
        rawToken,
        normalizedSlug: normalized.normalizedSlug,
        concentrationPct: normalized.concentrationPct,
        confidence: 0.6,
        inferred: true,
      };
    }

    return null;
  }
}

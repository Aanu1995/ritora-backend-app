import { Inject, Injectable } from '@nestjs/common';
import type { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import type { AppLanguage } from '../common/i18n/i18n';
import {
  confidenceForStatus,
  resolveAnalysisConfidence,
} from './analysis.constants';
import { ENGINE_VERSION } from './engine-version';
import { EXPLANATION_PORT, type ExplanationPort } from './explanation.port';
import { buildActives } from './focus-analysis';
import { IngredientCatalogService } from './ingredient-catalog.service';
import { buildLayeringOrder } from './layering-orderer';
import { MatchingService } from './matching.service';
import { buildConflicts, buildOverlaps } from './multi-analysis';
import { scoreAnalysis } from './safety-scorer';
import { TranslationService } from './translation.service';
import {
  AnalysisConfidence,
  AnalysisMode,
  AnalysisStatus,
  type AnalysisActive,
  type AnalysisResult,
  type ProductForAnalysis,
  type ProductMatchResult,
} from './ingredients.types';

type AnalyzeInput = {
  products: ProductForAnalysis[];
  skinProfile: SkinProfile | null;
  language: AppLanguage;
  withExplanations: boolean;
  focusProductId?: string;
};

@Injectable()
export class AnalysisService {
  constructor(
    private readonly matchingService: MatchingService,
    private readonly catalog: IngredientCatalogService,
    private readonly translationService: TranslationService,
    @Inject(EXPLANATION_PORT)
    private readonly explanationProvider: ExplanationPort,
  ) {}

  async analyze(input: AnalyzeInput): Promise<AnalysisResult> {
    if (input.focusProductId) {
      return this.analyzeFocus(input, input.focusProductId);
    }

    return this.analyzeMulti(input);
  }

  /**
   * Focus mode returns only the focus product's actives + pairing guidance.
   * No cross-shelf comparison because the shelf is not a routine.
   */
  private async analyzeFocus(
    input: AnalyzeInput,
    focusProductId: string,
  ): Promise<AnalysisResult> {
    const focusProduct = input.products.find((p) => p.id === focusProductId);
    if (!focusProduct) {
      return this.emptyResult(
        AnalysisMode.Focus,
        AnalysisStatus.InsufficientData,
      );
    }

    const hasInci = focusProduct.inciIngredients.some(
      (token) => token.trim().length > 0,
    );
    if (!hasInci) {
      return {
        ...this.emptyResult(
          AnalysisMode.Focus,
          AnalysisStatus.InsufficientData,
        ),
        productsMissingInci: [focusProduct.id],
      };
    }

    const match = this.matchingService.matchProduct(focusProduct);
    if (match.matchedIngredients.length === 0) {
      return {
        ...this.emptyResult(AnalysisMode.Focus, AnalysisStatus.Ok),
        confidence: AnalysisConfidence.Low,
      };
    }

    const actives = buildActives(
      match.matchedIngredients,
      this.catalog.getConflictRules(),
    );

    return {
      ...this.emptyResult(AnalysisMode.Focus, AnalysisStatus.Ok),
      confidence: resolveAnalysisConfidence(
        match.totalTokens,
        match.resolvedTokens,
        1,
        1,
      ),
      actives: await this.localiseActives(actives, input.language),
    };
  }

  private async analyzeMulti(input: AnalyzeInput): Promise<AnalysisResult> {
    const matches = input.products.map((product) =>
      this.matchingService.matchProduct(product),
    );
    const productsMissingInci = input.products
      .filter((product) =>
        product.inciIngredients.every((token) => token.trim().length === 0),
      )
      .map((product) => product.id);

    const totalTokens = sumMatches(matches, (match) => match.totalTokens);
    const resolvedTokens = sumMatches(matches, (match) => match.resolvedTokens);
    const analyzable = matches.filter((match) => match.totalTokens > 0);

    if (analyzable.length === 0) {
      return {
        ...this.emptyResult(
          AnalysisMode.Multi,
          AnalysisStatus.InsufficientData,
        ),
        layeringOrder: buildLayeringOrder(
          input.products,
          matches,
          input.language,
        ),
        productsMissingInci,
      };
    }

    const conflicts = buildConflicts(
      matches,
      input.skinProfile,
      this.catalog.getConflictRules(),
    );
    const overlaps = buildOverlaps(matches, input.skinProfile);
    const result: AnalysisResult = {
      mode: AnalysisMode.Multi,
      status: AnalysisStatus.Ok,
      confidence: resolveAnalysisConfidence(
        totalTokens,
        resolvedTokens,
        analyzable.length,
        countProductsWithResolvedIngredients(analyzable),
      ),
      safetyScore: scoreAnalysis({ conflicts, overlaps }),
      actives: [],
      conflicts,
      overlaps,
      layeringOrder: buildLayeringOrder(
        input.products,
        matches,
        input.language,
      ),
      productsMissingInci,
      engineVersion: ENGINE_VERSION,
      generatedAt: new Date().toISOString(),
    };

    const localised = await this.localiseMultiResult(result, input.language);
    if (
      !input.withExplanations ||
      (localised.conflicts.length === 0 && localised.overlaps.length === 0)
    ) {
      return localised;
    }

    return this.addExplanations(localised, input.language);
  }

  private async localiseActives(
    actives: AnalysisActive[],
    language: AppLanguage,
  ): Promise<AnalysisActive[]> {
    if (actives.length === 0) return actives;

    const summaries = actives.map((active) => active.summary);
    const mitigations = actives.map((active) => active.mitigationHint ?? '');
    const [translatedSummaries, translatedMitigations] = await Promise.all([
      this.translationService.translateMany(summaries, language),
      this.translationService.translateMany(mitigations, language),
    ]);

    return actives.map((active, index) => ({
      ...active,
      summary: translatedSummaries[index],
      mitigationHint: active.mitigationHint
        ? translatedMitigations[index]
        : null,
    }));
  }

  private async localiseMultiResult(
    result: AnalysisResult,
    language: AppLanguage,
  ): Promise<AnalysisResult> {
    if (result.conflicts.length === 0 && result.overlaps.length === 0) {
      return result;
    }

    const descriptions = [
      ...result.conflicts.map((conflict) => conflict.description),
      ...result.overlaps.map((overlap) => overlap.description),
    ];
    const mitigations = result.conflicts.map(
      (conflict) => conflict.mitigation ?? '',
    );
    const [translatedDescriptions, translatedMitigations] = await Promise.all([
      this.translationService.translateMany(descriptions, language),
      this.translationService.translateMany(mitigations, language),
    ]);

    const conflictCount = result.conflicts.length;
    return {
      ...result,
      conflicts: result.conflicts.map((conflict, index) => ({
        ...conflict,
        description: translatedDescriptions[index],
        mitigation: conflict.mitigation
          ? translatedMitigations[index]
          : undefined,
      })),
      overlaps: result.overlaps.map((overlap, index) => ({
        ...overlap,
        description: translatedDescriptions[conflictCount + index],
      })),
    };
  }

  private async addExplanations(
    result: AnalysisResult,
    language: AppLanguage,
  ): Promise<AnalysisResult> {
    const explanations = await this.explanationProvider.explainFindings({
      language,
      conflicts: result.conflicts.map((conflict) => ({
        id: conflict.id,
        code: conflict.code,
        severity: conflict.severity,
        ingredientA: conflict.ingredientA,
        ingredientB: conflict.ingredientB,
        description: conflict.description,
        mitigation: conflict.mitigation,
      })),
      overlaps: result.overlaps.map((overlap) => ({
        id: overlap.id,
        severity: overlap.severity,
        ingredient: overlap.ingredient,
        productCount: overlap.productIds.length,
        description: overlap.description,
      })),
    });

    if (!explanations) return result;

    return {
      ...result,
      conflicts: result.conflicts.map((conflict) => ({
        ...conflict,
        explanation: explanations.conflicts[conflict.id] ?? null,
      })),
      overlaps: result.overlaps.map((overlap) => ({
        ...overlap,
        explanation: explanations.overlaps[overlap.id] ?? null,
      })),
    };
  }

  private emptyResult(
    mode: AnalysisMode,
    status: AnalysisStatus,
  ): AnalysisResult {
    return {
      mode,
      status,
      confidence: confidenceForStatus(status),
      safetyScore:
        status === AnalysisStatus.Ok && mode === AnalysisMode.Multi
          ? 100
          : null,
      actives: [],
      conflicts: [],
      overlaps: [],
      layeringOrder: [],
      productsMissingInci: [],
      engineVersion: ENGINE_VERSION,
      generatedAt: new Date().toISOString(),
    };
  }
}

function sumMatches(
  matches: ProductMatchResult[],
  selectValue: (match: ProductMatchResult) => number,
): number {
  return matches.reduce((sum, match) => sum + selectValue(match), 0);
}

function countProductsWithResolvedIngredients(
  matches: ProductMatchResult[],
): number {
  return matches.filter((match) => match.matchedIngredients.length > 0).length;
}

import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { ShelfStatus } from '../shelf/shelf.types';
import type { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { AnalysisService } from './analysis.service';
import { resolveAnalysisConfidence } from './analysis.constants';
import { CheckProductDto } from './dto/check-product.dto';
import {
  AnalysisSeverity,
  type AnalysisResult,
  type MatchedIngredient,
  type ProductForAnalysis,
  type ProductMatchResult,
} from './ingredients.types';
import { MatchingService } from './matching.service';
import {
  PRODUCT_CHECK_AI_REVIEW_PORT,
  type ProductCheckAiReviewPort,
} from './product-check-ai-review.port';
import { ProductCheckContextService } from './product-check-context.service';
import { ProductCheckPurchaseGuidanceService } from './product-check-purchase-guidance.service';
import { ProductCheckReactionEvidenceService } from './product-check-reaction-evidence.service';
import {
  ProductCheckPersonalizationLevel,
  type ProductCheckResponse,
} from './product-check.types';
import {
  hasReactionContext,
  normalizeIngredientList,
  normalizeSignal,
  uniqueIngredientNames,
} from './product-check.utils';
import { ProductVerdictService } from './product-verdict.service';
import { SkinProfileAnalysisContextService } from './skin-profile-analysis-context.service';
import type { AppLanguage } from '../common/i18n/i18n';

export const CHECKED_PRODUCT_ID = 'checked-product';

const SENSITIVE_PROFILE_VALUES = new Set(['sensitive', 'very-sensitive']);
const CHECKED_PRODUCT_FALLBACK_NAME = 'Checked product';
const ACTIVE_SHELF_CONTEXT_LIMIT = 50;
const INTERNAL_CONFLICT_PENALTIES: Record<AnalysisSeverity, number> = {
  [AnalysisSeverity.High]: 25,
  [AnalysisSeverity.Medium]: 15,
  [AnalysisSeverity.Low]: 8,
};
const ROUTINE_CONFLICT_PENALTIES: Record<AnalysisSeverity, number> = {
  [AnalysisSeverity.High]: 18,
  [AnalysisSeverity.Medium]: 8,
  [AnalysisSeverity.Low]: 3,
};
const OVERLAP_PENALTIES: Record<AnalysisSeverity, number> = {
  [AnalysisSeverity.High]: 15,
  [AnalysisSeverity.Medium]: 8,
  [AnalysisSeverity.Low]: 3,
};

type ActiveShelfContext = {
  inventoryProducts: InventoryProduct[];
  analysisProducts: ProductForAnalysis[];
};

@Injectable()
export class ProductCheckService {
  constructor(
    private readonly analysisContext: SkinProfileAnalysisContextService,
    private readonly analysisService: AnalysisService,
    private readonly matchingService: MatchingService,
    private readonly verdictService: ProductVerdictService,
    @Inject(PRODUCT_CHECK_AI_REVIEW_PORT)
    private readonly aiReviewProvider: ProductCheckAiReviewPort,
    private readonly contextService: ProductCheckContextService,
    private readonly reactionEvidenceService: ProductCheckReactionEvidenceService,
    private readonly purchaseGuidanceService: ProductCheckPurchaseGuidanceService,
    @InjectRepository(InventoryProduct)
    private readonly inventoryProducts: Repository<InventoryProduct>,
  ) {}

  async checkForUser(
    userId: string,
    dto: CheckProductDto,
    language: AppLanguage,
  ): Promise<ProductCheckResponse> {
    const product = this.toAnalysisProduct(dto);
    const skinProfile = await this.analysisContext.loadForUser(userId);
    const activeShelfContext = await this.loadActiveShelfContext(userId);
    const activeShelfProducts = activeShelfContext.analysisProducts;
    const { context, activeConsentTypes } =
      await this.contextService.loadForUser({
        userId,
        skinProfile,
        activeShelfProducts,
      });
    const match = this.matchingService.matchProduct(product);
    const [analysis, focusAnalysis] = await Promise.all([
      this.analysisService.analyze({
        products: [product, ...activeShelfProducts],
        skinProfile,
        language,
        withExplanations: true,
      }),
      this.analysisService.analyze({
        products: [product],
        skinProfile,
        language,
        withExplanations: false,
        focusProductId: CHECKED_PRODUCT_ID,
      }),
    ]);
    const checkedProductConfidence = resolveAnalysisConfidence(
      match.totalTokens,
      match.resolvedTokens,
      match.totalTokens > 0 ? 1 : 0,
      match.resolvedTokens > 0 ? 1 : 0,
    );
    const checkedProductAnalysis = this.toCheckedProductAnalysis(analysis);
    const enrichedAnalysis = {
      ...checkedProductAnalysis,
      confidence: checkedProductConfidence,
      actives: focusAnalysis.actives,
    };
    const reactionTriggerIngredients = this.findReactionTriggerIngredients(
      match,
      skinProfile,
    );
    const reactionEvidence = await this.reactionEvidenceService.loadForUser({
      userId,
      product,
      activeConsentTypes,
      inventoryProducts: activeShelfContext.inventoryProducts,
      reactionTriggerIngredients,
    });
    const verdictInput = {
      analysis: enrichedAnalysis,
      matchedIngredientCount: match.matchedIngredients.length,
      lookupConfidence: dto.product.lookupConfidence,
      hasPersonalContext:
        context.level === ProductCheckPersonalizationLevel.Personalized,
      hasReactionContext: hasReactionContext(context),
      recentJournalReactionCount: context.recentJournalReactionCount,
      recentSuggestionReactionCount: context.recentSuggestionReactionCount,
      reactionEvidenceCount: reactionEvidence.length,
      reviewRequired: Boolean(dto.product.reviewRequired),
      hasSensitiveProfile: this.hasSensitiveProfile(skinProfile),
      reactionTriggerIngredients,
      photosensitizingIngredients: this.findPhotosensitizingIngredients(match),
    };
    const baselineVerdict = this.verdictService.buildVerdict(verdictInput);
    const aiReview = await this.aiReviewProvider.review({
      language,
      product,
      analysis: enrichedAnalysis,
      context,
      baselineVerdict,
      matchedIngredientNames: match.matchedIngredients.map(
        (item) => item.ingredient.displayNameEn,
      ),
      unresolvedIngredientTokens: match.unresolvedTokens,
      reactionEvidence,
    });
    const verdict = this.verdictService.buildVerdict({
      ...verdictInput,
      aiReview,
    });
    const purchaseGuidance = await this.purchaseGuidanceService.loadForUser({
      userId,
      skinProfile,
      activeConsentTypes,
      context,
      verdictLabel: verdict.label,
      overlapCount: enrichedAnalysis.overlaps.length,
    });

    return {
      context,
      analysis: enrichedAnalysis,
      verdict,
      aiReview,
      reactionEvidence,
      purchaseGuidance,
    };
  }

  private toAnalysisProduct(dto: CheckProductDto): ProductForAnalysis {
    return {
      id: CHECKED_PRODUCT_ID,
      brand: dto.product.brand?.trim() ?? '',
      name: dto.product.name?.trim() || CHECKED_PRODUCT_FALLBACK_NAME,
      category: dto.product.category,
      inciIngredients: normalizeIngredientList(dto.product.inciIngredients),
    };
  }

  private toCheckedProductAnalysis(analysis: AnalysisResult): AnalysisResult {
    const conflicts = analysis.conflicts.filter((conflict) =>
      [conflict.productAId, conflict.productBId].includes(CHECKED_PRODUCT_ID),
    );
    const overlaps = analysis.overlaps.filter((overlap) =>
      overlap.productIds.includes(CHECKED_PRODUCT_ID),
    );

    return {
      ...analysis,
      conflicts,
      overlaps,
      safetyScore:
        analysis.safetyScore === null
          ? null
          : this.scoreCheckedProductAnalysis(conflicts, overlaps),
    };
  }

  private scoreCheckedProductAnalysis(
    conflicts: AnalysisResult['conflicts'],
    overlaps: AnalysisResult['overlaps'],
  ): number {
    let score = 100;

    for (const conflict of this.uniqueProductCheckPenaltyConflicts(conflicts)) {
      const penalties = this.isInternalConflict(conflict)
        ? INTERNAL_CONFLICT_PENALTIES
        : ROUTINE_CONFLICT_PENALTIES;
      score -= penalties[conflict.severity];
    }

    for (const overlap of overlaps) {
      score -= OVERLAP_PENALTIES[overlap.severity];
    }

    return Math.max(0, score);
  }

  private uniqueProductCheckPenaltyConflicts(
    conflicts: AnalysisResult['conflicts'],
  ): AnalysisResult['conflicts'] {
    const seen = new Set<string>();
    const unique: AnalysisResult['conflicts'] = [];

    for (const conflict of conflicts) {
      const checkedIngredient =
        conflict.productAId === CHECKED_PRODUCT_ID
          ? conflict.ingredientA
          : conflict.ingredientB;
      const key = this.isInternalConflict(conflict)
        ? [
            'internal',
            conflict.code,
            ...[conflict.ingredientA, conflict.ingredientB]
              .map(normalizeSignal)
              .sort(),
          ].join(':')
        : ['routine', conflict.code, normalizeSignal(checkedIngredient)].join(
            ':',
          );

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      unique.push(conflict);
    }

    return unique;
  }

  private isInternalConflict(
    conflict: AnalysisResult['conflicts'][number],
  ): boolean {
    return (
      conflict.productAId === CHECKED_PRODUCT_ID &&
      conflict.productBId === CHECKED_PRODUCT_ID
    );
  }

  private async loadActiveShelfContext(
    userId: string,
  ): Promise<ActiveShelfContext> {
    const products = await this.inventoryProducts.find({
      where: { user_id: userId, status: ShelfStatus.Active },
      order: { created_at: 'DESC' },
      take: ACTIVE_SHELF_CONTEXT_LIMIT,
    });

    return {
      inventoryProducts: products,
      analysisProducts: products
        .map((product) => this.toAnalysisProductFromInventory(product))
        .filter((product) => product.inciIngredients.length > 0),
    };
  }

  private toAnalysisProductFromInventory(
    product: InventoryProduct,
  ): ProductForAnalysis {
    return {
      id: product.id,
      brand: product.identity.brand || product.brand,
      name: product.identity.name || product.name,
      category: product.identity.category || product.category,
      inciIngredients: normalizeIngredientList(
        product.identity.inciIngredients ?? [],
      ),
    };
  }

  private hasSensitiveProfile(profile: SkinProfile | null): boolean {
    if (!profile) {
      return false;
    }

    return [profile.skin_type, profile.sensitivity_level]
      .map((value) => normalizeSignal(value ?? ''))
      .some((value) => SENSITIVE_PROFILE_VALUES.has(value));
  }

  private findReactionTriggerIngredients(
    match: ProductMatchResult,
    profile: SkinProfile | null,
  ): string[] {
    const triggers = new Set(
      (profile?.reaction_history?.entries ?? [])
        .map((entry) => normalizeSignal(entry.trigger))
        .filter(Boolean),
    );

    if (triggers.size === 0) {
      return [];
    }

    return uniqueIngredientNames(
      match.matchedIngredients.filter((matched) =>
        this.matchesReactionTrigger(matched, triggers),
      ),
    );
  }

  private matchesReactionTrigger(
    matched: MatchedIngredient,
    triggers: ReadonlySet<string>,
  ): boolean {
    const tags = [
      matched.ingredient.slug,
      matched.ingredient.displayNameEn,
      matched.ingredient.category,
      ...(matched.ingredient.aliases ?? []),
    ]
      .map(normalizeSignal)
      .filter(Boolean);

    return tags.some((tag) => {
      if (triggers.has(tag)) {
        return true;
      }

      return Array.from(triggers).some(
        (trigger) => trigger.includes(tag) || tag.includes(trigger),
      );
    });
  }

  private findPhotosensitizingIngredients(match: ProductMatchResult): string[] {
    return uniqueIngredientNames(
      match.matchedIngredients.filter(
        (matched) =>
          matched.ingredient.photosensitizing === true ||
          matched.ingredient.requiresSpf === true,
      ),
    );
  }
}

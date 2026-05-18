import { Injectable } from '@nestjs/common';
import {
  AnalysisConfidence,
  AnalysisSeverity,
  AnalysisStatus,
  type AnalysisConflict,
  type AnalysisOverlap,
  type AnalysisResult,
} from './ingredients.types';
import {
  applyAiReviewConfidence,
  applyAiReviewLabel,
  buildAiReviewReasons,
} from './product-check-ai-verdict';
import {
  ProductCheckNextAction,
  ProductCheckReasonCode,
  ProductCheckTone,
  ProductCheckVerdict,
  type ProductCheckAiReview,
  type ProductCheckReason,
  type ProductCheckVerdictResult,
} from './product-check.types';
import {
  isCheckedProductInternalConflict,
  isCheckedProductRoutineConflict,
  reasonPriority,
  toConflictReasonCode,
  uniqueIngredientNames,
} from './product-verdict.helpers';
import { LookupConfidence } from '../shelf/shelf.types';

type ProductVerdictInput = {
  analysis: AnalysisResult;
  matchedIngredientCount: number;
  lookupConfidence?: LookupConfidence;
  hasPersonalContext?: boolean;
  hasReactionContext?: boolean;
  recentJournalReactionCount?: number;
  recentSuggestionReactionCount?: number;
  reactionEvidenceCount?: number;
  reviewRequired: boolean;
  hasSensitiveProfile: boolean;
  reactionTriggerIngredients: string[];
  photosensitizingIngredients: string[];
  aiReview?: ProductCheckAiReview;
};

const REASON_LIMIT = 3;

@Injectable()
export class ProductVerdictService {
  buildVerdict(input: ProductVerdictInput): ProductCheckVerdictResult {
    const label = this.resolveLabel(input);
    const reasons = this.buildReasons(input);

    return {
      label,
      tone: this.resolveTone(label),
      confidence: this.resolveConfidence(input),
      safetyScore:
        label === ProductCheckVerdict.NotEnoughData
          ? null
          : input.analysis.safetyScore,
      reasons,
      nextAction: this.resolveNextAction(label, input),
      generatedAt: new Date().toISOString(),
    };
  }

  private resolveLabel(input: ProductVerdictInput): ProductCheckVerdict {
    const baseLabel = this.resolveBaseLabel(input);
    return applyAiReviewLabel(baseLabel, input.aiReview);
  }

  private resolveBaseLabel(input: ProductVerdictInput): ProductCheckVerdict {
    const score = input.analysis.safetyScore;
    const confidence = this.resolveConfidence(input);
    const hasPersonalContext = input.hasPersonalContext ?? true;
    const hasReactionContext = input.hasReactionContext ?? true;
    const hasRecentReactionContext =
      (input.recentJournalReactionCount ?? 0) > 0 ||
      (input.recentSuggestionReactionCount ?? 0) > 0;
    const hasProductReactionEvidence = (input.reactionEvidenceCount ?? 0) > 0;
    const hasInternalConflict = input.analysis.conflicts.some((conflict) =>
      isCheckedProductInternalConflict(conflict),
    );
    const hasRoutineConflict = input.analysis.conflicts.some((conflict) =>
      isCheckedProductRoutineConflict(conflict),
    );
    const hasHighInternalConflict = input.analysis.conflicts.some(
      (conflict) =>
        conflict.severity === AnalysisSeverity.High &&
        isCheckedProductInternalConflict(conflict),
    );
    const hasHighRoutineConflict = input.analysis.conflicts.some(
      (conflict) =>
        conflict.severity === AnalysisSeverity.High &&
        isCheckedProductRoutineConflict(conflict),
    );
    const hasMediumConflict = input.analysis.conflicts.some(
      (conflict) => conflict.severity === AnalysisSeverity.Medium,
    );
    const hasHighOverlap = input.analysis.overlaps.some(
      (overlap) => overlap.severity === AnalysisSeverity.High,
    );

    if (
      input.analysis.status === AnalysisStatus.InsufficientData ||
      input.matchedIngredientCount === 0
    ) {
      return ProductCheckVerdict.NotEnoughData;
    }

    if (
      hasHighInternalConflict ||
      (score !== null &&
        score < 60 &&
        (hasInternalConflict || (!hasRoutineConflict && !hasHighOverlap)))
    ) {
      return ProductCheckVerdict.AvoidForProfile;
    }

    if (!hasPersonalContext) {
      return ProductCheckVerdict.IngredientsOnly;
    }

    if (
      hasMediumConflict ||
      hasHighRoutineConflict ||
      hasHighOverlap ||
      hasProductReactionEvidence ||
      hasRecentReactionContext ||
      confidence === AnalysisConfidence.Low ||
      (score !== null && score >= 60 && score <= 74)
    ) {
      return ProductCheckVerdict.UseCarefully;
    }

    if (
      !hasReactionContext ||
      input.reviewRequired ||
      confidence === AnalysisConfidence.Medium ||
      input.analysis.conflicts.length > 0 ||
      input.analysis.overlaps.length > 0 ||
      (score !== null && score >= 75 && score <= 84)
    ) {
      return ProductCheckVerdict.GoodWithLimits;
    }

    return ProductCheckVerdict.GoodFit;
  }

  private resolveTone(label: ProductCheckVerdict): ProductCheckTone {
    if (label === ProductCheckVerdict.GoodFit) {
      return ProductCheckTone.Positive;
    }

    if (label === ProductCheckVerdict.AvoidForProfile) {
      return ProductCheckTone.Danger;
    }

    if (
      label === ProductCheckVerdict.NotEnoughData ||
      label === ProductCheckVerdict.IngredientsOnly
    ) {
      return ProductCheckTone.Neutral;
    }

    return ProductCheckTone.Caution;
  }

  private resolveNextAction(
    label: ProductCheckVerdict,
    input: ProductVerdictInput,
  ): ProductCheckNextAction {
    if (label === ProductCheckVerdict.AvoidForProfile) {
      return ProductCheckNextAction.SkipProduct;
    }

    if (label === ProductCheckVerdict.NotEnoughData) {
      return ProductCheckNextAction.ReviewIngredients;
    }

    if (label === ProductCheckVerdict.IngredientsOnly) {
      return ProductCheckNextAction.CompleteProfile;
    }

    if (input.analysis.overlaps.length > 0) {
      return ProductCheckNextAction.ReviewSmartPicks;
    }

    if (label === ProductCheckVerdict.GoodFit) {
      return ProductCheckNextAction.UseAsPlanned;
    }

    return ProductCheckNextAction.ReviewAndPatchTest;
  }

  private buildReasons(input: ProductVerdictInput): ProductCheckReason[] {
    if (
      input.analysis.status === AnalysisStatus.InsufficientData ||
      input.matchedIngredientCount === 0
    ) {
      return [
        {
          code: ProductCheckReasonCode.InsufficientIngredients,
          severity: null,
          ingredientNames: [],
          conflictCode: null,
        },
      ];
    }

    const reasons: ProductCheckReason[] = [
      ...this.toConflictReasons(input.analysis.conflicts),
      ...input.analysis.overlaps.map((overlap) =>
        this.toOverlapReason(overlap),
      ),
    ];

    if (input.hasPersonalContext === false) {
      reasons.push(
        this.basicReason(ProductCheckReasonCode.MissingPersonalContext),
      );
    } else if (input.hasReactionContext === false) {
      reasons.push(
        this.basicReason(ProductCheckReasonCode.MissingReactionContext),
      );
    }

    if ((input.recentJournalReactionCount ?? 0) > 0) {
      reasons.push(
        this.basicReason(ProductCheckReasonCode.RecentJournalReaction),
      );
    }

    if ((input.reactionEvidenceCount ?? 0) > 0) {
      reasons.push(
        this.basicReason(ProductCheckReasonCode.ProductReactionSignal),
      );
    }

    if ((input.recentSuggestionReactionCount ?? 0) > 0) {
      reasons.push(
        this.basicReason(ProductCheckReasonCode.SuggestionHistoryReaction),
      );
    }

    if (this.resolveConfidence(input) === AnalysisConfidence.Low) {
      reasons.push(this.basicReason(ProductCheckReasonCode.LowConfidence));
    }

    if (input.reactionTriggerIngredients.length > 0) {
      reasons.push({
        code: ProductCheckReasonCode.ReactionTrigger,
        severity: AnalysisSeverity.Medium,
        ingredientNames: input.reactionTriggerIngredients,
        conflictCode: null,
      });
    }

    if (input.photosensitizingIngredients.length > 0) {
      reasons.push({
        code: ProductCheckReasonCode.PhotosensitizingActive,
        severity: AnalysisSeverity.Low,
        ingredientNames: input.photosensitizingIngredients,
        conflictCode: null,
      });
    }

    if (input.reviewRequired) {
      reasons.push(this.basicReason(ProductCheckReasonCode.ReviewRequired));
    }

    if (input.hasSensitiveProfile) {
      reasons.push(this.basicReason(ProductCheckReasonCode.SensitiveProfile));
    }

    reasons.push(...buildAiReviewReasons(input.aiReview));

    return this.prioritizeReasons(this.uniqueReasons(reasons)).slice(
      0,
      REASON_LIMIT,
    );
  }

  private toConflictReasons(
    conflicts: AnalysisConflict[],
  ): ProductCheckReason[] {
    const reasons = new Map<string, ProductCheckReason>();

    for (const conflict of conflicts) {
      const code = toConflictReasonCode(conflict.severity);
      const key = `${code}:${conflict.code}`;
      const existing = reasons.get(key);

      if (existing) {
        existing.ingredientNames = uniqueIngredientNames([
          ...existing.ingredientNames,
          conflict.ingredientA,
          conflict.ingredientB,
        ]);
        continue;
      }

      reasons.set(key, {
        code,
        severity: conflict.severity,
        ingredientNames: uniqueIngredientNames([
          conflict.ingredientA,
          conflict.ingredientB,
        ]),
        conflictCode: conflict.code,
      });
    }

    return Array.from(reasons.values());
  }

  private toOverlapReason(overlap: AnalysisOverlap): ProductCheckReason {
    return {
      code: ProductCheckReasonCode.DuplicateExposure,
      severity: overlap.severity,
      ingredientNames: [overlap.ingredient],
      conflictCode: null,
    };
  }

  private basicReason(code: ProductCheckReasonCode): ProductCheckReason {
    return {
      code,
      severity: null,
      ingredientNames: [],
      conflictCode: null,
    };
  }

  private uniqueReasons(reasons: ProductCheckReason[]): ProductCheckReason[] {
    const seen = new Set<string>();
    const unique: ProductCheckReason[] = [];

    for (const reason of reasons) {
      const key = [
        reason.code,
        reason.conflictCode ?? '',
        [...reason.ingredientNames].sort().join('|'),
      ].join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(reason);
    }

    return unique;
  }

  private prioritizeReasons(
    reasons: ProductCheckReason[],
  ): ProductCheckReason[] {
    return reasons
      .map((reason, index) => ({ reason, index }))
      .sort((left, right) => {
        const priorityDelta =
          reasonPriority(left.reason) - reasonPriority(right.reason);
        return priorityDelta === 0 ? left.index - right.index : priorityDelta;
      })
      .map(({ reason }) => reason);
  }

  private resolveConfidence(input: ProductVerdictInput): AnalysisConfidence {
    const baseConfidence = this.resolveBaseConfidence(input);
    return applyAiReviewConfidence(baseConfidence, input.aiReview);
  }

  private resolveBaseConfidence(
    input: ProductVerdictInput,
  ): AnalysisConfidence {
    if (
      input.analysis.confidence === AnalysisConfidence.Low ||
      input.lookupConfidence === LookupConfidence.Low
    ) {
      return AnalysisConfidence.Low;
    }

    if (
      input.analysis.confidence === AnalysisConfidence.Medium ||
      input.lookupConfidence === LookupConfidence.Medium
    ) {
      return AnalysisConfidence.Medium;
    }

    return AnalysisConfidence.High;
  }
}

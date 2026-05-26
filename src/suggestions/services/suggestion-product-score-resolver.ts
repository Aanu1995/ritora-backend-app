import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ProductCategory } from '../../shelf/shelf.types';
import { SuggestionProductScore } from '../suggestion-context.types';
import { SuggestionDaypart } from '../suggestions.constants';
import type { SuggestionGenerationInputs } from './suggestion-ai-generator';
import {
  isStrongActiveTag,
  scoreProductForSuggestion,
} from './suggestion-product-intelligence';

const resolvedScoreCache = new WeakMap<
  SuggestionGenerationInputs,
  SuggestionProductScore[]
>();

export function resolveSuggestionProductScores(
  inputs: SuggestionGenerationInputs,
): SuggestionProductScore[] {
  const cached = resolvedScoreCache.get(inputs);
  if (cached) return cached;
  const scoredProductIds = new Set(
    inputs.contextSummary.productScores.map((score) => score.productId),
  );
  const fallbackScores = inputs.shelfActiveProducts
    .filter((product) => !scoredProductIds.has(product.id))
    .map((product) => buildFallbackScore(inputs, product));

  const scores = [...inputs.contextSummary.productScores, ...fallbackScores];
  resolvedScoreCache.set(inputs, scores);
  return scores;
}

function buildFallbackScore(
  inputs: SuggestionGenerationInputs,
  product: InventoryProduct,
): SuggestionProductScore {
  const appliedHistory = inputs.contextSummary.appliedProductHistory?.products;
  const appliedProduct = appliedHistory?.find(
    (history) => history.productId === product.id,
  );
  const routineMemory = inputs.contextSummary.routineMemory;
  const scored = scoreProductForSuggestion(product, {
    daypart: inputs.daypart,
    primaryGoal:
      inputs.contextSummary.goalSignals?.mainGoal ??
      inputs.contextSummary.goalSignals?.primaryGoal ??
      inputs.skinProfile?.primary_goal ??
      inputs.contextSummary.skinProfile.primaryGoal,
    secondaryGoals: secondaryGoals(inputs),
    sensitivityLevel:
      inputs.contextSummary.skinProfile.sensitivityLevel ??
      inputs.skinProfile?.sensitivity_level ??
      null,
    recentUseCount: appliedProduct?.useCount ?? 0,
    adherenceCount:
      routineMemory?.adheredProducts[product.id] ?? appliedProduct?.useCount,
    skipCount:
      (routineMemory?.skippedProducts[product.id] ?? 0) +
      inputs.contextSummary.skippedCandidates.filter(
        (candidate) => candidate.productId === product.id,
      ).length,
    substitutionCount: routineMemory?.substitutedProducts[product.id] ?? 0,
    recentSameDaypartSuggestionCount:
      routineMemory?.recentlySuggestedProductIds.includes(product.id) === true
        ? routineMemory.sameDaypartSuggestionCount
        : 0,
    hasReactionSignal:
      inputs.contextSummary.reaction.hasSignal ||
      inputs.contextSummary.reaction.barrierCompromised,
    lockedProductIds: new Set(
      inputs.routineSteps
        .filter((step) => step.is_specialist_locked)
        .map((step) => step.inventory_product_id)
        .filter((productId): productId is string => Boolean(productId)),
    ),
    conservativeRestart:
      inputs.contextSummary.applicationPatterns.conservativeRestart ||
      inputs.contextSummary.routineBreak.recentlyResumed,
    environment: inputs.contextSummary.environment,
    targetDate: inputs.targetDate,
  });

  return {
    ...scored,
    suitabilityScore: Math.max(
      scored.suitabilityScore,
      fallbackSuitabilityFloor(scored, inputs.daypart),
    ),
    suitabilityReasons: appendUniqueReason(
      scored.suitabilityReasons,
      'active shelf fallback score',
    ),
  };
}

function secondaryGoals(inputs: SuggestionGenerationInputs): string[] {
  const goals = new Set<string>();
  for (const selectedGoal of inputs.contextSummary.goalSignals?.selectedGoals ??
    []) {
    goals.add(selectedGoal);
  }
  for (const goal of inputs.contextSummary.goalSignals?.secondaryGoals ?? []) {
    goals.add(goal.concern);
  }
  for (const concern of inputs.contextSummary.skinProfile.activeConcerns) {
    goals.add(concern);
  }
  return [...goals].filter((goal) => goal.trim().length > 0);
}

function fallbackSuitabilityFloor(
  score: SuggestionProductScore,
  daypart: SuggestionDaypart,
): number {
  if (
    score.category === ProductCategory.Cleanser ||
    score.category === ProductCategory.Moisturizer
  ) {
    return 55;
  }
  if (score.category === ProductCategory.SunProtection) {
    return daypart === SuggestionDaypart.Evening ? 45 : 65;
  }
  if (
    [
      ProductCategory.Toner,
      ProductCategory.Essence,
      ProductCategory.Serum,
      ProductCategory.EyeCare,
      ProductCategory.LipCare,
    ].includes(score.category) &&
    !score.activeTags.some(isStrongActiveTag)
  ) {
    return 45;
  }
  return 0;
}

function appendUniqueReason(reasons: string[], reason: string): string[] {
  return reasons.includes(reason) ? reasons : [...reasons, reason];
}

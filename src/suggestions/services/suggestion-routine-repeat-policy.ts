import { ProductCategory } from '../../shelf/shelf.types';
import {
  SuggestionDaypart,
  SuggestionStepProvenance,
} from '../suggestions.constants';
import {
  isPreferredTimeCompatibleWithDaypart,
  SuggestionProductGoalFitReason,
} from './suggestion-product-intelligence';
import type {
  SuggestionGenerationInputs,
  SuggestionGenerationStepOutput,
} from './suggestion-ai-generator';
import { resolveSuggestionProductScores } from './suggestion-product-score-resolver';

export function hasUnsupportedAiProductSelectionStep(
  inputs: SuggestionGenerationInputs,
  steps: readonly SuggestionGenerationStepOutput[],
): boolean {
  return steps.some((step) => {
    if (!step.inventoryProductId) return false;
    if (step.provenance !== SuggestionStepProvenance.AiAdded) return false;
    return !hasCurrentSelectionEvidence(inputs, step.inventoryProductId);
  });
}

export function hasCurrentSelectionEvidence(
  inputs: SuggestionGenerationInputs,
  productId: string,
): boolean {
  const score = resolveSuggestionProductScores(inputs).find(
    (productScore) => productScore.productId === productId,
  );
  const shelfProduct = inputs.shelfActiveProducts.find(
    (product) => product.id === productId,
  );
  return (
    Boolean(
      (score?.category === ProductCategory.SunProtection ||
        shelfProduct?.category === ProductCategory.SunProtection) &&
      requiresOwnedDaytimeSpf(inputs),
    ) || hasCurrentContextJustification(inputs, productId)
  );
}

function hasCurrentContextJustification(
  inputs: SuggestionGenerationInputs,
  productId: string,
): boolean {
  const score = resolveSuggestionProductScores(inputs).find(
    (productScore) => productScore.productId === productId,
  );
  if (!score) return false;
  if (
    !isPreferredTimeCompatibleWithDaypart(
      score.preferredTimeOfDay,
      inputs.daypart,
    )
  ) {
    return false;
  }
  if (
    score.cautionReasons.some((reason) =>
      /recently skipped|recently substituted|preferred time of day does not match|product may be expired/i.test(
        reason,
      ),
    )
  ) {
    return false;
  }
  if (
    score.category === ProductCategory.Cleanser ||
    score.category === ProductCategory.Moisturizer
  ) {
    return true;
  }
  if (score.dataQuality === 'insufficient') return false;
  if (supportsCurrentGoal(inputs, score.activeTags, score.suitabilityReasons)) {
    return true;
  }
  return score.suitabilityReasons.some(
    (reason) =>
      [
        SuggestionProductGoalFitReason.PrimarySelectedGoal,
        SuggestionProductGoalFitReason.SecondarySelectedGoal,
        'daytime sun protection fit',
        'high UV fit',
        'dry air barrier support',
      ].includes(reason) ||
      /primary selected goal|secondary selected goal/i.test(reason),
  );
}

function supportsCurrentGoal(
  inputs: SuggestionGenerationInputs,
  activeTags: readonly string[],
  suitabilityReasons: readonly string[],
): boolean {
  if (
    suitabilityReasons.some((reason) =>
      /primary selected goal|secondary selected goal|supports main skin profile goal|supports selected skin profile goal/i.test(
        reason,
      ),
    )
  ) {
    return true;
  }
  const goalText = JSON.stringify([
    inputs.skinProfile?.primary_goal ?? '',
    inputs.skinProfile?.current_concerns ?? [],
    inputs.contextSummary.skinProfile.primaryGoal ?? '',
    inputs.contextSummary.skinProfile.activeConcerns,
    inputs.contextSummary.goalSignals?.mainGoal ?? '',
    inputs.contextSummary.goalSignals?.primaryGoal ?? '',
    inputs.contextSummary.goalSignals?.selectedGoals ?? [],
    inputs.contextSummary.goalSignals?.secondaryGoals.map(
      (goal) => goal.concern,
    ) ?? [],
    inputs.contextSummary.journalSignals?.detectedConcerns.map(
      (concern) => concern.concern,
    ) ?? [],
  ]);
  const tags = activeTags.map((tag) => tag.toLowerCase());
  if (
    /(acne|breakout|clogged)/i.test(goalText) &&
    tags.some((tag) => /niacinamide|azelaic|azelaic_acid|acne|zinc/.test(tag))
  ) {
    return true;
  }
  if (
    /(dark mark|hyperpigmentation|uneven tone|pigment|spot)/i.test(goalText) &&
    tags.some((tag) =>
      /niacinamide|azelaic|azelaic_acid|vitamin_c|pigment/.test(tag),
    )
  ) {
    return true;
  }
  return (
    /(texture|pores?)/i.test(goalText) &&
    tags.some((tag) =>
      /niacinamide|azelaic|azelaic_acid|pha|humectant|hydrating/.test(tag),
    )
  );
}

export function requiresOwnedDaytimeSpf(
  inputs: SuggestionGenerationInputs,
): boolean {
  if (
    inputs.daypart !== SuggestionDaypart.Morning &&
    inputs.daypart !== SuggestionDaypart.Noon
  ) {
    return false;
  }
  if (
    /\b(indoor|indoors|inside|at home all day|no daylight)\b/i.test(
      inputs.requestContext?.note ?? '',
    )
  ) {
    return false;
  }
  return (
    inputs.contextSummary.productScores.some(
      (score) => score.category === ProductCategory.SunProtection,
    ) ||
    inputs.shelfActiveProducts.some(
      (product) => product.category === ProductCategory.SunProtection,
    )
  );
}

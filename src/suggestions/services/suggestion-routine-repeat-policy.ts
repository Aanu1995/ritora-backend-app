import { ProductCategory } from '../../shelf/shelf.types';
import type { SuggestionContextSummary } from '../suggestion-context.types';
import {
  SuggestionDaypart,
  SuggestionRequestSource,
  SuggestionStepProvenance,
} from '../suggestions.constants';
import type {
  SuggestionGenerationInputs,
  SuggestionGenerationStepOutput,
} from './suggestion-ai-generator';

const STABLE_REPEAT_MIN_EXACT_COUNT = 3;
const STABLE_REPEAT_MIN_ADHERENCE_COUNT = 3;

export function stableSameDaypartRepeatProductIds(
  summary: SuggestionContextSummary,
): string[] {
  const memory = summary.routineMemory;
  if (!memory || memory.sameDaypartSuggestionCount < 3) {
    return [];
  }

  const fingerprints = [...memory.recentSameDaypartFingerprints]
    .filter((fingerprint) => fingerprint.productIds.length >= 2)
    .filter(
      (fingerprint) =>
        (memory.exactRepeatCountByFingerprint[fingerprint.fingerprint] ?? 0) >=
        STABLE_REPEAT_MIN_EXACT_COUNT,
    )
    .filter((fingerprint) =>
      uniqueProductIds(fingerprint.productIds).every(
        (productId) =>
          (memory.adheredProducts[productId] ?? 0) >=
          STABLE_REPEAT_MIN_ADHERENCE_COUNT,
      ),
    )
    .sort((left, right) => {
      const repeatDelta =
        (memory.exactRepeatCountByFingerprint[right.fingerprint] ?? 0) -
        (memory.exactRepeatCountByFingerprint[left.fingerprint] ?? 0);
      if (repeatDelta !== 0) return repeatDelta;
      const dateDelta = right.targetDate.localeCompare(left.targetDate);
      return dateDelta || right.targetTime.localeCompare(left.targetTime);
    });

  return uniqueProductIds(fingerprints[0]?.productIds ?? []);
}

export function shouldApplyStableRepeatPolicy(
  inputs: SuggestionGenerationInputs,
): boolean {
  return (
    inputs.requestSource === SuggestionRequestSource.Scheduled &&
    inputs.requestContext === null &&
    !inputs.contextSummary.reaction.hasSignal &&
    !inputs.contextSummary.reaction.barrierCompromised &&
    !inputs.contextSummary.routineBreak.recentlyResumed &&
    stableSameDaypartRepeatProductIds(inputs.contextSummary).length > 0
  );
}

export function hasUnjustifiedHistoryNoveltyStep(
  inputs: SuggestionGenerationInputs,
  steps: readonly SuggestionGenerationStepOutput[],
): boolean {
  if (!shouldApplyStableRepeatPolicy(inputs)) {
    return false;
  }
  const stableProductIds = new Set(
    stableSameDaypartRepeatProductIds(inputs.contextSummary),
  );
  return steps.some((step) => {
    if (!step.inventoryProductId) return false;
    if (step.provenance !== SuggestionStepProvenance.AiAdded) return false;
    if (stableProductIds.has(step.inventoryProductId)) return false;
    return !hasUserHistoryIndication(inputs, step.inventoryProductId);
  });
}

export function hasUserHistoryIndication(
  inputs: SuggestionGenerationInputs,
  productId: string,
): boolean {
  const memory = inputs.contextSummary.routineMemory;
  if (
    (memory?.adheredProducts[productId] ?? 0) >=
    STABLE_REPEAT_MIN_ADHERENCE_COUNT
  ) {
    return true;
  }
  const appliedProduct =
    inputs.contextSummary.appliedProductHistory?.products.find(
      (product) => product.productId === productId,
    );
  if ((appliedProduct?.useCount ?? 0) >= STABLE_REPEAT_MIN_ADHERENCE_COUNT) {
    return true;
  }
  const score = inputs.contextSummary.productScores.find(
    (productScore) => productScore.productId === productId,
  );
  return Boolean(
    score &&
    score.category === ProductCategory.SunProtection &&
    requiresOwnedDaytimeSpf(inputs),
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
  return inputs.contextSummary.productScores.some(
    (score) => score.category === ProductCategory.SunProtection,
  );
}

function uniqueProductIds(productIds: readonly string[]): string[] {
  return [...new Set(productIds.filter((productId) => productId.trim()))];
}

import { ProductCategory } from '../../shelf/shelf.types';
import {
  SuggestionDaypart,
  SuggestionStepProvenance,
} from '../suggestions.constants';
import { isPreferredTimeCompatibleWithDaypart } from './suggestion-product-intelligence';
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
  if (!score && !shelfProduct) return false;
  const preferredTime =
    score?.preferredTimeOfDay ?? shelfProduct?.user_fields?.preferredTimeOfDay;
  if (!isPreferredTimeCompatibleWithDaypart(preferredTime, inputs.daypart)) {
    return false;
  }
  return !(
    score?.cautionReasons.some((reason) =>
      /recent reaction-related skip|preferred time of day does not match|product may be expired/i.test(
        reason,
      ),
    ) ?? false
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

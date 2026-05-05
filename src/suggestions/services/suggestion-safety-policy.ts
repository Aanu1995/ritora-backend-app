import { ProductCategory } from '../../shelf/shelf.types';
import {
  SuggestionContextSummary,
  SuggestionProductScore,
} from '../suggestion-context.types';
import {
  SuggestionEvidenceSourceId,
  SuggestionSafetyFlagJson,
} from '../suggestions.constants';
import type { SuggestionGenerationStepOutput } from './suggestion-ai-generator';
import { mergeEvidenceSourceIds } from './suggestion-evidence-sources';
import { isStrongActiveTag } from './suggestion-product-intelligence';

export function buildSafetyConstraints(
  context: Pick<SuggestionContextSummary, 'reaction' | 'productScores'>,
): string[] {
  const constraints: string[] = [];
  if (context.reaction.hasSignal || context.reaction.barrierCompromised) {
    constraints.push('barrier_recovery_mode');
    constraints.push('avoid_new_strong_actives');
  }
  if (
    context.productScores.some((product) => product.activeTags.includes('spf'))
  ) {
    constraints.push('daytime_spf_available');
  }
  if (
    context.productScores.some((product) =>
      product.activeTags.some(isStrongActiveTag),
    )
  ) {
    constraints.push('space_strong_actives');
  }
  return constraints;
}

export function buildPolicySafetyFlags(
  context: SuggestionContextSummary,
  steps: SuggestionGenerationStepOutput[],
): SuggestionSafetyFlagJson[] {
  const productById = new Map(
    context.productScores.map((product) => [product.productId, product]),
  );
  const selectedProducts = steps
    .map((step) =>
      step.inventoryProductId ? productById.get(step.inventoryProductId) : null,
    )
    .filter((product): product is SuggestionProductScore => Boolean(product));
  const selectedTags = new Set(selectedProducts.flatMap((p) => p.activeTags));
  const flags: SuggestionSafetyFlagJson[] = [];

  if (context.reaction.hasSignal || context.reaction.barrierCompromised) {
    flags.push({
      severity: 'warning',
      message:
        'Recent reaction or barrier signal found; keep this routine simple and avoid new strong actives.',
      ingredientSlugs: [],
      sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
    });
  }
  if (selectedTags.has('retinoid') && selectedTags.has('aha')) {
    flags.push(
      activeMixFlag(
        'Retinoids and AHA exfoliants can be irritating together.',
        [
          SuggestionEvidenceSourceId.AadRetinoidRetinol,
          SuggestionEvidenceSourceId.FdaAhaSunSensitivity,
        ],
      ),
    );
  }
  if (selectedTags.has('retinoid') && selectedTags.has('bha')) {
    flags.push(
      activeMixFlag(
        'Retinoids and BHA exfoliants can be irritating together.',
        [
          SuggestionEvidenceSourceId.AadRetinoidRetinol,
          SuggestionEvidenceSourceId.AadAcneTreatment,
        ],
      ),
    );
  }
  if (selectedTags.has('aha') && selectedTags.has('bha')) {
    flags.push(
      activeMixFlag('AHA and BHA exfoliants should be spaced carefully.', [
        SuggestionEvidenceSourceId.FdaAhaSunSensitivity,
        SuggestionEvidenceSourceId.AadAcneTreatment,
      ]),
    );
  }
  if (
    (context.daypart === 'morning' || context.daypart === 'noon') &&
    selectedTags.has('retinoid')
  ) {
    flags.push({
      severity: 'warning',
      message:
        'Retinoids usually fit evening routines unless a specialist advised this timing.',
      ingredientSlugs: ['retinoid'],
      sourceIds: [
        SuggestionEvidenceSourceId.AadRetinoidRetinol,
        SuggestionEvidenceSourceId.DermNetTopicalRetinoids,
      ],
    });
  }
  if (
    (selectedTags.has('retinoid') ||
      selectedTags.has('aha') ||
      selectedTags.has('bha')) &&
    !selectedProducts.some(
      (product) => product.category === ProductCategory.SunProtection,
    )
  ) {
    flags.push({
      severity: 'info',
      message:
        'Photosensitizing actives increase the importance of daytime sun protection.',
      ingredientSlugs: ['retinoid', 'aha', 'bha'],
      sourceIds: [
        SuggestionEvidenceSourceId.AadSunscreenSelection,
        SuggestionEvidenceSourceId.AadRetinoidRetinol,
        SuggestionEvidenceSourceId.FdaAhaSunSensitivity,
      ],
    });
  }
  return dedupeFlags(flags);
}

export function skippedReasonsFromPolicy(
  context: SuggestionContextSummary,
): SuggestionContextSummary['skippedCandidates'] {
  return context.productScores
    .filter((product) => product.cautionReasons.length > 0)
    .map((product) => ({
      productId: product.productId,
      reason: product.cautionReasons[0],
      sourceIds: product.evidenceSourceIds,
    }));
}

function activeMixFlag(
  message: string,
  sourceIds: SuggestionEvidenceSourceId[],
): SuggestionSafetyFlagJson {
  return {
    severity: 'warning',
    message,
    ingredientSlugs: ['retinoid', 'aha', 'bha'],
    sourceIds,
  };
}

function dedupeFlags(
  flags: SuggestionSafetyFlagJson[],
): SuggestionSafetyFlagJson[] {
  const seen = new Set<string>();
  return flags.filter((flag) => {
    flag.sourceIds = mergeEvidenceSourceIds(flag.sourceIds ?? []);
    const key = `${flag.severity}:${flag.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

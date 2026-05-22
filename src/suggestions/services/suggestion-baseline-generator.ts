import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ProductCategory } from '../../shelf/shelf.types';
import { buildEnvironmentAdaptationPolicy } from '../../environment-intelligence/environment-adaptation-policy';
import type {
  SuggestionGenerationInputs,
  SuggestionGenerationStepOutput,
} from './suggestion-ai-generator';
import {
  SuggestionDaypart,
  SuggestionEvidenceSourceId,
  SuggestionExplanationJson,
  SuggestionGapRecommendationJson,
  SuggestionRequestSource,
  SuggestionStepChipTone,
  SuggestionStepProvenance,
} from '../suggestions.constants';
import { SuggestionProductScore } from '../suggestion-context.types';
import { mergeEvidenceSourceIds } from './suggestion-evidence-sources';
import {
  sanitizeSuggestionText,
  toHumanApplicationMethod,
  toHumanQuantity,
} from './suggestion-language';

export function buildDeterministicAiSteps(
  inputs: SuggestionGenerationInputs,
): SuggestionGenerationStepOutput[] {
  const productById = new Map(
    inputs.shelfActiveProducts.map((product) => [product.id, product]),
  );
  return selectBaselineProducts(inputs)
    .map((score, index) => {
      const product = productById.get(score.productId);
      if (!product) return null;
      return productScoreToStep(product, score, index);
    })
    .filter((step): step is SuggestionGenerationStepOutput => step !== null);
}

export function deterministicExplanation(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
): SuggestionExplanationJson {
  const missingSunscreen = needsMissingDaytimeSunscreen(inputs);
  return {
    headline:
      steps.length === 0
        ? 'No shelf steps yet'
        : inputs.requestSource === SuggestionRequestSource.OnDemand
          ? 'Quick shelf suggestion'
          : 'Using your shelf today',
    body: [
      inputs.requestSource === SuggestionRequestSource.OnDemand
        ? onDemandFallbackDetail(inputs)
        : 'Ritora used your shelf and safety rules for this slot.',
      ...(steps.length === 0
        ? ['No active shelf products are available to apply right now.']
        : []),
      ...(missingSunscreen
        ? [
            'Sunscreen is missing from your shelf, so it stays a gap instead of an invented step.',
          ]
        : []),
      ...(missingSunscreen && needsPigmentProtection(inputs)
        ? [
            'For dark marks or uneven tone, that SPF gap is essential for daytime care.',
          ]
        : []),
      ...(inputs.contextSummary.routineBreak.recentlyResumed
        ? ['Restarting gently after your break.']
        : []),
    ],
    perStepReasons: steps.map((step) => ({
      stepOrder: step.stepOrder,
      reason: step.explanation ?? 'Good fit for this slot.',
    })),
    skipped: inputs.contextSummary.skippedCandidates.map((candidate) => {
      const product = inputs.contextSummary.productScores.find(
        (score) => score.productId === candidate.productId,
      );
      return {
        name: product
          ? `${product.brand} ${product.name}`
          : candidate.productId,
        reason:
          sanitizeSuggestionText(candidate.reason, {
            maxLength: 140,
            maxSentences: 1,
          }) ?? '',
      };
    }),
    inputs: [
      {
        label: 'Evidence',
        detail: `${inputs.contextSummary.evidenceSources.length} trusted sources informed the safety check.`,
      },
      ...(inputs.contextSummary.environment
        ? [
            {
              label: 'Environment',
              detail: environmentDetail(inputs.contextSummary.environment),
            },
          ]
        : []),
    ],
  };
}

function needsMissingDaytimeSunscreen(
  inputs: SuggestionGenerationInputs,
): boolean {
  return (
    (inputs.daypart === SuggestionDaypart.Morning ||
      inputs.daypart === SuggestionDaypart.Noon) &&
    !inputs.contextSummary.productScores.some(
      (score) => score.category === ProductCategory.SunProtection,
    )
  );
}

function onDemandFallbackDetail(inputs: SuggestionGenerationInputs): string {
  switch (inputs.requestContext?.intent) {
    case 'post_workout':
      return 'Post-workout reset: cleanse sweat, keep it quick, and avoid strong actives.';
    case 'event_prep':
      return 'Event prep: keep skin calm now and avoid risky last-minute actives.';
    case 'post_sun':
      return 'Post-sun reset: keep skin comfortable and prioritize barrier support.';
    case 'post_swim':
      return 'Post-swim reset: rinse, moisturize, and protect the barrier.';
    case 'travel_refresh':
      return 'Travel refresh: keep the routine simple and comfortable.';
    case 'quick_refresh':
      return 'Quick refresh: use the simplest helpful shelf steps right now.';
    case 'post_makeup_or_shower':
      return 'Post-makeup or shower reset: cleanse gently and support the barrier.';
    case 'other':
    case undefined:
      return 'Ritora used your shelf and safety rules for this request.';
  }
}

export function buildDeterministicGapRecommendations(
  inputs: SuggestionGenerationInputs,
): SuggestionGapRecommendationJson[] {
  const productScores = inputs.contextSummary.productScores;
  const hasSunscreen = productScores.some(
    (score) => score.category === ProductCategory.SunProtection,
  );
  const hasMoisturizer = productScores.some(
    (score) => score.category === ProductCategory.Moisturizer,
  );
  const gaps: SuggestionGapRecommendationJson[] = [];
  const environmentPolicy = buildEnvironmentAdaptationPolicy(
    inputs.contextSummary.environment,
  );

  if (
    (inputs.daypart === SuggestionDaypart.Morning ||
      inputs.daypart === SuggestionDaypart.Noon) &&
    !hasSunscreen
  ) {
    const sunscreenReason = needsPigmentProtection(inputs)
      ? 'A sunscreen is the essential missing daytime step for dark marks or uneven tone.'
      : 'Daytime routines need a sunscreen option.';
    gaps.push({
      ingredientOrCategory: 'Broad-spectrum sunscreen SPF 30+',
      reason: sunscreenReason,
      budgetTier: null,
      goalAlignment: inputs.skinProfile?.primary_goal ?? null,
      sourceIds: [
        SuggestionEvidenceSourceId.AadSunscreenSelection,
        SuggestionEvidenceSourceId.FdaAhaSunSensitivity,
      ],
    });
  }

  if (
    (inputs.contextSummary.reaction.hasSignal ||
      inputs.contextSummary.reaction.barrierCompromised) &&
    !hasMoisturizer
  ) {
    gaps.push({
      ingredientOrCategory: 'Fragrance-free barrier moisturizer',
      reason: 'A simple moisturizer can support barrier recovery.',
      budgetTier: null,
      goalAlignment: 'barrier support',
      sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
    });
  }

  for (const gap of environmentPolicy.gapRecommendations) {
    const alreadyCovered = gaps.some(
      (candidate) =>
        candidate.ingredientOrCategory.toLowerCase() ===
        gap.ingredientOrCategory.toLowerCase(),
    );
    if (!alreadyCovered) {
      gaps.push({
        ...gap,
        budgetTier: null,
        goalAlignment:
          gap.goalAlignment ?? inputs.skinProfile?.primary_goal ?? null,
      });
    }
  }

  return gaps.map((gap) => ({
    ...gap,
    sourceIds: mergeEvidenceSourceIds(gap.sourceIds),
  }));
}

function needsPigmentProtection(inputs: SuggestionGenerationInputs): boolean {
  return /(dark mark|hyperpigmentation|uneven tone|melasma|pigment)/i.test(
    JSON.stringify([
      inputs.skinProfile?.primary_goal ?? '',
      inputs.skinProfile?.current_concerns ?? [],
      inputs.contextSummary.skinProfile.activeConcerns,
    ]),
  );
}

function environmentDetail(
  environment: NonNullable<
    SuggestionGenerationInputs['contextSummary']['environment']
  >,
): string {
  const parts = [
    environment.conditionLabel,
    environment.uvRisk !== 'unknown' ? `UV ${environment.uvRisk}` : null,
    environment.humidityBand,
    environment.airQualityRisk !== 'unknown'
      ? `air ${environment.airQualityRisk}`
      : null,
  ].filter(Boolean);
  return parts.length > 0
    ? parts.join(' · ')
    : 'Environment data was considered.';
}

function selectBaselineProducts(
  inputs: SuggestionGenerationInputs,
): SuggestionProductScore[] {
  const preferredOrder = preferredCategoryOrder(inputs);
  const selected: SuggestionProductScore[] = [];
  const usedCategories = new Set<ProductCategory>();
  const skippedProductIds = new Set(
    inputs.contextSummary.skippedCandidates.map(
      (candidate) => candidate.productId,
    ),
  );
  const candidates = inputs.contextSummary.productScores
    .filter((score) => score.suitabilityScore >= 40)
    .filter((score) => !skippedProductIds.has(score.productId))
    .filter((score) =>
      shouldAvoidStrongActives(inputs)
        ? !score.activeTags.some((tag) =>
            ['retinoid', 'aha', 'bha', 'benzoyl_peroxide'].includes(tag),
          )
        : true,
    );

  for (const category of preferredOrder) {
    const match = candidates.find(
      (score) =>
        score.category === category && !usedCategories.has(score.category),
    );
    if (!match) continue;
    selected.push(match);
    usedCategories.add(match.category);
  }

  const limit =
    inputs.requestContext?.intensity === 'minimal'
      ? requiresOwnedDaytimeSpf(inputs)
        ? 3
        : 2
      : 4;
  return selected.slice(0, limit);
}

function preferredCategoryOrder(
  inputs: SuggestionGenerationInputs,
): ProductCategory[] {
  if (inputs.requestSource === SuggestionRequestSource.OnDemand) {
    switch (inputs.requestContext?.intent) {
      case 'post_workout':
      case 'post_makeup_or_shower':
        return [
          ProductCategory.Cleanser,
          ProductCategory.Moisturizer,
          ProductCategory.SunProtection,
        ];
      case 'post_sun':
      case 'post_swim':
        return [
          ProductCategory.Cleanser,
          ProductCategory.Moisturizer,
          ProductCategory.SunProtection,
        ];
      case 'event_prep':
        return [
          ProductCategory.Cleanser,
          ProductCategory.Serum,
          ProductCategory.Moisturizer,
          ProductCategory.SunProtection,
        ];
      case 'quick_refresh':
      case 'travel_refresh':
        return [ProductCategory.Moisturizer, ProductCategory.SunProtection];
      case 'other':
      case undefined:
        break;
    }
  }

  if (prefersMinimalRoutine(inputs)) {
    return inputs.daypart === SuggestionDaypart.Evening
      ? [ProductCategory.Cleanser, ProductCategory.Moisturizer]
      : [
          ProductCategory.Cleanser,
          ProductCategory.Moisturizer,
          ProductCategory.SunProtection,
        ];
  }

  if (shouldAvoidStrongActives(inputs)) {
    return inputs.daypart === SuggestionDaypart.Evening
      ? [ProductCategory.Cleanser, ProductCategory.Moisturizer]
      : [
          ProductCategory.Cleanser,
          ProductCategory.Moisturizer,
          ProductCategory.SunProtection,
        ];
  }

  if (inputs.daypart === SuggestionDaypart.Evening) {
    return [
      ProductCategory.Cleanser,
      ProductCategory.Serum,
      ProductCategory.Treatment,
      ProductCategory.Exfoliant,
      ProductCategory.Moisturizer,
    ];
  }

  return [
    ProductCategory.Cleanser,
    ProductCategory.Serum,
    ProductCategory.Moisturizer,
    ProductCategory.SunProtection,
  ];
}

function shouldAvoidStrongActives(inputs: SuggestionGenerationInputs): boolean {
  return (
    inputs.contextSummary.reaction.hasSignal ||
    inputs.contextSummary.reaction.barrierCompromised ||
    inputs.contextSummary.routineBreak.recentlyResumed ||
    inputs.contextSummary.applicationPatterns.conservativeRestart ||
    hasPregnancyOrMedicationCaution(inputs)
  );
}

function hasPregnancyOrMedicationCaution(
  inputs: SuggestionGenerationInputs,
): boolean {
  const safetyValues = Object.values(inputs.skinProfile?.safety_context ?? {});
  const text = JSON.stringify([
    inputs.skinProfile?.pregnancy_status ?? '',
    safetyValues,
    inputs.skinProfile?.under_dermatologist_care ?? '',
  ]).toLowerCase();
  return /(pregnan|breastfeed|trying|conceiv|medication)/i.test(text);
}

function requiresOwnedDaytimeSpf(inputs: SuggestionGenerationInputs): boolean {
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

function prefersMinimalRoutine(inputs: SuggestionGenerationInputs): boolean {
  const preferences = inputs.skinProfile?.routine_preferences;
  if (preferences?.pace === 'minimal') return true;
  if (
    inputs.daypart === SuggestionDaypart.Morning &&
    typeof preferences?.am_minutes === 'number' &&
    preferences.am_minutes <= 5
  ) {
    return true;
  }
  if (
    inputs.daypart === SuggestionDaypart.Evening &&
    typeof preferences?.pm_minutes === 'number' &&
    preferences.pm_minutes <= 5
  ) {
    return true;
  }
  return false;
}

function productScoreToStep(
  product: InventoryProduct,
  score: SuggestionProductScore,
  index: number,
): SuggestionGenerationStepOutput {
  return {
    stepOrder: index,
    routineStepId: null,
    inventoryProductId: product.id,
    productBrand: product.brand,
    productName: product.name,
    stepLabel: product.category,
    customLabel: null,
    applicationMethod: toHumanApplicationMethod(
      product.guidance?.applicationMethod ?? null,
    ),
    quantity: toHumanQuantity(product.guidance?.quantity ?? null),
    waitAfterMinutes: score.waitMinutes,
    explanation:
      sanitizeSuggestionText(score.suitabilityReasons[0], {
        maxLength: 140,
        maxSentences: 1,
      }) ?? 'Selected from your shelf.',
    routineNote: null,
    provenance: SuggestionStepProvenance.AiAdded,
    chips: [
      {
        tone: SuggestionStepChipTone.Ai,
        text: 'Ritora baseline',
      },
    ],
    safetyWarnings: score.cautionReasons.length
      ? [
          {
            severity: 'info',
            message:
              sanitizeSuggestionText(score.cautionReasons[0], {
                maxLength: 160,
                maxSentences: 1,
              }) ?? '',
            ingredientSlugs: score.activeTags,
            sourceIds: score.evidenceSourceIds,
          },
        ]
      : [],
  };
}

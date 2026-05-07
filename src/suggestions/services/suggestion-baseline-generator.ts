import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ProductCategory } from '../../shelf/shelf.types';
import type {
  SuggestionGenerationInputs,
  SuggestionGenerationStepOutput,
} from './suggestion-ai-generator';
import {
  SuggestionEvidenceSourceId,
  SuggestionExplanationJson,
  SuggestionGapRecommendationJson,
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
  return {
    headline:
      inputs.requestSource === 'on_demand'
        ? 'Quick shelf suggestion'
        : 'Using your shelf today',
    body: [
      inputs.requestSource === 'on_demand'
        ? 'Ritora used your shelf and safety rules for this request.'
        : 'Ritora used your shelf and safety rules for this slot.',
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
    ],
  };
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

  if (
    (inputs.daypart === 'morning' || inputs.daypart === 'noon') &&
    !hasSunscreen
  ) {
    gaps.push({
      ingredientOrCategory: 'Broad-spectrum sunscreen SPF 30+',
      reason: 'Daytime routines need a sunscreen option.',
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

  return gaps.map((gap) => ({
    ...gap,
    sourceIds: mergeEvidenceSourceIds(gap.sourceIds),
  }));
}

function selectBaselineProducts(
  inputs: SuggestionGenerationInputs,
): SuggestionProductScore[] {
  const preferredOrder = preferredCategoryOrder(inputs);
  const selected: SuggestionProductScore[] = [];
  const usedCategories = new Set<ProductCategory>();
  const candidates = inputs.contextSummary.productScores
    .filter((score) => score.suitabilityScore >= 40)
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

  return selected.slice(
    0,
    inputs.requestContext?.intensity === 'minimal' ? 2 : 4,
  );
}

function preferredCategoryOrder(
  inputs: SuggestionGenerationInputs,
): ProductCategory[] {
  if (inputs.requestSource === 'on_demand') {
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

  if (shouldAvoidStrongActives(inputs)) {
    return inputs.daypart === 'evening'
      ? [ProductCategory.Cleanser, ProductCategory.Moisturizer]
      : [
          ProductCategory.Cleanser,
          ProductCategory.Moisturizer,
          ProductCategory.SunProtection,
        ];
  }

  if (inputs.daypart === 'evening') {
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
    inputs.contextSummary.applicationPatterns.conservativeRestart
  );
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
    provenance: 'ai_added',
    chips: [
      {
        tone: 'ai',
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

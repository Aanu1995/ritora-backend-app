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
    headline: 'Source-backed fallback suggestion',
    body: [
      'OpenAI was unavailable or not configured, so Ritora used your scored shelf context and deterministic safety rules.',
    ],
    perStepReasons: steps.map((step) => ({
      stepOrder: step.stepOrder,
      reason:
        step.explanation ?? 'Selected from the highest scoring shelf fit.',
    })),
    skipped: inputs.contextSummary.skippedCandidates.map((candidate) => {
      const product = inputs.contextSummary.productScores.find(
        (score) => score.productId === candidate.productId,
      );
      return {
        name: product
          ? `${product.brand} ${product.name}`
          : candidate.productId,
        reason: candidate.reason,
      };
    }),
    inputs: [
      {
        label: 'Evidence',
        detail: `${inputs.contextSummary.evidenceSources.length} trusted source summaries were available to the safety rules.`,
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
      reason:
        'Daytime routines need a sunscreen option, especially when recent or planned actives may increase sun sensitivity.',
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
      reason:
        'Recent reaction or barrier signals make a simple moisturizer useful for fallback routines.',
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
      inputs.contextSummary.reaction.hasSignal ||
      inputs.contextSummary.reaction.barrierCompromised
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

  return selected.slice(0, 4);
}

function preferredCategoryOrder(
  inputs: SuggestionGenerationInputs,
): ProductCategory[] {
  if (
    inputs.contextSummary.reaction.hasSignal ||
    inputs.contextSummary.reaction.barrierCompromised
  ) {
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
    applicationMethod: product.guidance?.applicationMethod ?? null,
    quantity: product.guidance?.quantity ?? null,
    waitAfterMinutes: score.waitMinutes,
    explanation: score.suitabilityReasons[0] ?? 'Selected from your shelf.',
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
            message: score.cautionReasons[0],
            ingredientSlugs: score.activeTags,
            sourceIds: score.evidenceSourceIds,
          },
        ]
      : [],
  };
}

import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import {
  PreferredTimeOfDay,
  ProductCategory,
  ShelfStatus,
} from '../../shelf/shelf.types';
import { getProductIntroductionSuggestionGuidance } from '../../shelf/product-introduction.policy';
import type {
  SuggestionIngredientConflictSummary,
  SuggestionProductScore,
} from '../suggestion-context.types';
import type { EnvironmentContextSummary } from '../../environment-intelligence/environment-intelligence.types';
import {
  buildEnvironmentAdaptationPolicy,
  isDryHumidity,
  isHighUvRisk,
} from '../../environment-intelligence/environment-adaptation-policy';
import {
  SuggestionDaypart,
  SuggestionEvidenceSourceId,
} from '../suggestions.constants';
import {
  mergeEvidenceSourceIds,
  sourceIdsForActiveTags,
} from './suggestion-evidence-sources';
import {
  scoreSuggestionProductGoalFit,
  SuggestionProductGoalFitReason,
} from './suggestion-goal-intelligence';

export { SuggestionProductGoalFitReason } from './suggestion-goal-intelligence';

export const SUGGESTION_PRODUCT_SCORING_VERSION =
  'selection-evidence-ingredient-conflicts-2026-06-24';

const SINGLE_USE_SUGGESTION_CATEGORIES = new Set<ProductCategory>([
  ProductCategory.Cleanser,
  ProductCategory.SunProtection,
  ProductCategory.Mask,
  ProductCategory.Exfoliant,
]);

export function isSingleUseSuggestionCategory(
  category: ProductCategory,
): boolean {
  return SINGLE_USE_SUGGESTION_CATEGORIES.has(category);
}

export enum SuggestionProductDataWarning {
  IngredientListMissing = 'ingredient list missing',
  ProductCategoryNeedsReview = 'product category needs review',
  ApplicationGuidanceMissing = 'application guidance missing',
  KeyActiveIngredientsNotMatched = 'key active ingredients not matched',
  StrongActiveCautionsMissing = 'strong active cautions missing',
}

export type ProductIngredientIntelligence = {
  matchedIngredientCount: number;
  totalIngredientCount: number;
  conflicts?: SuggestionIngredientConflictSummary[];
};

const ACTIVE_TAG_PATTERNS: Array<{ tag: string; pattern: RegExp }> = [
  { tag: 'retinoid', pattern: /retinol|retinal|retinoid|tretinoin|adapalene/i },
  {
    tag: 'aha',
    pattern: /glycolic|lactic|mandelic|alpha hydroxy|\baha\b/i,
  },
  {
    tag: 'bha',
    pattern: /salicylic|beta hydroxy|\bbha\b/i,
  },
  { tag: 'pha', pattern: /gluconolactone|lactobionic|polyhydroxy|\bpha\b/i },
  { tag: 'vitamin_c', pattern: /ascorbic|vitamin c|ascorbyl/i },
  { tag: 'benzoyl_peroxide', pattern: /benzoyl peroxide/i },
  { tag: 'azelaic_acid', pattern: /azelaic acid/i },
  { tag: 'niacinamide', pattern: /niacinamide/i },
  { tag: 'ceramide', pattern: /ceramide/i },
  {
    tag: 'humectant',
    pattern: /glycerin|glycerol|hyaluronic acid|urea|panthenol/i,
  },
  {
    tag: 'barrier_support',
    pattern: /squalane|fatty acid|cholesterol|shea butter|cocoa butter/i,
  },
  {
    tag: 'spf',
    pattern:
      /\bspf\b|sunscreen|uv filter|avobenzone|zinc oxide|titanium dioxide|uvinul|tinosorb|octocrylene/i,
  },
];
export function scoreProductForSuggestion(
  product: InventoryProduct,
  options: {
    daypart: SuggestionDaypart;
    primaryGoal: string | null;
    secondaryGoals?: string[];
    sensitivityLevel: string | null;
    recentUseCount: number;
    adherenceCount?: number;
    reactionSkipCount?: number;
    substitutionCount?: number;
    recentSameDaypartSuggestionCount?: number;
    hasReactionSignal: boolean;
    lockedProductIds: Set<string>;
    conservativeRestart: boolean;
    ingredientIntelligence?: ProductIngredientIntelligence;
    environment?: EnvironmentContextSummary | null;
    targetDate?: string;
  },
): SuggestionProductScore {
  const activeTags = detectActiveTags(product);
  const productDataQuality = assessProductDataQuality(
    product,
    activeTags,
    options.ingredientIntelligence,
  );
  const ingredientConflicts = options.ingredientIntelligence?.conflicts ?? [];
  const evidenceSourceIds = mergeEvidenceSourceIds(
    buildProductEvidenceSourceIds(product.category, activeTags),
    options.environment?.sourceIds ?? [],
  );
  const reasons: string[] = [];
  const cautions: string[] = [
    ...(product.guidance?.cautions ?? []),
    ...productDataQuality.warnings,
  ];
  let score = product.status === ShelfStatus.Active ? 55 : 0;

  if (product.identity?.inciIngredients?.length) {
    score += 10;
    reasons.push('ingredient list available');
  }
  if (options.lockedProductIds.has(product.id)) {
    score += 25;
    reasons.push('specialist-locked step');
  }
  if (product.user_fields?.preferredTimeOfDay) {
    score += scorePreferredTime(
      product.user_fields.preferredTimeOfDay,
      options.daypart,
      reasons,
      cautions,
    );
  }
  const goalFit = scoreSuggestionProductGoalFit(product, {
    primaryGoal: options.primaryGoal,
    secondaryGoals: options.secondaryGoals ?? [],
    activeTags,
  });
  if (goalFit.primaryMatch) {
    score += 16;
    reasons.push(SuggestionProductGoalFitReason.PrimarySelectedGoal);
  }
  if (goalFit.secondaryMatch) {
    score += 8;
    reasons.push(SuggestionProductGoalFitReason.SecondarySelectedGoal);
  }
  if ((options.reactionSkipCount ?? 0) > 0) {
    score -= Math.min(16, (options.reactionSkipCount ?? 0) * 8);
    cautions.push('recent reaction-related skip by user');
  }
  if ((options.substitutionCount ?? 0) > 0) {
    score -= Math.min(12, (options.substitutionCount ?? 0) * 6);
    cautions.push('recently substituted by user');
  }
  if (
    (options.recentSameDaypartSuggestionCount ?? 0) > 0 &&
    !isEssentialCurrentContextProduct(product, activeTags, options)
  ) {
    score -= Math.min(16, (options.recentSameDaypartSuggestionCount ?? 0) * 8);
    cautions.push('recent same-daypart repeat');
  }
  if (options.recentUseCount > 4 && activeTags.some(isStrongActiveTag)) {
    score -= 18;
    cautions.push('strong active used often recently');
  }
  if (options.hasReactionSignal && activeTags.some(isStrongActiveTag)) {
    score -= 35;
    cautions.push('pause strong actives while reaction signal is present');
  }
  if (
    isDaytimeSuggestion(options.daypart) &&
    product.category === ProductCategory.SunProtection
  ) {
    score += 25;
    reasons.push('daytime sun protection fit');
  }
  if (productDataQuality.quality === 'verified') {
    score += 8;
    reasons.push('product data verified enough for AI ranking');
  }
  if (productDataQuality.quality === 'insufficient') {
    score -= 20;
    cautions.push('product data is incomplete; suggestion confidence reduced');
  }
  score += scoreProductIntroductionPace(product, reasons, cautions);
  if (options.environment) {
    const environmentScore = buildEnvironmentAdaptationPolicy(
      options.environment,
    ).scoreCategory(product.category);
    score += environmentScore;
    if (
      activeTags.some(isStrongActiveTag) &&
      isDryHumidity(options.environment.humidityBand)
    ) {
      score -= 14;
      if (!cautions.includes('dry air can make strong actives feel harsher')) {
        cautions.push('dry air can make strong actives feel harsher');
      }
    }
    applyEnvironmentReasons(
      product.category,
      options.environment,
      reasons,
      cautions,
    );
  }
  if (isExpiredForTargetDate(product, options.targetDate)) {
    score -= 20;
    cautions.push('product may be expired');
  }

  return {
    productId: product.id,
    brand: product.brand,
    name: product.name,
    category: product.category,
    preferredTimeOfDay: product.user_fields?.preferredTimeOfDay ?? null,
    openedAt: product.opened_at?.toISOString() ?? null,
    expiresAt: product.expires_at?.toISOString() ?? null,
    effectiveExpiresAt: product.effective_expires_at?.toISOString() ?? null,
    introductionStatus: product.introduction_status ?? null,
    introductionStartedAt:
      product.introduction_started_at?.toISOString() ?? null,
    introductionStatusUpdatedAt:
      product.introduction_status_updated_at?.toISOString() ?? null,
    benefits: product.identity?.benefits?.slice(0, 8) ?? [],
    suitedFor: product.identity?.suitedFor?.slice(0, 8) ?? [],
    applicationMethod: product.guidance?.applicationMethod ?? null,
    quantity: product.guidance?.quantity ?? null,
    guidanceSteps: product.guidance?.steps?.slice(0, 6) ?? [],
    guidanceCautions: product.guidance?.cautions?.slice(0, 8) ?? [],
    userProductNote: product.user_fields?.personalNotes ?? null,
    activeTags,
    suitabilityScore: Math.max(0, Math.min(100, score)),
    suitabilityReasons: reasons,
    cautionReasons: cautions,
    waitMinutes: product.guidance?.waitMinutes ?? null,
    inciQuality: product.identity?.inciIngredients?.length
      ? 'available'
      : 'missing',
    dataQuality: productDataQuality.quality,
    dataQualityWarnings: productDataQuality.warnings,
    ingredientConflicts,
    evidenceSourceIds,
  };
}

function scoreProductIntroductionPace(
  product: InventoryProduct,
  reasons: string[],
  cautions: string[],
): number {
  const guidance = getProductIntroductionSuggestionGuidance(
    product.introduction_status,
  );

  if (guidance.suitabilityReason) {
    reasons.push(guidance.suitabilityReason);
  }
  if (guidance.cautionReason) {
    cautions.push(guidance.cautionReason);
  }

  return guidance.scoreAdjustment;
}

export function assessProductDataQuality(
  product: InventoryProduct,
  activeTags: string[] = detectActiveTags(product),
  ingredientIntelligence?: ProductIngredientIntelligence,
): {
  quality: SuggestionProductScore['dataQuality'];
  warnings: string[];
} {
  const warnings: string[] = [];
  const hasIngredients = (product.identity?.inciIngredients ?? []).length > 0;
  const hasMatchedIngredientIntelligence =
    ingredientIntelligence === undefined ||
    ingredientIntelligence.totalIngredientCount === 0 ||
    ingredientIntelligence.matchedIngredientCount > 0;
  const hasGuidance = Boolean(
    product.guidance?.applicationMethod ||
    product.guidance?.quantity ||
    (product.guidance?.steps?.length ?? 0) > 0,
  );
  if (!hasIngredients) {
    warnings.push(SuggestionProductDataWarning.IngredientListMissing);
  }
  if (hasIngredients && !hasMatchedIngredientIntelligence) {
    warnings.push(SuggestionProductDataWarning.KeyActiveIngredientsNotMatched);
  }
  if (product.category === ProductCategory.Other) {
    warnings.push(SuggestionProductDataWarning.ProductCategoryNeedsReview);
  }
  if (!hasGuidance) {
    warnings.push(SuggestionProductDataWarning.ApplicationGuidanceMissing);
  }
  if (
    activeTags.some(isStrongActiveTag) &&
    (product.guidance?.cautions?.length ?? 0) === 0
  ) {
    warnings.push(SuggestionProductDataWarning.StrongActiveCautionsMissing);
  }

  if (!hasIngredients || product.category === ProductCategory.Other) {
    return { quality: 'insufficient', warnings };
  }
  if (hasGuidance && warnings.length === 0) {
    return { quality: 'verified', warnings };
  }
  return { quality: 'partial', warnings };
}

export function detectActiveTags(product: InventoryProduct): string[] {
  const text = [
    product.brand,
    product.name,
    product.category,
    product.identity?.description ?? '',
    ...(product.identity?.inciIngredients ?? []),
    ...(product.guidance?.cautions ?? []),
    ...(product.identity?.benefits ?? []),
  ].join(' ');
  return ACTIVE_TAG_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(
    ({ tag }) => tag,
  );
}

export function isStrongActiveTag(tag: string): boolean {
  return ['retinoid', 'aha', 'bha', 'benzoyl_peroxide'].includes(tag);
}

export function isLeaveOnStrongActiveScore(score: {
  category: ProductCategory;
  activeTags: readonly string[];
}): boolean {
  return (
    score.category !== ProductCategory.Cleanser &&
    score.activeTags.some(isStrongActiveTag)
  );
}

function buildProductEvidenceSourceIds(
  category: ProductCategory,
  activeTags: string[],
): SuggestionEvidenceSourceId[] {
  const categorySourceIds =
    category === ProductCategory.SunProtection
      ? [SuggestionEvidenceSourceId.AadSunscreenSelection]
      : [];
  return mergeEvidenceSourceIds(
    categorySourceIds,
    sourceIdsForActiveTags(activeTags),
  );
}

function scorePreferredTime(
  preferredTime: PreferredTimeOfDay,
  daypart: SuggestionDaypart,
  reasons: string[],
  cautions: string[],
): number {
  if (preferredTime === PreferredTimeOfDay.Either) {
    reasons.push('product can be used any time');
    return 6;
  }
  if (isPreferredTimeCompatibleWithDaypart(preferredTime, daypart)) {
    reasons.push('matches preferred time of day');
    return 12;
  }
  cautions.push('preferred time of day does not match this slot');
  return -12;
}

function isDaytimeSuggestion(daypart: SuggestionDaypart): boolean {
  return (
    daypart === SuggestionDaypart.Morning || daypart === SuggestionDaypart.Noon
  );
}

export function isPreferredTimeCompatibleWithDaypart(
  preferredTime: PreferredTimeOfDay | null | undefined,
  daypart: SuggestionDaypart,
): boolean {
  if (!preferredTime || preferredTime === PreferredTimeOfDay.Either) {
    return true;
  }
  if (preferredTime === PreferredTimeOfDay.Morning) {
    return isDaytimeSuggestion(daypart);
  }
  return daypart === SuggestionDaypart.Evening;
}

function isEssentialCurrentContextProduct(
  product: InventoryProduct,
  activeTags: string[],
  options: {
    daypart: SuggestionDaypart;
    lockedProductIds: Set<string>;
    hasReactionSignal: boolean;
  },
): boolean {
  return (
    options.lockedProductIds.has(product.id) ||
    product.category === ProductCategory.SunProtection ||
    (options.hasReactionSignal &&
      (product.category === ProductCategory.Moisturizer ||
        activeTags.some(
          (tag) => tag === 'barrier_support' || tag === 'ceramide',
        )))
  );
}

function isExpiredForTargetDate(
  product: InventoryProduct,
  targetDate: string | undefined,
): boolean {
  if (!targetDate || !product.effective_expires_at) return false;
  const targetEnd = new Date(`${targetDate}T23:59:59.999Z`).getTime();
  return product.effective_expires_at.getTime() < targetEnd;
}

function applyEnvironmentReasons(
  category: ProductCategory,
  environment: EnvironmentContextSummary,
  reasons: string[],
  cautions: string[],
): void {
  if (
    category === ProductCategory.SunProtection &&
    isHighUvRisk(environment.uvRisk)
  ) {
    reasons.push('high UV fit');
  }
  if (
    category === ProductCategory.Moisturizer &&
    isDryHumidity(environment.humidityBand)
  ) {
    reasons.push('dry air barrier support');
  }
  if (
    category === ProductCategory.Exfoliant &&
    isDryHumidity(environment.humidityBand)
  ) {
    cautions.push('dry air can make exfoliation feel harsher');
  }
}

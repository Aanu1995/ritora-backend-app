import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import {
  PreferredTimeOfDay,
  ProductCategory,
  ShelfStatus,
} from '../../shelf/shelf.types';
import { SuggestionProductScore } from '../suggestion-context.types';
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
    skipCount?: number;
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
  if ((options.adherenceCount ?? 0) > 0) {
    score += Math.min(8, (options.adherenceCount ?? 0) * 2);
    reasons.push('recently applied by user');
  }
  if ((options.skipCount ?? 0) > 0) {
    score -= Math.min(16, (options.skipCount ?? 0) * 8);
    cautions.push('recently skipped by user');
  }
  if ((options.substitutionCount ?? 0) > 0) {
    score -= Math.min(12, (options.substitutionCount ?? 0) * 6);
    cautions.push('recently substituted by user');
  }
  if (
    (options.recentSameDaypartSuggestionCount ?? 0) > 0 &&
    !isRepeatProtectedProduct(product, activeTags, options)
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
  if (options.conservativeRestart && activeTags.some(isStrongActiveTag)) {
    score -= 30;
    cautions.push('restart gently before using strong actives again');
  }
  if (isDaytimeSuggestion(options.daypart) && activeTags.includes('retinoid')) {
    score -= 25;
    cautions.push('retinoid is usually better suited to evening');
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
  if (options.environment) {
    const environmentScore = buildEnvironmentAdaptationPolicy(
      options.environment,
    ).scoreCategory(product.category);
    score += environmentScore;
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
    evidenceSourceIds,
  };
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

function isRepeatProtectedProduct(
  product: InventoryProduct,
  activeTags: string[],
  options: {
    daypart: SuggestionDaypart;
    lockedProductIds: Set<string>;
    hasReactionSignal: boolean;
    recentUseCount: number;
  },
): boolean {
  return (
    options.lockedProductIds.has(product.id) ||
    product.category === ProductCategory.SunProtection ||
    (options.hasReactionSignal &&
      (product.category === ProductCategory.Moisturizer ||
        activeTags.some(
          (tag) => tag === 'barrier_support' || tag === 'ceramide',
        ))) ||
    options.recentUseCount >= 6
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

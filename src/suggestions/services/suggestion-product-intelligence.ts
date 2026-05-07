import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import {
  PreferredTimeOfDay,
  ProductCategory,
  ShelfStatus,
} from '../../shelf/shelf.types';
import { SuggestionProductScore } from '../suggestion-context.types';
import { SuggestionEvidenceSourceId } from '../suggestions.constants';
import {
  mergeEvidenceSourceIds,
  sourceIdsForActiveTags,
} from './suggestion-evidence-sources';

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
    daypart: 'morning' | 'noon' | 'evening';
    primaryGoal: string | null;
    sensitivityLevel: string | null;
    recentUseCount: number;
    hasReactionSignal: boolean;
    lockedProductIds: Set<string>;
    conservativeRestart: boolean;
  },
): SuggestionProductScore {
  const activeTags = detectActiveTags(product);
  const productDataQuality = assessProductDataQuality(product, activeTags);
  const evidenceSourceIds = buildProductEvidenceSourceIds(
    product.category,
    activeTags,
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
  if (matchesGoal(product, options.primaryGoal)) {
    score += 12;
    reasons.push('matches primary skin goal');
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
  if (
    (options.daypart === 'morning' || options.daypart === 'noon') &&
    activeTags.includes('retinoid')
  ) {
    score -= 25;
    cautions.push('retinoid is usually better suited to evening');
  }
  if (
    (options.daypart === 'morning' || options.daypart === 'noon') &&
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
): {
  quality: SuggestionProductScore['dataQuality'];
  warnings: string[];
} {
  const warnings: string[] = [];
  const hasIngredients = (product.identity?.inciIngredients ?? []).length > 0;
  const hasConfirmedInci = Boolean(product.identity?.inciLastConfirmedAt);
  const hasGuidance = Boolean(
    product.guidance?.applicationMethod ||
    product.guidance?.quantity ||
    (product.guidance?.steps?.length ?? 0) > 0,
  );
  if (!hasIngredients) warnings.push('ingredient list missing');
  if (hasIngredients && !hasConfirmedInci) {
    warnings.push('ingredient list not recently verified');
  }
  if (product.category === ProductCategory.Other) {
    warnings.push('product category needs review');
  }
  if (!product.user_fields?.preferredTimeOfDay) {
    warnings.push('preferred time of day missing');
  }
  if (!hasGuidance) warnings.push('application guidance missing');
  if (product.guidance?.waitMinutes === null) {
    warnings.push('wait time missing');
  }
  if (
    activeTags.some(isStrongActiveTag) &&
    (product.guidance?.cautions?.length ?? 0) === 0
  ) {
    warnings.push('strong active cautions missing');
  }

  if (!hasIngredients || product.category === ProductCategory.Other) {
    return { quality: 'insufficient', warnings };
  }
  if (
    hasConfirmedInci &&
    hasGuidance &&
    product.user_fields?.preferredTimeOfDay &&
    warnings.length <= 1
  ) {
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
  daypart: 'morning' | 'noon' | 'evening',
  reasons: string[],
  cautions: string[],
): number {
  if (preferredTime === PreferredTimeOfDay.Either) {
    reasons.push('product can be used any time');
    return 6;
  }
  if (
    (preferredTime === PreferredTimeOfDay.Morning &&
      (daypart === 'morning' || daypart === 'noon')) ||
    (preferredTime === PreferredTimeOfDay.Evening && daypart === 'evening')
  ) {
    reasons.push('matches preferred time of day');
    return 12;
  }
  cautions.push('preferred time of day does not match this slot');
  return -12;
}

function matchesGoal(
  product: InventoryProduct,
  primaryGoal: string | null,
): boolean {
  if (!primaryGoal) return false;
  const goal = primaryGoal.toLowerCase();
  const text = [
    product.category,
    ...(product.identity?.benefits ?? []),
    ...(product.identity?.suitedFor ?? []),
  ]
    .join(' ')
    .toLowerCase();
  return goal
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .some((token) => token.length > 3 && text.includes(token));
}

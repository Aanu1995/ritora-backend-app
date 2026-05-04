import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import {
  PreferredTimeOfDay,
  ProductCategory,
  ShelfStatus,
} from '../../shelf/shelf.types';
import { SuggestionProductScore } from '../suggestion-context.types';

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
  { tag: 'vitamin_c', pattern: /ascorbic|vitamin c|ascorbyl/i },
  { tag: 'benzoyl_peroxide', pattern: /benzoyl peroxide/i },
  { tag: 'niacinamide', pattern: /niacinamide/i },
  { tag: 'ceramide', pattern: /ceramide/i },
  { tag: 'spf', pattern: /\bspf\b|sunscreen|uv filter|avobenzone|zinc oxide/i },
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
  },
): SuggestionProductScore {
  const activeTags = detectActiveTags(product);
  const reasons: string[] = [];
  const cautions: string[] = [...(product.guidance?.cautions ?? [])];
  let score = product.status === ShelfStatus.Active ? 55 : 0;

  if (product.identity?.inciIngredients?.length) {
    score += 10;
    reasons.push('ingredient list available');
  } else {
    cautions.push('ingredient list missing');
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
  };
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

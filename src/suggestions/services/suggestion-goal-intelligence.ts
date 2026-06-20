import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ProductCategory } from '../../shelf/shelf.types';

export enum SuggestionGoalIntent {
  PigmentTone = 'pigment_tone',
  AcneBreakouts = 'acne_breakouts',
  TexturePores = 'texture_pores',
  BarrierCalm = 'barrier_calm',
  Hydration = 'hydration',
  AgingFirmness = 'aging_firmness',
}

export enum SuggestionProductGoalFitReason {
  PrimarySelectedGoal = 'supports main skin profile goal',
  SecondarySelectedGoal = 'supports selected skin profile goal',
}

export interface SuggestionProductGoalFit {
  primaryMatch: boolean;
  secondaryMatch: boolean;
  primaryIntents: SuggestionGoalIntent[];
  secondaryIntents: SuggestionGoalIntent[];
}

const GOAL_INTENT_TRIGGERS: Record<SuggestionGoalIntent, readonly RegExp[]> = {
  [SuggestionGoalIntent.PigmentTone]: [
    /dark spots?/i,
    /dark marks?/i,
    /hyperpigmentation/i,
    /post[-\s]?acne marks?/i,
    /\bpih\b/i,
    /melasma/i,
    /uneven tone/i,
    /pigment/i,
  ],
  [SuggestionGoalIntent.AcneBreakouts]: [
    /acne/i,
    /breakouts?/i,
    /blemish/i,
    /pimples?/i,
    /clogged pores?/i,
  ],
  [SuggestionGoalIntent.TexturePores]: [
    /texture/i,
    /rough/i,
    /bumpy/i,
    /bumps/i,
    /pores?/i,
    /smooth/i,
  ],
  [SuggestionGoalIntent.BarrierCalm]: [
    /barrier/i,
    /redness/i,
    /irritation/i,
    /sensitive/i,
    /calm/i,
    /stinging/i,
  ],
  [SuggestionGoalIntent.Hydration]: [
    /hydration/i,
    /hydrate/i,
    /dehydrat/i,
    /dryness/i,
    /\bdry\b/i,
    /plump/i,
  ],
  [SuggestionGoalIntent.AgingFirmness]: [
    /fine lines?/i,
    /wrinkles?/i,
    /aging/i,
    /ageing/i,
    /firm/i,
  ],
};

const PRODUCT_INTENT_TEXT: Record<SuggestionGoalIntent, readonly RegExp[]> = {
  [SuggestionGoalIntent.PigmentTone]: [
    /\bspf\b/i,
    /sunscreen/i,
    /sun protection/i,
    /zinc oxide/i,
    /titanium dioxide/i,
    /vitamin c/i,
    /ascorb/i,
    /azelaic/i,
    /tranexamic/i,
    /kojic/i,
    /arbutin/i,
    /niacinamide/i,
    /retin/i,
    /mandelic/i,
    /glycolic/i,
    /lactic/i,
  ],
  [SuggestionGoalIntent.AcneBreakouts]: [
    /acne/i,
    /breakout/i,
    /blemish/i,
    /salicylic/i,
    /\bbha\b/i,
    /benzoyl peroxide/i,
    /azelaic/i,
    /adapalene/i,
    /retin/i,
    /sulfur/i,
    /clay/i,
  ],
  [SuggestionGoalIntent.TexturePores]: [
    /texture/i,
    /smooth/i,
    /pore/i,
    /exfol/i,
    /\baha\b/i,
    /\bbha\b/i,
    /\bpha\b/i,
    /glycolic/i,
    /lactic/i,
    /mandelic/i,
    /salicylic/i,
    /retin/i,
  ],
  [SuggestionGoalIntent.BarrierCalm]: [
    /barrier/i,
    /ceramide/i,
    /panthenol/i,
    /centella/i,
    /cica/i,
    /madecassoside/i,
    /allantoin/i,
    /niacinamide/i,
    /calm/i,
    /sensitive/i,
    /moisturi[sz]/i,
  ],
  [SuggestionGoalIntent.Hydration]: [
    /hydrat/i,
    /hyaluronic/i,
    /glycerin/i,
    /glycerol/i,
    /urea/i,
    /panthenol/i,
    /beta[-\s]?glucan/i,
    /moisturi[sz]/i,
  ],
  [SuggestionGoalIntent.AgingFirmness]: [
    /fine lines?/i,
    /wrinkles?/i,
    /firm/i,
    /retin/i,
    /peptide/i,
    /matrixyl/i,
    /argireline/i,
    /vitamin c/i,
    /antioxidant/i,
  ],
};

export function scoreSuggestionProductGoalFit(
  product: InventoryProduct,
  input: {
    primaryGoal: string | null;
    secondaryGoals: readonly string[];
    activeTags: readonly string[];
  },
): SuggestionProductGoalFit {
  const productText = buildProductGoalText(product, input.activeTags);
  const primaryIntents = detectGoalIntents(input.primaryGoal);
  const secondaryIntents = input.secondaryGoals.flatMap(detectGoalIntents);

  return {
    primaryMatch:
      directGoalTextMatch(productText, input.primaryGoal) ||
      primaryIntents.some((intent) =>
        productSupportsIntent(product, productText, intent),
      ),
    secondaryMatch:
      input.secondaryGoals.some((goal) =>
        directGoalTextMatch(productText, goal),
      ) ||
      secondaryIntents.some((intent) =>
        productSupportsIntent(product, productText, intent),
      ),
    primaryIntents: unique(primaryIntents),
    secondaryIntents: unique(secondaryIntents),
  };
}

function detectGoalIntents(goal: string | null): SuggestionGoalIntent[] {
  if (!goal) return [];
  return Object.values(SuggestionGoalIntent).filter((intent) =>
    GOAL_INTENT_TRIGGERS[intent].some((pattern) => pattern.test(goal)),
  );
}

function productSupportsIntent(
  product: InventoryProduct,
  productText: string,
  intent: SuggestionGoalIntent,
): boolean {
  if (
    intent === SuggestionGoalIntent.PigmentTone &&
    product.category === ProductCategory.SunProtection
  ) {
    return true;
  }
  if (
    intent === SuggestionGoalIntent.BarrierCalm &&
    product.category === ProductCategory.Moisturizer
  ) {
    return true;
  }
  if (
    intent === SuggestionGoalIntent.Hydration &&
    (product.category === ProductCategory.Moisturizer ||
      product.category === ProductCategory.Essence ||
      product.category === ProductCategory.Toner)
  ) {
    return true;
  }
  if (
    intent === SuggestionGoalIntent.TexturePores &&
    product.category === ProductCategory.Exfoliant
  ) {
    return true;
  }
  return PRODUCT_INTENT_TEXT[intent].some((pattern) =>
    pattern.test(productText),
  );
}

function buildProductGoalText(
  product: InventoryProduct,
  activeTags: readonly string[],
): string {
  return [
    product.brand,
    product.name,
    product.category,
    product.identity?.description ?? '',
    ...(product.identity?.benefits ?? []),
    ...(product.identity?.suitedFor ?? []),
    ...(product.identity?.inciIngredients ?? []),
    ...(product.guidance?.cautions ?? []),
    ...activeTags,
  ]
    .join(' ')
    .toLowerCase();
}

function directGoalTextMatch(
  productText: string,
  goal: string | null,
): boolean {
  if (!goal) return false;
  return goal
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3)
    .some((token) => productText.includes(token));
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

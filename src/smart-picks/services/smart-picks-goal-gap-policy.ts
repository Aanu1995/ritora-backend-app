import type { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import type { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import { SuggestionEvidenceSourceId } from '../../suggestions/suggestions.constants';
import {
  SmartPicksBudgetTier,
  SmartPicksCoverage,
  SmartPicksGapKind,
} from '../smart-picks.types';
import type { SmartPicksContext } from './smart-picks-context-builder';

type GapPriority = 'priority' | 'consider';
type BudgetScope = 'all' | 'ready-to-spend';

export interface SmartPicksGoalGapCandidate {
  ingredientOrCategory: string;
  priority: GapPriority;
  reason: string;
  goalAlignment: string;
  sourceIds: SuggestionEvidenceSourceId[];
  gapKind: SmartPicksGapKind;
}

interface GoalProductRule {
  ingredientOrCategory: string;
  alignment: string;
  reason: string;
  ownedSignals: readonly string[];
  sourceIds: readonly SuggestionEvidenceSourceId[];
  budgetScope?: BudgetScope;
  avoidWhenPregnancyCaution?: boolean;
  onlyWhenPregnancyCaution?: boolean;
}

interface GoalPolicy {
  id: 'dark-spots' | 'acne' | 'texture' | 'barrier' | 'hydration' | 'aging';
  triggers: readonly string[];
  primary: readonly GoalProductRule[];
  considerations: readonly GoalProductRule[];
}

const READY_TO_SPEND_BUDGETS: readonly SmartPicksBudgetTier[] = [
  'premium',
  'luxury',
];

const GOAL_STOPWORDS = new Set([
  'achieve',
  'after',
  'around',
  'better',
  'clear',
  'from',
  'goal',
  'have',
  'improve',
  'keep',
  'make',
  'need',
  'reduce',
  'remove',
  'skin',
  'the',
  'want',
  'with',
]);

const GOAL_POLICIES: readonly GoalPolicy[] = [
  {
    id: 'dark-spots',
    triggers: [
      'dark spot',
      'dark spots',
      'dark mark',
      'dark marks',
      'hyperpigmentation',
      'post acne mark',
      'post-acne mark',
      'pih',
      'melasma',
      'uneven tone',
    ],
    primary: [
      {
        ingredientOrCategory:
          'PIH-focused serum with azelaic acid or tranexamic acid',
        alignment: 'dark spot support',
        reason:
          'Your goal is dark spots, and the active shelf does not yet show a clear pigment-support serum.',
        ownedSignals: [
          'azelaic',
          'tranexamic',
          'kojic',
          'alpha arbutin',
          'arbutin',
        ],
        sourceIds: [
          SuggestionEvidenceSourceId.DermNetPostInflammatoryHyperpigmentation,
          SuggestionEvidenceSourceId.AadMelasmaTreatment,
          SuggestionEvidenceSourceId.AadAcneTreatment,
        ],
      },
    ],
    considerations: [
      {
        ingredientOrCategory: 'Vitamin C antioxidant serum',
        alignment: 'dark spot support',
        reason:
          'Vitamin C can support uneven-tone goals when sunscreen and a pigment serum are already planned.',
        ownedSignals: ['vitamin c', 'ascorbic', 'ascorbyl', 'tetrahexyldecyl'],
        sourceIds: [
          SuggestionEvidenceSourceId.DermNetPostInflammatoryHyperpigmentation,
          SuggestionEvidenceSourceId.AadMelasmaTreatment,
        ],
      },
      {
        ingredientOrCategory: 'Gentle pigment-supporting mask or peel',
        alignment: 'dark spot support',
        reason:
          'A careful occasional mask or peel can be worth considering once the daily dark-spot routine is covered.',
        ownedSignals: [
          'mask',
          'peel',
          'mandelic',
          'lactic',
          'glycolic',
          'pha',
          'aha',
        ],
        sourceIds: [
          SuggestionEvidenceSourceId.FdaAhaSunSensitivity,
          SuggestionEvidenceSourceId.DermNetPostInflammatoryHyperpigmentation,
        ],
        budgetScope: 'ready-to-spend',
      },
      {
        ingredientOrCategory: 'Beginner retinoid night treatment',
        alignment: 'dark spot support',
        reason:
          'A gentle night retinoid can be a stronger support option when the safety context allows it.',
        ownedSignals: ['retinol', 'retinal', 'retinoid', 'adapalene'],
        sourceIds: [
          SuggestionEvidenceSourceId.AadRetinoidRetinol,
          SuggestionEvidenceSourceId.DermNetTopicalRetinoids,
        ],
        budgetScope: 'ready-to-spend',
        avoidWhenPregnancyCaution: true,
      },
    ],
  },
  {
    id: 'acne',
    triggers: ['acne', 'breakout', 'breakouts', 'blemish', 'pimple'],
    primary: [
      {
        ingredientOrCategory: 'Adapalene or benzoyl peroxide acne treatment',
        alignment: 'breakout control',
        reason:
          'Your goal points to breakouts, and the shelf does not yet show a clear leave-on breakout treatment lane.',
        ownedSignals: ['adapalene', 'benzoyl', 'benzoyl peroxide', 'retinoid'],
        sourceIds: [
          SuggestionEvidenceSourceId.AadAcneTreatment,
          SuggestionEvidenceSourceId.AadRetinoidRetinol,
          SuggestionEvidenceSourceId.DermNetTopicalRetinoids,
        ],
        avoidWhenPregnancyCaution: true,
      },
      {
        ingredientOrCategory: 'Benzoyl peroxide or azelaic acid acne treatment',
        alignment: 'breakout control',
        reason:
          'Your goal points to breakouts, and the safety context calls for avoiding retinoid-led picks.',
        ownedSignals: ['benzoyl', 'benzoyl peroxide', 'azelaic'],
        sourceIds: [SuggestionEvidenceSourceId.AadAcneTreatment],
        onlyWhenPregnancyCaution: true,
      },
    ],
    considerations: [
      {
        ingredientOrCategory: 'Azelaic acid acne-and-mark support serum',
        alignment: 'breakout control',
        reason:
          'Azelaic acid can support breakout-prone routines while also being useful when marks are part of the goal.',
        ownedSignals: ['azelaic'],
        sourceIds: [
          SuggestionEvidenceSourceId.AadAcneTreatment,
          SuggestionEvidenceSourceId.DermNetPostInflammatoryHyperpigmentation,
        ],
      },
      {
        ingredientOrCategory:
          'Leave-on salicylic acid or BHA for clogged pores',
        alignment: 'breakout control',
        reason:
          'A separate BHA lane is useful when clogged pores are part of the pattern and the shelf does not already show one.',
        ownedSignals: ['salicylic', 'bha', 'beta hydroxy'],
        sourceIds: [
          SuggestionEvidenceSourceId.AadAcneTreatment,
          SuggestionEvidenceSourceId.FdaAhaSunSensitivity,
        ],
      },
      {
        ingredientOrCategory:
          'Barrier-support moisturizer or serum for acne routines',
        alignment: 'breakout control',
        reason:
          'Acne routines work better when irritation is kept low, so barrier support is worth considering.',
        ownedSignals: [
          'niacinamide',
          'panthenol',
          'centella',
          'ceramide',
          'barrier',
          'cica',
          'moisturizer',
          'moisturiser',
        ],
        sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
      },
      {
        ingredientOrCategory: 'Clay or sulfur mask for congested weeks',
        alignment: 'breakout control',
        reason:
          'An occasional congestion mask can be useful without adding another daily active.',
        ownedSignals: ['clay', 'kaolin', 'bentonite', 'sulfur', 'mask'],
        sourceIds: [SuggestionEvidenceSourceId.AadAcneTreatment],
        budgetScope: 'ready-to-spend',
      },
    ],
  },
  {
    id: 'texture',
    triggers: ['texture', 'rough', 'bumpy', 'bumps', 'clogged', 'pore'],
    primary: [
      {
        ingredientOrCategory: 'Gentle AHA, PHA, or BHA texture treatment',
        alignment: 'texture support',
        reason:
          'Your goal points to texture, and the shelf does not yet show a clear resurfacing step.',
        ownedSignals: ['aha', 'pha', 'bha', 'glycolic', 'lactic', 'mandelic'],
        sourceIds: [
          SuggestionEvidenceSourceId.AadAcneTreatment,
          SuggestionEvidenceSourceId.FdaAhaSunSensitivity,
        ],
      },
    ],
    considerations: [
      {
        ingredientOrCategory: 'Smoothing retinoid night treatment',
        alignment: 'texture support',
        reason:
          'A retinoid can be a stronger long-view texture support when the safety context allows it.',
        ownedSignals: ['retinol', 'retinal', 'retinoid', 'adapalene'],
        sourceIds: [
          SuggestionEvidenceSourceId.AadRetinoidRetinol,
          SuggestionEvidenceSourceId.DermNetTopicalRetinoids,
        ],
        budgetScope: 'ready-to-spend',
        avoidWhenPregnancyCaution: true,
      },
      {
        ingredientOrCategory:
          'Barrier-support moisturizer or serum for texture routines',
        alignment: 'texture support',
        reason:
          'Texture routines are easier to keep consistent when the barrier-support lane is covered.',
        ownedSignals: [
          'niacinamide',
          'panthenol',
          'centella',
          'ceramide',
          'barrier',
          'cica',
          'moisturizer',
          'moisturiser',
        ],
        sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
      },
      {
        ingredientOrCategory: 'Occasional smoothing mask or peel',
        alignment: 'texture support',
        reason:
          'A careful occasional smoothing product can be useful when daily treatment lanes are already planned.',
        ownedSignals: ['mask', 'peel', 'enzyme', 'exfoliant'],
        sourceIds: [SuggestionEvidenceSourceId.FdaAhaSunSensitivity],
        budgetScope: 'ready-to-spend',
      },
    ],
  },
  {
    id: 'barrier',
    triggers: ['redness', 'irritation', 'sensitive', 'barrier', 'calm'],
    primary: [
      {
        ingredientOrCategory:
          'Barrier-calming serum with niacinamide, panthenol, or centella',
        alignment: 'calm and barrier support',
        reason:
          'Your goal points to sensitivity or barrier stress, and the shelf does not yet show a calming support step.',
        ownedSignals: [
          'niacinamide',
          'panthenol',
          'centella',
          'madecassoside',
          'allantoin',
        ],
        sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
      },
    ],
    considerations: [
      {
        ingredientOrCategory: 'Recovery mask or barrier balm',
        alignment: 'calm and barrier support',
        reason:
          'A recovery product can be worth considering for higher-comfort routines, especially after active nights.',
        ownedSignals: ['recovery', 'cica', 'balm', 'mask', 'ceramide'],
        sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
        budgetScope: 'ready-to-spend',
      },
      {
        ingredientOrCategory: 'Mineral sunscreen for sensitive skin',
        alignment: 'calm and barrier support',
        reason:
          'A sensitive-skin sunscreen lane can reduce friction when the goal is calmer skin.',
        ownedSignals: [
          'mineral sunscreen',
          'zinc oxide',
          'titanium dioxide',
          'sensitive sunscreen',
        ],
        sourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
      },
    ],
  },
  {
    id: 'hydration',
    triggers: ['dry', 'dehydrat', 'hydration', 'hydrate', 'plump'],
    primary: [
      {
        ingredientOrCategory:
          'Hydrating serum with glycerin or hyaluronic acid',
        alignment: 'hydration support',
        reason:
          'Your goal points to hydration, and the shelf does not yet show a dedicated humectant support step.',
        ownedSignals: [
          'hyaluronic',
          'glycerin',
          'beta-glucan',
          'polyglutamic',
          'urea',
        ],
        sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
      },
    ],
    considerations: [
      {
        ingredientOrCategory:
          'Barrier-support moisturizer for hydration routines',
        alignment: 'hydration support',
        reason:
          'Hydration goals need a seal-in step as well as water-binding ingredients.',
        ownedSignals: [
          'moisturizer',
          'moisturiser',
          'cream',
          'ceramide',
          'barrier',
          'squalane',
        ],
        sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
      },
      {
        ingredientOrCategory: 'Overnight hydration mask',
        alignment: 'hydration support',
        reason:
          'A higher-comfort hydration routine can include an occasional overnight mask rather than another daily serum.',
        ownedSignals: ['sleeping mask', 'overnight mask', 'water mask'],
        sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
        budgetScope: 'ready-to-spend',
      },
    ],
  },
  {
    id: 'aging',
    triggers: ['fine line', 'fine lines', 'aging', 'ageing', 'wrinkle', 'firm'],
    primary: [
      {
        ingredientOrCategory: 'Beginner retinoid or retinal night treatment',
        alignment: 'early aging support',
        reason:
          'Your goal points to lines or firmness, and the shelf does not yet show a retinoid-style night step.',
        ownedSignals: ['retinol', 'retinal', 'retinoid', 'adapalene'],
        sourceIds: [
          SuggestionEvidenceSourceId.AadRetinoidRetinol,
          SuggestionEvidenceSourceId.DermNetTopicalRetinoids,
        ],
        avoidWhenPregnancyCaution: true,
      },
    ],
    considerations: [
      {
        ingredientOrCategory: 'Peptide support serum',
        alignment: 'early aging support',
        reason:
          'A peptide serum can be a supporting option without replacing the main night treatment.',
        ownedSignals: ['peptide', 'matrixyl', 'argireline'],
        sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
        budgetScope: 'ready-to-spend',
      },
      {
        ingredientOrCategory: 'Antioxidant serum for firmness routines',
        alignment: 'early aging support',
        reason:
          'An antioxidant lane can support daytime routines that are focused on firmness and tone.',
        ownedSignals: ['vitamin c', 'ascorbic', 'antioxidant', 'ferulic'],
        sourceIds: [SuggestionEvidenceSourceId.AadRetinoidRetinol],
      },
      {
        ingredientOrCategory: 'Barrier-support moisturizer for retinoid nights',
        alignment: 'early aging support',
        reason:
          'A retinoid-focused routine works better when the comfort and moisturizer lane is covered.',
        ownedSignals: [
          'moisturizer',
          'moisturiser',
          'cream',
          'ceramide',
          'barrier',
          'panthenol',
        ],
        sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
      },
    ],
  },
];

export function buildGoalGapCandidates(
  context: SmartPicksContext,
  coverage: SmartPicksCoverage,
): SmartPicksGoalGapCandidate[] {
  const goalText = profileGoalText(context.skinProfile);
  if (!goalText) return [];

  const candidates: SmartPicksGoalGapCandidate[] = [];
  const activeProducts = context.activeProducts;
  const readyToSpend = isReadyToSpendBudget(context.budgetTier);
  const pregnancyCaution = isPregnancyCautionActive(
    context.skinProfile?.pregnancy_status ?? null,
  );
  let matchedKnownPolicy = false;

  for (const policy of GOAL_POLICIES) {
    if (!matchesGoalPolicy(goalText, policy)) continue;
    matchedKnownPolicy = true;

    for (const primary of policy.primary) {
      if (!shouldUseRule(primary, activeProducts, pregnancyCaution)) {
        continue;
      }
      candidates.push(toCandidate(primary, { priority: 'priority' }));
    }

    for (const consideration of policy.considerations) {
      if (consideration.budgetScope === 'ready-to-spend' && !readyToSpend) {
        continue;
      }
      if (!shouldUseRule(consideration, activeProducts, pregnancyCaution)) {
        continue;
      }
      candidates.push(toCandidate(consideration, { priority: 'consider' }));
    }
  }

  if (!matchedKnownPolicy && candidates.length === 0) {
    candidates.push(...genericGoalCandidates(context, goalText, readyToSpend));
  }

  return candidates.filter(
    (candidate) =>
      !coverage.slots.some(
        (slot) =>
          slot.filledByName &&
          candidate.ingredientOrCategory
            .toLowerCase()
            .includes(slot.filledByName.toLowerCase()),
      ),
  );
}

function genericGoalCandidates(
  context: SmartPicksContext,
  goalText: string,
  readyToSpend: boolean,
): SmartPicksGoalGapCandidate[] {
  const displayGoal = displayGoalForProfile(context.skinProfile, goalText);
  const tokens = goalTokens(goalText);
  const hasGoalProduct = context.activeProducts.some((product) =>
    tokens.some((token) => productText(product).includes(token)),
  );
  const candidates: SmartPicksGoalGapCandidate[] = [];

  if (!hasGoalProduct) {
    candidates.push({
      ingredientOrCategory: `Goal-focused product for ${displayGoal}`,
      priority: 'priority',
      reason: `Smart Picks does not have a built-in rule for this exact goal yet, so AI should choose the most relevant product category for ${displayGoal} from your profile, shelf, history, safety context, and goal wording.`,
      goalAlignment: displayGoal,
      sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
      gapKind: SmartPicksGapKind.GoalSupport,
    });
  }

  if (readyToSpend) {
    candidates.push({
      ingredientOrCategory: `Supporting product for ${displayGoal}`,
      priority: 'consider',
      reason: `AI should identify a supporting product that improves comfort, consistency, or compatibility for ${displayGoal}.`,
      goalAlignment: displayGoal,
      sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
      gapKind: SmartPicksGapKind.GoalSupport,
    });
  }

  return candidates;
}

function toCandidate(
  rule: GoalProductRule,
  options: {
    priority: GapPriority;
  },
): SmartPicksGoalGapCandidate {
  return {
    ingredientOrCategory: rule.ingredientOrCategory,
    priority: options.priority,
    reason: rule.reason,
    goalAlignment: rule.alignment,
    sourceIds: [...rule.sourceIds],
    gapKind: SmartPicksGapKind.GoalSupport,
  };
}

function shouldUseRule(
  rule: GoalProductRule,
  activeProducts: readonly InventoryProduct[],
  pregnancyCaution: boolean,
): boolean {
  if (rule.onlyWhenPregnancyCaution && !pregnancyCaution) return false;
  if (rule.avoidWhenPregnancyCaution && pregnancyCaution) return false;
  return !hasOwnedSignal(activeProducts, rule.ownedSignals);
}

function matchesGoalPolicy(text: string, policy: GoalPolicy): boolean {
  if (!policy.triggers.some((trigger) => text.includes(trigger))) {
    return false;
  }
  if (policy.id === 'barrier') {
    return /\b(redness|irritation|sensitive|barrier|soothe|rosacea|calm redness|calm irritation|calm sensitivity)\b/.test(
      text,
    );
  }
  if (policy.id !== 'acne') return true;

  const hasPostAcneMarks = /\bpost[-\s]?acne\b/.test(text);
  const hasActiveAcneSignal =
    /\b(active acne|acne-prone|acne prone|breakout|breakouts|blemish|blemishes|pimple|pimples)\b/.test(
      text,
    );
  return !hasPostAcneMarks || hasActiveAcneSignal;
}

function hasOwnedSignal(
  products: readonly InventoryProduct[],
  signals: readonly string[],
): boolean {
  return products.some((product) => {
    const text = productText(product);
    return signals.some((signal) => text.includes(signal));
  });
}

function productText(product: InventoryProduct): string {
  return [
    product.brand,
    product.name,
    product.category,
    ...(product.identity?.benefits ?? []),
    ...(product.identity?.inciIngredients ?? []),
  ]
    .join(' ')
    .toLowerCase();
}

function displayGoalForProfile(
  profile: SkinProfile | null,
  fallbackGoalText: string,
): string {
  return sanitizeDisplayGoal(profile?.primary_goal ?? fallbackGoalText);
}

function sanitizeDisplayGoal(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/[^a-zA-Z0-9 ,.'/-]/g, '')
    .trim()
    .slice(0, 90)
    .toLowerCase();
}

function profileGoalText(profile: SkinProfile | null): string {
  return [
    profile?.primary_goal,
    ...(profile?.current_concerns ?? []),
    ...(profile?.concern_details?.per_concern ?? []).map(
      (entry) => `${entry.concern} ${entry.severity ?? ''}`,
    ),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function goalTokens(goal: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const rawToken of goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')) {
    const token = normalizeGoalToken(rawToken);
    if (!token || GOAL_STOPWORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

function normalizeGoalToken(token: string): string | null {
  if (token.length < 4) return null;
  if (token.endsWith('ies') && token.length > 5) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith('s') && token.length > 4) {
    return token.slice(0, -1);
  }
  return token;
}

function isReadyToSpendBudget(
  budgetTier: SmartPicksBudgetTier | null,
): boolean {
  return Boolean(budgetTier && READY_TO_SPEND_BUDGETS.includes(budgetTier));
}

function isPregnancyCautionActive(status: string | null): boolean {
  const normalized = status?.trim().toLowerCase();
  if (!normalized) return false;
  return ![
    'not_pregnant',
    'not pregnant',
    'none',
    'no',
    'unknown',
    'prefer_not_to_say',
  ].includes(normalized);
}

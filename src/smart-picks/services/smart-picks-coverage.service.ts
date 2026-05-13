import { Injectable } from '@nestjs/common';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ProductCategory } from '../../shelf/shelf.types';
import {
  SmartPicksCoverage,
  SmartPicksCoverageRole,
  SmartPicksCoverageSlot,
  SmartPicksGoalRelevance,
} from '../smart-picks.types';

type CoverageDefinition = {
  role: SmartPicksCoverageRole;
  goalRelevance: SmartPicksGoalRelevance;
  matcher: (product: InventoryProduct, text: string) => boolean;
};

const BASELINE_DEFINITIONS: readonly CoverageDefinition[] = [
  definition(
    'cleanse',
    'essential',
    (product, text) =>
      product.category === ProductCategory.Cleanser ||
      /\b(cleanser|cleansing|cleanse|face wash|gel wash)\b/.test(text),
  ),
  definition(
    'moisturise',
    'essential',
    (product, text) =>
      product.category === ProductCategory.Moisturizer ||
      /\b(moisturi[sz]er|cream|lotion|barrier cream|ceramide cream)\b/.test(
        text,
      ),
  ),
  definition(
    'spf',
    'essential',
    (product, text) =>
      product.category === ProductCategory.SunProtection ||
      /\b(spf|sunscreen|sun protection|pa\+{2,})\b/.test(text),
  ),
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

const GOAL_DEFINITIONS: readonly {
  triggers: readonly string[];
  definitions: readonly CoverageDefinition[];
}[] = [
  {
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
    definitions: [
      definition('spf', 'essential', spfMatcher),
      definition('dark-spot-treatment', 'essential', (_product, text) =>
        /\b(azelaic|tranexamic|kojic|alpha arbutin|arbutin|melasma|pigment|pih)\b/.test(
          text,
        ),
      ),
      definition('antioxidant', 'supportive', (_product, text) =>
        /\b(vitamin c|ascorbic|ascorbyl|tetrahexyldecyl|antioxidant)\b/.test(
          text,
        ),
      ),
      definition('exfoliation-mask', 'optional', (_product, text) =>
        /\b(mask|peel|mandelic|lactic|glycolic|pha|aha)\b/.test(text),
      ),
      definition('moisturise', 'supportive', moisturiserMatcher),
      definition('cleanse', 'supportive', cleanserMatcher),
    ],
  },
  {
    triggers: ['acne', 'breakout', 'breakouts', 'blemish', 'pimple'],
    definitions: [
      definition('acne-treatment', 'essential', (_product, text) =>
        /\b(azelaic|salicylic|bha|benzoyl|adapalene|acne treatment|spot treatment)\b/.test(
          text,
        ),
      ),
      definition('cleanse', 'essential', cleanserMatcher),
      definition('moisturise', 'supportive', moisturiserMatcher),
      definition('spf', 'supportive', spfMatcher),
      definition('barrier-support', 'supportive', (_product, text) =>
        /\b(niacinamide|panthenol|centella|ceramide|barrier|cica)\b/.test(text),
      ),
      definition('congestion-mask', 'optional', (_product, text) =>
        /\b(clay|kaolin|bentonite|sulfur|congestion mask|mask)\b/.test(text),
      ),
    ],
  },
  {
    triggers: ['texture', 'rough', 'bumpy', 'bumps', 'clogged', 'pore'],
    definitions: [
      definition('texture-exfoliant', 'essential', (_product, text) =>
        /\b(aha|pha|bha|glycolic|lactic|mandelic|salicylic|exfoliant|peel)\b/.test(
          text,
        ),
      ),
      definition('retinoid', 'supportive', retinoidMatcher),
      definition('spf', 'essential', spfMatcher),
      definition('moisturise', 'supportive', moisturiserMatcher),
      definition('cleanse', 'supportive', cleanserMatcher),
    ],
  },
  {
    triggers: [
      'redness',
      'irritation',
      'sensitive',
      'barrier',
      'calm',
      'soothe',
    ],
    definitions: [
      definition('barrier-support', 'essential', (_product, text) =>
        /\b(niacinamide|panthenol|centella|madecassoside|allantoin|cica|barrier)\b/.test(
          text,
        ),
      ),
      definition('moisturise', 'essential', moisturiserMatcher),
      definition('cleanse', 'supportive', cleanserMatcher),
      definition('spf', 'supportive', spfMatcher),
      definition('recovery-mask', 'optional', (_product, text) =>
        /\b(recovery|sleeping mask|overnight mask|cica mask|barrier balm)\b/.test(
          text,
        ),
      ),
    ],
  },
  {
    triggers: ['dry', 'dehydrat', 'hydration', 'hydrate', 'plump'],
    definitions: [
      definition('hydrate', 'essential', hydrateMatcher),
      definition('moisturise', 'essential', moisturiserMatcher),
      definition('spf', 'supportive', spfMatcher),
      definition('recovery-mask', 'optional', (_product, text) =>
        /\b(sleeping mask|overnight mask|water mask|hydration mask)\b/.test(
          text,
        ),
      ),
      definition('cleanse', 'supportive', cleanserMatcher),
    ],
  },
  {
    triggers: ['fine line', 'fine lines', 'aging', 'ageing', 'wrinkle', 'firm'],
    definitions: [
      definition('spf', 'essential', spfMatcher),
      definition('retinoid', 'essential', retinoidMatcher),
      definition('moisturise', 'supportive', moisturiserMatcher),
      definition('peptide', 'optional', (_product, text) =>
        /\b(peptide|matrixyl|argireline|firming serum)\b/.test(text),
      ),
      definition('cleanse', 'supportive', cleanserMatcher),
    ],
  },
];

@Injectable()
export class SmartPicksCoverageService {
  compute(
    activeProducts: InventoryProduct[],
    primaryGoal: string | null,
  ): SmartPicksCoverage {
    const definitions = coverageDefinitionsForGoal(primaryGoal);
    const slots: SmartPicksCoverageSlot[] = definitions.map((coverage) => {
      const product = activeProducts.find((candidate) =>
        coverage.matcher(candidate, productSearchText(candidate)),
      );
      return {
        role: coverage.role,
        state: product
          ? 'filled'
          : coverage.goalRelevance === 'essential'
            ? 'missing-priority'
            : 'missing',
        filledByProductId: product?.id ?? null,
        filledByName: product ? `${product.brand} ${product.name}` : null,
        goalRelevance: coverage.goalRelevance,
      };
    });

    return {
      slots,
      filled: slots.filter((slot) => slot.state === 'filled').length,
      total: slots.length,
    };
  }
}

export function isPriorityMissingRole(
  role: SmartPicksCoverageRole,
  primaryGoal: string | null,
): boolean {
  const definitionMatch = coverageDefinitionsForGoal(primaryGoal).find(
    (definitionItem) => definitionItem.role === role,
  );
  return definitionMatch?.goalRelevance === 'essential';
}

function coverageDefinitionsForGoal(
  primaryGoal: string | null,
): readonly CoverageDefinition[] {
  const goal = primaryGoal?.toLowerCase() ?? '';
  const matchedPolicies = GOAL_DEFINITIONS.filter((candidate) =>
    candidate.triggers.some((trigger) => goal.includes(trigger)),
  );
  if (matchedPolicies.length > 0) {
    return mergeCoverageDefinitions(
      matchedPolicies.flatMap((policy) => policy.definitions),
    );
  }
  if (goal.trim()) return genericGoalDefinitions(goal);
  return BASELINE_DEFINITIONS;
}

function mergeCoverageDefinitions(
  definitions: readonly CoverageDefinition[],
): readonly CoverageDefinition[] {
  const byRole = new Map<SmartPicksCoverageRole, CoverageDefinition>();
  for (const current of definitions) {
    const existing = byRole.get(current.role);
    if (!existing) {
      byRole.set(current.role, current);
      continue;
    }
    byRole.set(current.role, {
      role: current.role,
      goalRelevance: strongerGoalRelevance(
        existing.goalRelevance,
        current.goalRelevance,
      ),
      matcher: (product, text) =>
        existing.matcher(product, text) || current.matcher(product, text),
    });
  }
  return Array.from(byRole.values());
}

function strongerGoalRelevance(
  first: SmartPicksGoalRelevance,
  second: SmartPicksGoalRelevance,
): SmartPicksGoalRelevance {
  return goalRelevanceRank(second) > goalRelevanceRank(first) ? second : first;
}

function goalRelevanceRank(relevance: SmartPicksGoalRelevance): number {
  switch (relevance) {
    case 'essential':
      return 3;
    case 'supportive':
      return 2;
    case 'optional':
      return 1;
  }
}

function genericGoalDefinitions(goal: string): readonly CoverageDefinition[] {
  const tokens = goalTokens(goal);
  return [
    definition('goal-primary', 'essential', (_product, text) =>
      tokens.some((token) => text.includes(token)),
    ),
    definition('spf', 'supportive', spfMatcher),
    definition('goal-support', 'supportive', (_product, text) =>
      /\b(barrier|soothing|calming|hydrate|hydrating|glycerin|hyaluronic|niacinamide|panthenol|centella|ceramide)\b/.test(
        text,
      ),
    ),
    definition('moisturise', 'supportive', moisturiserMatcher),
    definition('cleanse', 'supportive', cleanserMatcher),
  ];
}

function definition(
  role: SmartPicksCoverageRole,
  goalRelevance: SmartPicksGoalRelevance,
  matcher: CoverageDefinition['matcher'],
): CoverageDefinition {
  return { role, goalRelevance, matcher };
}

function cleanserMatcher(product: InventoryProduct, text: string): boolean {
  return (
    product.category === ProductCategory.Cleanser ||
    /\b(cleanser|cleansing|cleanse|face wash|gel wash)\b/.test(text)
  );
}

function moisturiserMatcher(product: InventoryProduct, text: string): boolean {
  return (
    product.category === ProductCategory.Moisturizer ||
    /\b(moisturi[sz]er|cream|lotion|barrier cream|ceramide cream)\b/.test(text)
  );
}

function spfMatcher(product: InventoryProduct, text: string): boolean {
  return (
    product.category === ProductCategory.SunProtection ||
    /\b(spf|sunscreen|sun protection|pa\+{2,})\b/.test(text)
  );
}

function hydrateMatcher(product: InventoryProduct, text: string): boolean {
  return (
    [ProductCategory.Toner, ProductCategory.Essence].includes(
      product.category,
    ) ||
    /\b(toner|essence|hydrating serum|hyaluronic|glycerin|beta-glucan|polyglutamic|urea)\b/.test(
      text,
    )
  );
}

function retinoidMatcher(_product: InventoryProduct, text: string): boolean {
  return /\b(retinol|retinal|retinoid|adapalene|tretinoin)\b/.test(text);
}

function productSearchText(product: InventoryProduct): string {
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

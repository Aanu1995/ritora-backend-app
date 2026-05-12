import { Injectable } from '@nestjs/common';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ProductCategory } from '../../shelf/shelf.types';
import {
  SmartPicksCoverage,
  SmartPicksCoverageRole,
  SmartPicksCoverageSlot,
  SmartPicksGoalRelevance,
} from '../smart-picks.types';

const COVERAGE_ROLES: Array<{
  role: SmartPicksCoverageRole;
  goalRelevance: SmartPicksGoalRelevance;
}> = [
  { role: 'cleanse', goalRelevance: 'essential' },
  { role: 'hydrate', goalRelevance: 'supportive' },
  { role: 'treat', goalRelevance: 'essential' },
  { role: 'moisturise', goalRelevance: 'essential' },
  { role: 'spf', goalRelevance: 'essential' },
  { role: 'eye', goalRelevance: 'optional' },
  { role: 'treatment-secondary', goalRelevance: 'optional' },
];

@Injectable()
export class SmartPicksCoverageService {
  compute(
    activeProducts: InventoryProduct[],
    primaryGoal: string | null,
  ): SmartPicksCoverage {
    const filledByRole = new Map<SmartPicksCoverageRole, InventoryProduct>();
    for (const product of activeProducts) {
      const role = roleForProduct(product, filledByRole);
      if (role && !filledByRole.has(role)) {
        filledByRole.set(role, product);
      }
    }

    const slots: SmartPicksCoverageSlot[] = COVERAGE_ROLES.map((definition) => {
      const product = filledByRole.get(definition.role) ?? null;
      const missingPriority = isPriorityMissingRole(
        definition.role,
        primaryGoal,
      );
      return {
        role: definition.role,
        state: product
          ? 'filled'
          : missingPriority
            ? 'missing-priority'
            : 'missing',
        filledByProductId: product?.id ?? null,
        filledByName: product ? `${product.brand} ${product.name}` : null,
        goalRelevance: definition.goalRelevance,
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
  if (role === 'cleanse' || role === 'moisturise' || role === 'spf') {
    return true;
  }
  if (role !== 'treat') {
    return false;
  }
  const goal = primaryGoal?.toLowerCase() ?? '';
  return [
    'acne',
    'breakout',
    'blemish',
    'pimple',
    'dark',
    'hyperpigmentation',
    'marks',
    'texture',
    'rough',
    'pore',
    'tone',
    'redness',
    'irritation',
    'barrier',
    'dry',
    'dehydrat',
    'hydration',
    'hydrate',
    'fine',
    'aging',
    'ageing',
    'wrinkle',
    'firm',
  ].some((token) => goal.includes(token));
}

function roleForProduct(
  product: InventoryProduct,
  filledByRole: ReadonlyMap<SmartPicksCoverageRole, InventoryProduct>,
): SmartPicksCoverageRole | null {
  const fallbackRole = roleForProductText(product, filledByRole);
  switch (product.category) {
    case ProductCategory.Cleanser:
      return 'cleanse';
    case ProductCategory.Toner:
    case ProductCategory.Essence:
      return fallbackRole ?? 'hydrate';
    case ProductCategory.Moisturizer:
      return 'moisturise';
    case ProductCategory.SunProtection:
      return 'spf';
    case ProductCategory.EyeCare:
      return 'eye';
    case ProductCategory.Exfoliant:
    case ProductCategory.Serum:
    case ProductCategory.Treatment:
      return (
        fallbackRole ??
        (filledByRole.has('treat') ? 'treatment-secondary' : 'treat')
      );
    default:
      return fallbackRole;
  }
}

function roleForProductText(
  product: InventoryProduct,
  filledByRole: ReadonlyMap<SmartPicksCoverageRole, InventoryProduct>,
): SmartPicksCoverageRole | null {
  const text = [
    product.brand,
    product.name,
    product.category,
    ...(product.identity?.benefits ?? []),
    ...(product.identity?.inciIngredients ?? []),
  ]
    .join(' ')
    .toLowerCase();

  if (/\b(spf|sunscreen|sun protection|pa\+{2,})\b/.test(text)) {
    return 'spf';
  }
  if (/\b(cleanser|cleansing|cleanse|face wash|gel wash)\b/.test(text)) {
    return 'cleanse';
  }
  if (/\b(moisturi[sz]er|cream|lotion|barrier|ceramide)\b/.test(text)) {
    return 'moisturise';
  }
  if (
    /\b(toner|essence|hydrating serum|hyaluronic|glycerin|beta-glucan|polyglutamic)\b/.test(
      text,
    )
  ) {
    return 'hydrate';
  }
  if (
    /\b(serum|treatment|retinol|retinoid|azelaic|salicylic|benzoyl|exfoliant|aha|bha|pha|vitamin c)\b/.test(
      text,
    )
  ) {
    return filledByRole.has('treat') ? 'treatment-secondary' : 'treat';
  }
  return null;
}

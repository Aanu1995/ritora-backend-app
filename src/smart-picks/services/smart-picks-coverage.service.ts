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
    'dark',
    'hyperpigmentation',
    'marks',
    'texture',
    'tone',
    'fine',
    'aging',
  ].some((token) => goal.includes(token));
}

function roleForProduct(
  product: InventoryProduct,
  filledByRole: ReadonlyMap<SmartPicksCoverageRole, InventoryProduct>,
): SmartPicksCoverageRole | null {
  switch (product.category) {
    case ProductCategory.Cleanser:
      return 'cleanse';
    case ProductCategory.Toner:
    case ProductCategory.Essence:
      return 'hydrate';
    case ProductCategory.Moisturizer:
      return 'moisturise';
    case ProductCategory.SunProtection:
      return 'spf';
    case ProductCategory.EyeCare:
      return 'eye';
    case ProductCategory.Exfoliant:
    case ProductCategory.Serum:
    case ProductCategory.Treatment:
      return filledByRole.has('treat') ? 'treatment-secondary' : 'treat';
    default:
      return null;
  }
}

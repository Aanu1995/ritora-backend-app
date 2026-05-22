import { BadRequestException } from '@nestjs/common';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { SuggestionStep } from '../suggestions/entities/suggestion-step.entity';
import { ApplicationLogItemInputDto } from './dto/application-log-item.dto';
import {
  ApplicationItemProductSnapshot,
  ApplicationItemSource,
} from './application-tracking.constants';
import { ApplicationLogItem } from './entities/application-log-item.entity';

export type ResolvedApplicationItemInput = ApplicationLogItemInputDto & {
  productBrand: string | null;
  productName: string | null;
  stepLabel: string | null;
  isAdHoc: boolean;
  adHocBrand: string | null;
  adHocName: string | null;
  inventoryProductId: string | null;
  substitutedWithProductId: string | null;
  itemSource: ApplicationItemSource;
  substitutionReason: string | null;
  recommendedSnapshot: ApplicationItemProductSnapshot | null;
  appliedSnapshot: ApplicationItemProductSnapshot | null;
};

export function collectApplicationItemProductIds(
  items: ApplicationLogItemInputDto[],
  existingItems: ApplicationLogItem[],
): string[] {
  const historicalSubstitutionByKey =
    buildHistoricalSubstitutionSnapshotMap(existingItems);
  const ids = new Set<string>();
  items.forEach((item, index) => {
    if (!item.suggestionStepId && item.inventoryProductId) {
      ids.add(item.inventoryProductId);
    }
    if (
      item.substitutedWithProductId &&
      !historicalSubstitutionByKey.has(
        historicalSubstitutionKey(
          item.suggestionStepId ?? null,
          item.stepOrder ?? index,
          item.substitutedWithProductId,
        ),
      )
    ) {
      ids.add(item.substitutedWithProductId);
    }
  });
  return Array.from(ids);
}

export function resolveApplicationItemDrafts(params: {
  items: ApplicationLogItemInputDto[];
  suggestionSteps: SuggestionStep[];
  productById: ReadonlyMap<string, InventoryProduct>;
  existingItems: ApplicationLogItem[];
}): ResolvedApplicationItemInput[] {
  const stepById = new Map(
    params.suggestionSteps.map((step) => [step.id, step]),
  );
  const historicalSubstitutionByKey = buildHistoricalSubstitutionSnapshotMap(
    params.existingItems,
  );
  return params.items.map((item, index) =>
    resolveItemDraft(
      item,
      index,
      stepById,
      params.productById,
      historicalSubstitutionByKey,
    ),
  );
}

function resolveItemDraft(
  item: ApplicationLogItemInputDto,
  index: number,
  stepById: Map<string, SuggestionStep>,
  productById: ReadonlyMap<string, InventoryProduct>,
  historicalSubstitutionByKey: ReadonlyMap<
    string,
    ApplicationItemProductSnapshot
  >,
): ResolvedApplicationItemInput {
  const suggestionStep = item.suggestionStepId
    ? (stepById.get(item.suggestionStepId) ?? null)
    : null;
  if (item.suggestionStepId && !suggestionStep) {
    throw new BadRequestException(
      'Suggestion step does not belong to this suggestion.',
    );
  }
  const product = item.inventoryProductId
    ? (productById.get(item.inventoryProductId) ?? null)
    : null;
  const substitutedProduct = item.substitutedWithProductId
    ? (productById.get(item.substitutedWithProductId) ?? null)
    : null;
  const historicalSubstitution = findHistoricalSubstitutionSnapshot(
    item,
    index,
    historicalSubstitutionByKey,
  );
  const isAdHoc = item.isAdHoc ?? false;
  validateItemShape(
    item,
    isAdHoc,
    product,
    substitutedProduct,
    suggestionStep,
    historicalSubstitution,
  );

  const sourceProduct = suggestionStep?.product ?? product ?? null;
  const suggestedSnapshot = suggestionStep
    ? snapshotFromSuggestionStep(suggestionStep)
    : null;
  const itemSource = resolveItemSource(item, suggestionStep);
  return {
    ...item,
    stepOrder: item.stepOrder ?? index,
    inventoryProductId: suggestionStep
      ? suggestionStep.inventory_product_id
      : (product?.id ?? item.inventoryProductId ?? null),
    substitutedWithProductId: substitutedProduct?.id ?? null,
    productBrand:
      sourceProduct?.brand ??
      suggestedSnapshot?.brand ??
      item.productBrand ??
      item.adHocBrand ??
      null,
    productName:
      sourceProduct?.name ??
      suggestedSnapshot?.name ??
      item.productName ??
      item.adHocName ??
      null,
    stepLabel: suggestionStep?.step_label ?? item.stepLabel ?? null,
    isAdHoc,
    adHocBrand: item.adHocBrand?.trim() || null,
    adHocName: item.adHocName?.trim() || null,
    itemSource,
    substitutionReason: item.substitutionReason ?? null,
    recommendedSnapshot: suggestedSnapshot,
    appliedSnapshot: buildAppliedSnapshot(
      item,
      sourceProduct,
      substitutedProduct,
      suggestionStep,
      historicalSubstitution,
    ),
  };
}

function resolveItemSource(
  item: ApplicationLogItemInputDto,
  suggestionStep: SuggestionStep | null,
): ApplicationItemSource {
  if (item.isAdHoc) return 'added_off_shelf';
  if (
    !suggestionStep &&
    (item.inventoryProductId || item.substitutedWithProductId)
  ) {
    return 'added_shelf';
  }
  return 'recommended';
}

function buildAppliedSnapshot(
  item: ApplicationLogItemInputDto,
  sourceProduct: InventoryProduct | null,
  substitutedProduct: InventoryProduct | null,
  suggestionStep: SuggestionStep | null,
  historicalSubstitution: ApplicationItemProductSnapshot | null,
): ApplicationItemProductSnapshot | null {
  if (item.status === 'substituted' && item.isAdHoc) {
    return {
      product_id: null,
      brand: item.adHocBrand ?? null,
      name: item.adHocName ?? null,
      step_label: item.stepLabel ?? suggestionStep?.step_label ?? null,
      routine_step_id: suggestionStep?.routine_step_id ?? null,
      suggestion_step_id: suggestionStep?.id ?? null,
      provenance: 'added_off_shelf',
    };
  }
  if (item.status === 'substituted' && historicalSubstitution) {
    return historicalSubstitution;
  }
  const product = substitutedProduct ?? sourceProduct;
  if (product) {
    return {
      product_id: product.id,
      brand: product.brand,
      name: product.name,
      step_label: suggestionStep?.step_label ?? item.stepLabel ?? null,
      routine_step_id: suggestionStep?.routine_step_id ?? null,
      suggestion_step_id: suggestionStep?.id ?? null,
      provenance: suggestionStep?.provenance ?? null,
    };
  }
  if (suggestionStep) {
    return snapshotFromSuggestionStep(suggestionStep);
  }
  if (item.isAdHoc) {
    return {
      product_id: null,
      brand: item.adHocBrand ?? null,
      name: item.adHocName ?? null,
      step_label: item.stepLabel ?? null,
      routine_step_id: null,
      suggestion_step_id: null,
      provenance: 'added_off_shelf',
    };
  }
  return null;
}

function snapshotFromSuggestionStep(
  step: SuggestionStep,
): ApplicationItemProductSnapshot {
  return {
    product_id: step.inventory_product_id,
    brand: step.product_brand_snapshot ?? step.product?.brand ?? null,
    name: step.product_name_snapshot ?? step.product?.name ?? null,
    step_label: step.step_label,
    routine_step_id: step.routine_step_id,
    suggestion_step_id: step.id,
    provenance: step.provenance,
  };
}

function validateItemShape(
  item: ApplicationLogItemInputDto,
  isAdHoc: boolean,
  product: InventoryProduct | null,
  substitutedProduct: InventoryProduct | null,
  suggestionStep: SuggestionStep | null,
  historicalSubstitution: ApplicationItemProductSnapshot | null,
): void {
  if (isAdHoc && (!item.adHocBrand?.trim() || !item.adHocName?.trim())) {
    throw new BadRequestException(
      'Off-shelf products require both brand and name.',
    );
  }
  if (
    item.status === 'substituted' &&
    !substitutedProduct &&
    !historicalSubstitution &&
    !(isAdHoc && item.adHocBrand?.trim() && item.adHocName?.trim())
  ) {
    throw new BadRequestException(
      'Substituted items require a shelf product or an off-shelf brand and name.',
    );
  }
  if (!isAdHoc && !product && !suggestionStep) {
    throw new BadRequestException(
      'Logged items must reference a suggestion step, shelf product, or off-shelf product.',
    );
  }
}

function buildHistoricalSubstitutionSnapshotMap(
  existingItems: ApplicationLogItem[],
): Map<string, ApplicationItemProductSnapshot> {
  const map = new Map<string, ApplicationItemProductSnapshot>();
  for (const item of existingItems) {
    if (item.status && item.status !== 'substituted') continue;
    const productId =
      item.applied_snapshot?.product_id ?? item.substituted_with_product_id;
    if (!productId || !item.applied_snapshot) continue;
    map.set(
      historicalSubstitutionRowKey(item.suggestion_step_id, item.step_order),
      item.applied_snapshot,
    );
    map.set(
      historicalSubstitutionKey(
        item.suggestion_step_id,
        item.step_order,
        productId,
      ),
      item.applied_snapshot,
    );
  }
  return map;
}

function findHistoricalSubstitutionSnapshot(
  item: ApplicationLogItemInputDto,
  index: number,
  historicalSubstitutionByKey: ReadonlyMap<
    string,
    ApplicationItemProductSnapshot
  >,
): ApplicationItemProductSnapshot | null {
  if (!item.substitutedWithProductId) {
    return (
      historicalSubstitutionByKey.get(
        historicalSubstitutionRowKey(
          item.suggestionStepId ?? null,
          item.stepOrder ?? index,
        ),
      ) ?? null
    );
  }
  return (
    historicalSubstitutionByKey.get(
      historicalSubstitutionKey(
        item.suggestionStepId ?? null,
        item.stepOrder ?? index,
        item.substitutedWithProductId,
      ),
    ) ?? null
  );
}

function historicalSubstitutionKey(
  suggestionStepId: string | null,
  stepOrder: number,
  productId: string,
): string {
  return `${suggestionStepId ?? `order:${stepOrder}`}::${productId}`;
}

function historicalSubstitutionRowKey(
  suggestionStepId: string | null,
  stepOrder: number,
): string {
  return `${suggestionStepId ?? `order:${stepOrder}`}::historical`;
}

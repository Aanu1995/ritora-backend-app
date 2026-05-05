import type { Repository } from 'typeorm';
import { ApplicationLogItem } from './entities/application-log-item.entity';
import type { ApplicationTrackingValidationService } from './application-tracking-validation.service';

export type ApplicationItemDraft = Awaited<
  ReturnType<ApplicationTrackingValidationService['buildItemDrafts']>
>[number];

export function createApplicationLogItems(
  itemRepo: Repository<ApplicationLogItem>,
  applicationLogId: string,
  drafts: ApplicationItemDraft[],
): ApplicationLogItem[] {
  return drafts.map((input, index) =>
    itemRepo.create({
      application_log_id: applicationLogId,
      step_order: input.stepOrder ?? index,
      suggestion_step_id: input.suggestionStepId ?? null,
      inventory_product_id: input.inventoryProductId ?? null,
      substituted_with_product_id: input.substitutedWithProductId ?? null,
      product_brand_snapshot: input.productBrand,
      product_name_snapshot: input.productName,
      step_label: input.stepLabel ?? null,
      status: input.status,
      is_ad_hoc: input.isAdHoc ?? false,
      item_source: input.itemSource,
      ad_hoc_brand: input.adHocBrand ?? null,
      ad_hoc_name: input.adHocName ?? null,
      notes: input.notes ?? null,
      substitution_reason: input.substitutionReason,
      recommended_snapshot: input.recommendedSnapshot,
      applied_snapshot: input.appliedSnapshot,
      applied_at: input.appliedAt ? new Date(input.appliedAt) : null,
    }),
  );
}

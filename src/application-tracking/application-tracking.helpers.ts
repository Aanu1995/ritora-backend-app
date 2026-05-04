import {
  ApplicationLogItemSnapshot,
  ApplicationLogSnapshot,
} from './application-tracking.constants';
import { ApplicationLogItem } from './entities/application-log-item.entity';
import { ApplicationLog } from './entities/application-log.entity';

export function buildApplicationLogSnapshot(
  log: ApplicationLog,
  items: ApplicationLogItem[],
  version: number,
  userId: string,
  editReason: string | null,
): ApplicationLogSnapshot {
  return {
    version,
    applied_at: log.applied_at ? log.applied_at.toISOString() : null,
    general_notes: log.general_notes,
    items: items
      .slice()
      .sort((a, b) => a.step_order - b.step_order)
      .map(
        (item): ApplicationLogItemSnapshot => ({
          step_order: item.step_order,
          suggestion_step_id: item.suggestion_step_id,
          inventory_product_id: item.inventory_product_id,
          substituted_with_product_id: item.substituted_with_product_id,
          product_brand_snapshot: item.product_brand_snapshot,
          product_name_snapshot: item.product_name_snapshot,
          step_label: item.step_label,
          status: item.status,
          is_ad_hoc: item.is_ad_hoc,
          ad_hoc_brand: item.ad_hoc_brand,
          ad_hoc_name: item.ad_hoc_name,
          notes: item.notes,
          applied_at: item.applied_at ? item.applied_at.toISOString() : null,
          item_source: item.item_source,
          substitution_reason: item.substitution_reason,
          recommended_snapshot: item.recommended_snapshot,
          applied_snapshot: item.applied_snapshot,
        }),
      ),
    edited_at: new Date().toISOString(),
    edited_by_user_id: userId,
    edit_reason: editReason,
  };
}

export function incrementCount(
  target: Record<string, number>,
  key: string,
): void {
  target[key] = (target[key] ?? 0) + 1;
}

export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

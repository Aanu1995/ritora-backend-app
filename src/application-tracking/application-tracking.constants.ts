/**
 * Constants and snapshot shapes for the application tracking module.
 * The frontend mirrors these in
 * `ritora-user-webapp/src/types/application-tracking.ts`.
 */

export type ApplicationItemStatus = 'applied' | 'skipped' | 'substituted';
export const APPLICATION_ITEM_STATUSES: readonly ApplicationItemStatus[] = [
  'applied',
  'skipped',
  'substituted',
] as const;

export type ApplicationDaypart = 'morning' | 'noon' | 'evening';
export type ApplicationItemSource =
  | 'recommended'
  | 'added_shelf'
  | 'added_off_shelf';

export interface ApplicationItemProductSnapshot {
  product_id: string | null;
  brand: string | null;
  name: string | null;
  step_label: string | null;
  routine_step_id?: string | null;
  suggestion_step_id?: string | null;
  provenance?: string | null;
}

/**
 * Frozen snapshot of an application_log + items at the moment of save.
 * Stored on application_log_versions so that prior versions are never
 * silently overwritten when the user edits a record.
 */
export interface ApplicationLogSnapshot {
  version: number;
  applied_at: string | null;
  general_notes: string | null;
  items: ApplicationLogItemSnapshot[];
  edited_at: string;
  edited_by_user_id: string;
  edit_reason: string | null;
}

export interface ApplicationLogItemSnapshot {
  step_order: number;
  suggestion_step_id: string | null;
  inventory_product_id: string | null;
  substituted_with_product_id: string | null;
  product_brand_snapshot: string | null;
  product_name_snapshot: string | null;
  step_label: string | null;
  status: ApplicationItemStatus;
  is_ad_hoc: boolean;
  ad_hoc_brand: string | null;
  ad_hoc_name: string | null;
  notes: string | null;
  applied_at: string | null;
  item_source: ApplicationItemSource;
  substitution_reason: string | null;
  recommended_snapshot: ApplicationItemProductSnapshot | null;
  applied_snapshot: ApplicationItemProductSnapshot | null;
}

export const ApplicationItemStatus = {
  Applied: 'applied',
  Skipped: 'skipped',
  Substituted: 'substituted',
} as const;

export type ApplicationItemStatus =
  (typeof ApplicationItemStatus)[keyof typeof ApplicationItemStatus];

export const APPLICATION_ITEM_STATUSES = Object.values(ApplicationItemStatus);

export const ApplicationDaypart = {
  Morning: 'morning',
  Noon: 'noon',
  Evening: 'evening',
} as const;

export type ApplicationDaypart =
  (typeof ApplicationDaypart)[keyof typeof ApplicationDaypart];

export const APPLICATION_DAYPARTS = Object.values(ApplicationDaypart);
export const ApplicationItemSource = {
  Recommended: 'recommended',
  AddedShelf: 'added_shelf',
  AddedOffShelf: 'added_off_shelf',
} as const;

export type ApplicationItemSource =
  (typeof ApplicationItemSource)[keyof typeof ApplicationItemSource];

export interface ApplicationItemProductSnapshot {
  product_id: string | null;
  brand: string | null;
  name: string | null;
  step_label: string | null;
  routine_step_id?: string | null;
  suggestion_step_id?: string | null;
  provenance?: string | null;
}

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

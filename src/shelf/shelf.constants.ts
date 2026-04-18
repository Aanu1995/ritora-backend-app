import {
  ApplicationMethod,
  DataProvenance,
  PreferredTimeOfDay,
  ProductCategory,
  Quantity,
  ShelfSort,
  ShelfStatFilter,
  ShelfStatus,
} from './shelf.types';

export const PRODUCT_CATEGORY_VALUES = Object.values(ProductCategory);
export const APPLICATION_METHOD_VALUES = Object.values(ApplicationMethod);
export const QUANTITY_VALUES = Object.values(Quantity);
export const PREFERRED_TIME_OF_DAY_VALUES = Object.values(PreferredTimeOfDay);
export const SHELF_STATUS_VALUES = Object.values(ShelfStatus);
export const SHELF_SORT_VALUES = Object.values(ShelfSort);
export const SHELF_STAT_FILTER_VALUES = Object.values(ShelfStatFilter);
export const DATA_PROVENANCE_VALUES = Object.values(DataProvenance);

export const SHELF_PAGE_SIZE = 30;

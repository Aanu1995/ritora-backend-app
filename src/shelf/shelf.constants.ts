import {
  ApplicationMethod,
  CatalogueSource,
  DataProvenance,
  LookupConfidence,
  PreferredTimeOfDay,
  ProductIntroductionStatus,
  ProductCategory,
  Quantity,
  ShelfIntroductionStatusFilter,
  ShelfSort,
  ShelfStatFilter,
  ShelfStatus,
} from './shelf.types';

export const PRODUCT_CATEGORY_VALUES: ProductCategory[] = [
  ProductCategory.Cleanser,
  ProductCategory.Toner,
  ProductCategory.Essence,
  ProductCategory.Serum,
  ProductCategory.Moisturizer,
  ProductCategory.SunProtection,
  ProductCategory.Mask,
  ProductCategory.Exfoliant,
  ProductCategory.EyeCare,
  ProductCategory.LipCare,
  ProductCategory.Treatment,
  ProductCategory.Other,
];

export const APPLICATION_METHOD_VALUES: ApplicationMethod[] = [
  ApplicationMethod.Fingertips,
  ApplicationMethod.CottonPad,
  ApplicationMethod.Brush,
  ApplicationMethod.Spray,
  ApplicationMethod.Dropper,
  ApplicationMethod.Spatula,
  ApplicationMethod.Other,
];

export const QUANTITY_VALUES: Quantity[] = [
  Quantity.OneDrop,
  Quantity.TwoToThreeDrops,
  Quantity.PeaSize,
  Quantity.PumpOne,
  Quantity.PumpTwo,
  Quantity.CoinSize,
  Quantity.Generous,
  Quantity.AsNeeded,
  Quantity.Other,
];

export const PREFERRED_TIME_OF_DAY_VALUES: PreferredTimeOfDay[] = [
  PreferredTimeOfDay.Morning,
  PreferredTimeOfDay.Evening,
  PreferredTimeOfDay.Either,
];

export const SHELF_STATUS_VALUES: ShelfStatus[] = [
  ShelfStatus.Active,
  ShelfStatus.Archived,
  ShelfStatus.FinishedUp,
];

export const PRODUCT_INTRODUCTION_STATUS_VALUES: ProductIntroductionStatus[] = [
  ProductIntroductionStatus.New,
  ProductIntroductionStatus.PatchTesting,
  ProductIntroductionStatus.Week1,
  ProductIntroductionStatus.BuildingTolerance,
  ProductIntroductionStatus.Paused,
  ProductIntroductionStatus.Tolerated,
  ProductIntroductionStatus.Failed,
];

export const SHELF_INTRODUCTION_STATUS_FILTER_VALUES: Array<
  ProductIntroductionStatus | ShelfIntroductionStatusFilter
> = [ShelfIntroductionStatusFilter.All, ...PRODUCT_INTRODUCTION_STATUS_VALUES];

export const SHELF_SORT_VALUES: ShelfSort[] = [
  ShelfSort.RecentlyAdded,
  ShelfSort.ExpiringSoon,
  ShelfSort.Alphabetical,
  ShelfSort.CategoryGrouped,
];

export const SHELF_STAT_FILTER_VALUES: ShelfStatFilter[] = [
  ShelfStatFilter.All,
  ShelfStatFilter.InUse,
  ShelfStatFilter.Unopened,
  ShelfStatFilter.NearingExpiry,
  ShelfStatFilter.Expired,
  ShelfStatFilter.Archived,
];

export const DATA_PROVENANCE_VALUES: DataProvenance[] = [
  DataProvenance.PhotoLookup,
];

export const CATALOGUE_SOURCE_VALUES: CatalogueSource[] = [
  CatalogueSource.UserPhotos,
  CatalogueSource.RitoraCatalogue,
  CatalogueSource.OpenBeautyFacts,
  CatalogueSource.OfficialPage,
];

export const LOOKUP_CONFIDENCE_VALUES: LookupConfidence[] = [
  LookupConfidence.High,
  LookupConfidence.Medium,
  LookupConfidence.Low,
];

export const DEFAULT_SHELF_PAGE_SIZE = 20;
export const MAX_SHELF_PAGE_SIZE = 30;

export enum ProductCategory {
  Cleanser = 'cleanser',
  Toner = 'toner',
  Essence = 'essence',
  Serum = 'serum',
  Moisturizer = 'moisturizer',
  SunProtection = 'sun-protection',
  Mask = 'mask',
  Exfoliant = 'exfoliant',
  EyeCare = 'eye-care',
  LipCare = 'lip-care',
  Treatment = 'treatment',
  Other = 'other',
}

export enum PreferredTimeOfDay {
  Morning = 'morning',
  Evening = 'evening',
  Either = 'either',
}

export enum ApplicationMethod {
  Fingertips = 'fingertips',
  CottonPad = 'cotton-pad',
  Brush = 'brush',
  Spray = 'spray',
  Dropper = 'dropper',
  Spatula = 'spatula',
  Other = 'other',
}

export enum Quantity {
  OneDrop = 'one-drop',
  TwoToThreeDrops = 'two-to-three-drops',
  PeaSize = 'pea-size',
  PumpOne = 'pump-one',
  PumpTwo = 'pump-two',
  CoinSize = 'coin-size',
  Generous = 'generous',
  AsNeeded = 'as-needed',
  Other = 'other',
}

export enum ShelfStatus {
  Active = 'active',
  Archived = 'archived',
  FinishedUp = 'finished-up',
}

export enum ShelfSort {
  RecentlyAdded = 'recently-added',
  ExpiringSoon = 'expiring-soon',
  Alphabetical = 'alphabetical',
  CategoryGrouped = 'category-grouped',
}

export enum ShelfStatFilter {
  All = 'all',
  InUse = 'in-use',
  Unopened = 'unopened',
  NearingExpiry = 'nearing-expiry',
  Expired = 'expired',
  Archived = 'archived',
}

export enum DataProvenance {
  BarcodeLookup = 'barcode-lookup',
  UrlFetch = 'url-fetch',
  Catalogue = 'catalogue',
  UserEntered = 'user-entered',
}

export interface CatalogueIdentity {
  brand: string;
  name: string;
  category: ProductCategory;
  barcode: string | null;
  imageUrls: string[];
  sizeMl: number | null;
  description: string | null;
  benefits: string[];
  suitedFor: string[];
  inciIngredients: string[];
  inciLastConfirmedAt: string | null;
}

export interface ApplicationGuidance {
  applicationMethod: ApplicationMethod | null;
  quantity: Quantity | null;
  steps: string[];
  cautions: string[];
  waitMinutes: number | null;
}

export interface ManufacturerInfo {
  brand: string;
  parentCompany: string | null;
  countryOfOrigin: string | null;
  countryOfManufacture: string | null;
  supportEmail: string | null;
  productUrl: string | null;
  websiteUrl: string | null;
}

export interface UserFields {
  openedAt: string | null;
  expiresAt: string | null;
  periodAfterOpeningMonths: number | null;
  pricePaid: number | null;
  pricePaidCurrency: string | null;
  purchasedFrom: string | null;
  personalNotes: string | null;
  preferredTimeOfDay: PreferredTimeOfDay | null;
}

export interface ShelfProductSnapshot {
  identity: CatalogueIdentity;
  guidance: ApplicationGuidance;
  manufacturer: ManufacturerInfo;
  userFields: UserFields;
  status: ShelfStatus;
  provenance: DataProvenance;
}

export interface CatalogueSuggestion {
  brand: string;
  name: string;
  category: ProductCategory;
  imageUrls: string[];
  sizeMl: number | null;
  barcode: string | null;
}

export interface ResolvedLookup {
  identity: Partial<CatalogueIdentity>;
  manufacturer: Partial<ManufacturerInfo>;
  provenance: DataProvenance;
}

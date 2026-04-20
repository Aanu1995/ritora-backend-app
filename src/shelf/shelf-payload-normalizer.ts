import { assertSafeExternalHttpUrl } from '../common/utils/url-security';
import {
  normalizeImportedTextList,
  normalizeImportedTextToNull,
} from '../common/utils/imported-text';
import { sanitizeProductNameCandidate } from '../common/utils/product-name';
import {
  ApplicationMethod,
  CatalogueSource,
  LookupConfidence,
  type LookupEvidence,
  ProductCategory,
  Quantity,
  type ApplicationGuidance,
  type CatalogueIdentity,
  type CatalogueSuggestion,
  type ManufacturerInfo,
  type ResolvedLookup,
  type UserFields,
} from './shelf.types';

const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  afghanistan: 'AF',
  albania: 'AL',
  algeria: 'DZ',
  argentina: 'AR',
  armenia: 'AM',
  australia: 'AU',
  austria: 'AT',
  azerbaijan: 'AZ',
  bahrain: 'BH',
  bangladesh: 'BD',
  belarus: 'BY',
  belgium: 'BE',
  brazil: 'BR',
  bulgaria: 'BG',
  cambodia: 'KH',
  canada: 'CA',
  chile: 'CL',
  china: 'CN',
  colombia: 'CO',
  'costa rica': 'CR',
  croatia: 'HR',
  cyprus: 'CY',
  czechia: 'CZ',
  denmark: 'DK',
  'dominican republic': 'DO',
  ecuador: 'EC',
  egypt: 'EG',
  estonia: 'EE',
  ethiopia: 'ET',
  finland: 'FI',
  france: 'FR',
  georgia: 'GE',
  germany: 'DE',
  ghana: 'GH',
  greece: 'GR',
  guatemala: 'GT',
  'hong kong': 'HK',
  hungary: 'HU',
  iceland: 'IS',
  india: 'IN',
  indonesia: 'ID',
  ireland: 'IE',
  israel: 'IL',
  italy: 'IT',
  jamaica: 'JM',
  japan: 'JP',
  jordan: 'JO',
  kazakhstan: 'KZ',
  kenya: 'KE',
  'korea, south': 'KR',
  'south korea': 'KR',
  'republic of korea': 'KR',
  'korea south': 'KR',
  kuwait: 'KW',
  latvia: 'LV',
  lebanon: 'LB',
  lithuania: 'LT',
  luxembourg: 'LU',
  malaysia: 'MY',
  malta: 'MT',
  mexico: 'MX',
  morocco: 'MA',
  netherlands: 'NL',
  'new zealand': 'NZ',
  nigeria: 'NG',
  norway: 'NO',
  oman: 'OM',
  pakistan: 'PK',
  panama: 'PA',
  peru: 'PE',
  philippines: 'PH',
  poland: 'PL',
  portugal: 'PT',
  qatar: 'QA',
  romania: 'RO',
  russia: 'RU',
  'saudi arabia': 'SA',
  serbia: 'RS',
  singapore: 'SG',
  slovakia: 'SK',
  slovenia: 'SI',
  'south africa': 'ZA',
  spain: 'ES',
  'sri lanka': 'LK',
  sweden: 'SE',
  switzerland: 'CH',
  taiwan: 'TW',
  thailand: 'TH',
  türkiye: 'TR',
  turkey: 'TR',
  ukraine: 'UA',
  'united arab emirates': 'AE',
  uae: 'AE',
  'united kingdom': 'GB',
  uk: 'GB',
  'great britain': 'GB',
  'united states': 'US',
  'united states of america': 'US',
  usa: 'US',
  uruguay: 'UY',
  uzbekistan: 'UZ',
  venezuela: 'VE',
  vietnam: 'VN',
};

const CATEGORY_VALUES = new Set<string>(Object.values(ProductCategory));
const APPLICATION_METHOD_VALUES = new Set<string>(
  Object.values(ApplicationMethod),
);
const QUANTITY_VALUES = new Set<string>(Object.values(Quantity));
const SOURCE_VALUES = new Set<string>(Object.values(CatalogueSource));
const CONFIDENCE_VALUES = new Set<string>(Object.values(LookupConfidence));

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeOptionalIsoString(
  value: string | null | undefined,
): string | null {
  const trimmed = trimToNull(value);
  if (!trimmed) {
    return null;
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function normalizeNonNegativeNumber(
  value: number | null | undefined,
): number | null {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    return null;
  }

  return value;
}

function normalizeStringList(values: string[] | null | undefined): string[] {
  return normalizeImportedTextList(values);
}

function normalizeProductNameToNull(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeImportedTextToNull(value);
  if (!normalized) {
    return null;
  }

  const sanitized = sanitizeProductNameCandidate(normalized);
  return sanitized.length > 0 ? sanitized : null;
}

function normalizeOptionalCountry(
  value: string | null | undefined,
): string | null {
  const trimmed = normalizeImportedTextToNull(value);
  if (!trimmed) {
    return null;
  }

  const upper = trimmed.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) {
    return upper;
  }

  return COUNTRY_NAME_TO_CODE[trimmed.toLowerCase()] ?? null;
}

function normalizeOptionalEmail(
  value: string | null | undefined,
): string | null {
  const trimmed = normalizeImportedTextToNull(value);
  if (!trimmed) {
    return null;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(trimmed) ? trimmed : null;
}

function normalizeOptionalUrl(value: string | null | undefined): string | null {
  const trimmed = normalizeImportedTextToNull(value);
  if (!trimmed) {
    return null;
  }

  try {
    assertSafeExternalHttpUrl(trimmed, 'Shelf payload URL');
    return trimmed;
  } catch {
    return null;
  }
}

function normalizeUrlList(values: string[] | null | undefined): string[] {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => normalizeOptionalUrl(value))
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function normalizeCategory(
  value: ProductCategory | null | undefined,
): ProductCategory | null {
  if (value && CATEGORY_VALUES.has(value)) {
    return value;
  }

  return null;
}

function normalizeEvidence(evidence: LookupEvidence[]): LookupEvidence[] {
  const seen = new Set<string>();

  return evidence.flatMap((item) => {
    const source = SOURCE_VALUES.has(item.source)
      ? item.source
      : CatalogueSource.OfficialPage;
    const url = normalizeOptionalUrl(item.url);
    const title = normalizeImportedTextToNull(item.title);
    const key = `${source}:${url ?? ''}:${title ?? ''}`;

    if (seen.has(key)) {
      return [];
    }

    seen.add(key);
    return [{ source, url, title }];
  });
}

export function normalizeCatalogueSuggestionPayload(
  suggestion: CatalogueSuggestion,
): CatalogueSuggestion {
  return {
    id: suggestion.id,
    brand: normalizeImportedTextToNull(suggestion.brand) ?? '',
    name: normalizeProductNameToNull(suggestion.name) ?? '',
    category: normalizeCategory(suggestion.category) ?? ProductCategory.Other,
    imageUrls: normalizeUrlList(suggestion.imageUrls),
    sizeMl: normalizeNonNegativeNumber(suggestion.sizeMl),
    barcode: trimToNull(suggestion.barcode),
    source: SOURCE_VALUES.has(suggestion.source)
      ? suggestion.source
      : CatalogueSource.OpenBeautyFacts,
    confidence: CONFIDENCE_VALUES.has(suggestion.confidence)
      ? suggestion.confidence
      : LookupConfidence.Low,
    reviewRequired: Boolean(suggestion.reviewRequired),
  };
}

export function normalizePartialCatalogueIdentity(
  identity: Partial<CatalogueIdentity>,
): Partial<CatalogueIdentity> {
  const normalized: Partial<CatalogueIdentity> = {};
  const brand = normalizeImportedTextToNull(identity.brand);
  const name = normalizeProductNameToNull(identity.name);
  const category = normalizeCategory(identity.category);
  const barcode = trimToNull(identity.barcode);
  const imageUrls = normalizeUrlList(identity.imageUrls);
  const sizeMl = normalizeNonNegativeNumber(identity.sizeMl);
  const description = normalizeImportedTextToNull(identity.description);
  const benefits = normalizeStringList(identity.benefits);
  const suitedFor = normalizeStringList(identity.suitedFor);
  const inciIngredients = normalizeStringList(identity.inciIngredients);
  const inciLastConfirmedAt = normalizeOptionalIsoString(
    identity.inciLastConfirmedAt,
  );

  if (brand) normalized.brand = brand;
  if (name) normalized.name = name;
  if (category) normalized.category = category;
  if (barcode) normalized.barcode = barcode;
  if (imageUrls.length > 0) normalized.imageUrls = imageUrls;
  if (sizeMl !== null) normalized.sizeMl = sizeMl;
  if (description) normalized.description = description;
  if (benefits.length > 0) normalized.benefits = benefits;
  if (suitedFor.length > 0) normalized.suitedFor = suitedFor;
  if (inciIngredients.length > 0) normalized.inciIngredients = inciIngredients;
  if (inciLastConfirmedAt) normalized.inciLastConfirmedAt = inciLastConfirmedAt;

  return normalized;
}

export function normalizePartialApplicationGuidance(
  guidance: Partial<ApplicationGuidance>,
): Partial<ApplicationGuidance> {
  const normalized: Partial<ApplicationGuidance> = {};

  if (
    guidance.applicationMethod &&
    APPLICATION_METHOD_VALUES.has(guidance.applicationMethod)
  ) {
    normalized.applicationMethod = guidance.applicationMethod;
  }

  if (guidance.quantity && QUANTITY_VALUES.has(guidance.quantity)) {
    normalized.quantity = guidance.quantity;
  }

  const steps = normalizeStringList(guidance.steps);
  const cautions = normalizeStringList(guidance.cautions);
  const waitMinutes = normalizeNonNegativeNumber(guidance.waitMinutes);

  if (steps.length > 0) normalized.steps = steps;
  if (cautions.length > 0) normalized.cautions = cautions;
  if (waitMinutes !== null) normalized.waitMinutes = Math.round(waitMinutes);

  return normalized;
}

export function normalizePartialManufacturerInfo(
  manufacturer: Partial<ManufacturerInfo>,
): Partial<ManufacturerInfo> {
  const normalized: Partial<ManufacturerInfo> = {};
  const brand = normalizeImportedTextToNull(manufacturer.brand);
  const parentCompany = normalizeImportedTextToNull(manufacturer.parentCompany);
  const countryOfOrigin = normalizeOptionalCountry(
    manufacturer.countryOfOrigin,
  );
  const countryOfManufacture = normalizeOptionalCountry(
    manufacturer.countryOfManufacture,
  );
  const supportEmail = normalizeOptionalEmail(manufacturer.supportEmail);
  const productUrl = normalizeOptionalUrl(manufacturer.productUrl);
  const websiteUrl =
    normalizeOptionalUrl(manufacturer.websiteUrl) ??
    (productUrl ? new URL(productUrl).origin : null);

  if (brand) normalized.brand = brand;
  if (parentCompany) normalized.parentCompany = parentCompany;
  if (countryOfOrigin) normalized.countryOfOrigin = countryOfOrigin;
  if (countryOfManufacture) {
    normalized.countryOfManufacture = countryOfManufacture;
  }
  if (supportEmail) normalized.supportEmail = supportEmail;
  if (productUrl) normalized.productUrl = productUrl;
  if (websiteUrl) normalized.websiteUrl = websiteUrl;

  return normalized;
}

export function normalizeResolvedLookupPayload(
  resolved: ResolvedLookup,
): ResolvedLookup {
  return {
    identity: normalizePartialCatalogueIdentity(resolved.identity),
    guidance: normalizePartialApplicationGuidance(resolved.guidance),
    manufacturer: normalizePartialManufacturerInfo(resolved.manufacturer),
    provenance: resolved.provenance,
    source: SOURCE_VALUES.has(resolved.source)
      ? resolved.source
      : CatalogueSource.OpenBeautyFacts,
    confidence: CONFIDENCE_VALUES.has(resolved.confidence)
      ? resolved.confidence
      : LookupConfidence.Low,
    reviewRequired: Boolean(resolved.reviewRequired),
    warnings: Array.from(new Set(resolved.warnings)),
    evidence: normalizeEvidence(resolved.evidence),
  };
}

export function normalizeCatalogueIdentitySnapshot(
  identity: Partial<CatalogueIdentity>,
): CatalogueIdentity {
  return {
    brand: normalizeImportedTextToNull(identity.brand) ?? '',
    name: normalizeProductNameToNull(identity.name) ?? '',
    category: normalizeCategory(identity.category) ?? ProductCategory.Other,
    barcode: trimToNull(identity.barcode),
    imageUrls: normalizeUrlList(identity.imageUrls),
    sizeMl: normalizeNonNegativeNumber(identity.sizeMl),
    description: normalizeImportedTextToNull(identity.description),
    benefits: normalizeStringList(identity.benefits),
    suitedFor: normalizeStringList(identity.suitedFor),
    inciIngredients: normalizeStringList(identity.inciIngredients),
    inciLastConfirmedAt: normalizeOptionalIsoString(
      identity.inciLastConfirmedAt,
    ),
  };
}

export function normalizeApplicationGuidanceSnapshot(
  guidance: Partial<ApplicationGuidance>,
): ApplicationGuidance {
  return {
    applicationMethod:
      guidance.applicationMethod &&
      APPLICATION_METHOD_VALUES.has(guidance.applicationMethod)
        ? guidance.applicationMethod
        : null,
    quantity:
      guidance.quantity && QUANTITY_VALUES.has(guidance.quantity)
        ? guidance.quantity
        : null,
    steps: normalizeStringList(guidance.steps),
    cautions: normalizeStringList(guidance.cautions),
    waitMinutes: normalizeNonNegativeNumber(guidance.waitMinutes),
  };
}

export function normalizeManufacturerInfoSnapshot(
  manufacturer: Partial<ManufacturerInfo>,
  fallbackBrand: string,
): ManufacturerInfo {
  const normalized = normalizePartialManufacturerInfo(manufacturer);

  return {
    brand: normalized.brand ?? normalizeImportedTextToNull(fallbackBrand) ?? '',
    parentCompany: normalized.parentCompany ?? null,
    countryOfOrigin: normalized.countryOfOrigin ?? null,
    countryOfManufacture: normalized.countryOfManufacture ?? null,
    supportEmail: normalized.supportEmail ?? null,
    productUrl: normalized.productUrl ?? null,
    websiteUrl: normalized.websiteUrl ?? null,
  };
}

export function normalizeUserFieldsSnapshot(
  userFields: Partial<UserFields>,
): UserFields {
  return {
    openedAt: normalizeOptionalIsoString(userFields.openedAt),
    expiresAt: normalizeOptionalIsoString(userFields.expiresAt),
    periodAfterOpeningMonths: normalizeNonNegativeNumber(
      userFields.periodAfterOpeningMonths,
    ),
    pricePaid: normalizeNonNegativeNumber(userFields.pricePaid),
    pricePaidCurrency: trimToNull(userFields.pricePaidCurrency),
    purchasedFrom: normalizeImportedTextToNull(userFields.purchasedFrom),
    personalNotes: normalizeImportedTextToNull(userFields.personalNotes),
    preferredTimeOfDay: userFields.preferredTimeOfDay ?? null,
  };
}

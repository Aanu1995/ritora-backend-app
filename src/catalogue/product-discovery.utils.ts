import {
  ProductCategory,
  type ApplicationGuidance,
  type CatalogueIdentity,
  type ManufacturerInfo,
} from '../shelf/shelf.types';
import {
  decodeHtmlEntities,
  htmlFragmentToText,
} from '../common/utils/imported-text';

const CATEGORY_KEYWORDS: Array<{
  category: ProductCategory;
  patterns: RegExp[];
}> = [
  {
    category: ProductCategory.Cleanser,
    patterns: [/\bcleanser\b/i, /\bface wash\b/i, /\bcleansing\b/i],
  },
  {
    category: ProductCategory.Toner,
    patterns: [/\btoner\b/i, /\bmist\b/i],
  },
  {
    category: ProductCategory.Essence,
    patterns: [/\bessence\b/i],
  },
  {
    category: ProductCategory.Serum,
    patterns: [/\bserum\b/i, /\bampoule\b/i],
  },
  {
    category: ProductCategory.Moisturizer,
    patterns: [/\bmoisturi[sz]er\b/i, /\bcream\b/i, /\blotion\b/i],
  },
  {
    category: ProductCategory.SunProtection,
    patterns: [/\bspf\b/i, /\bsunscreen\b/i, /\bsun cream\b/i],
  },
  {
    category: ProductCategory.Mask,
    patterns: [/\bmask\b/i],
  },
  {
    category: ProductCategory.Exfoliant,
    patterns: [
      /\bexfoli/i,
      /\bexfoliator\b/i,
      /\baha\b/i,
      /\bbha\b/i,
      /\bpeel\b/i,
    ],
  },
  {
    category: ProductCategory.EyeCare,
    patterns: [/\beye cream\b/i, /\beye serum\b/i, /\beye gel\b/i],
  },
  {
    category: ProductCategory.LipCare,
    patterns: [/\blip balm\b/i, /\blip mask\b/i, /\blip treatment\b/i],
  },
  {
    category: ProductCategory.Treatment,
    patterns: [/\btreatment\b/i, /\bretinol\b/i, /\bspot\b/i],
  },
];

export function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeBarcode(value: string): string {
  return value.trim();
}

export function normalizeUrl(value: string): string {
  return decodeHtmlEntities(value).trim().replace(/\/+$/, '').toLowerCase();
}

export function parseSizeMl(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const match = value.match(/(\d+(?:[.,]\d+)?)\s*(ml|mL)\b/);
  if (!match) {
    return null;
  }

  return Number(match[1].replace(',', '.'));
}

export function inferCategoryFromText(
  ...values: Array<string | null | undefined>
): ProductCategory {
  const haystack = values.filter(Boolean).join(' ');

  for (const entry of CATEGORY_KEYWORDS) {
    if (entry.patterns.some((pattern) => pattern.test(haystack))) {
      return entry.category;
    }
  }

  return ProductCategory.Other;
}

export function splitIngredients(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  const normalized = htmlFragmentToText(value, { preserveLineBreaks: true });

  return normalized
    .split(
      /[;,]\s*|\n+|\.\s+(?=[A-Z0-9][A-Za-z0-9-]*(?:\s+[A-Z0-9][A-Za-z0-9-]*){0,4})/,
    )
    .map((item) => item.replace(/[.\s]+$/g, '').trim())
    .filter(Boolean);
}

export function uniqueNonEmpty(
  values: Array<string | null | undefined>,
): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function hasMeaningfulText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasMeaningfulNumber(
  value: number | null | undefined,
): value is number {
  return typeof value === 'number' && !Number.isNaN(value);
}

function hasMeaningfulCategory(
  value: ProductCategory | null | undefined,
): value is ProductCategory {
  return Boolean(value) && value !== ProductCategory.Other;
}

function preferPatchScalar<T>(
  patch: T | null | undefined,
  base: T | null | undefined,
): T | null | undefined {
  if (typeof patch === 'string') {
    return hasMeaningfulText(patch) ? patch : base;
  }

  if (typeof patch === 'number') {
    return hasMeaningfulNumber(patch) ? patch : base;
  }

  return patch ?? base;
}

function fillMissingScalar<T>(
  base: T | null | undefined,
  patch: T | null | undefined,
): T | null | undefined {
  if (typeof base === 'string') {
    return hasMeaningfulText(base) ? base : patch;
  }

  if (typeof base === 'number') {
    return hasMeaningfulNumber(base) ? base : patch;
  }

  return base ?? patch;
}

function preferPatchCategory(
  patch: ProductCategory | null | undefined,
  base: ProductCategory | null | undefined,
): ProductCategory | null | undefined {
  if (hasMeaningfulCategory(patch)) {
    return patch;
  }

  return base ?? patch;
}

function fillMissingCategory(
  base: ProductCategory | null | undefined,
  patch: ProductCategory | null | undefined,
): ProductCategory | null | undefined {
  if (hasMeaningfulCategory(base)) {
    return base;
  }

  return patch ?? base;
}

function preferPatchArray<T>(
  patch: T[] | null | undefined,
  base: T[] | null | undefined,
): T[] | undefined {
  return patch && patch.length > 0 ? patch : (base ?? undefined);
}

function fillMissingArray<T>(
  base: T[] | null | undefined,
  patch: T[] | null | undefined,
): T[] | undefined {
  return base && base.length > 0 ? base : (patch ?? undefined);
}

export function mergeIdentity(
  base: Partial<CatalogueIdentity>,
  patch: Partial<CatalogueIdentity>,
): Partial<CatalogueIdentity> {
  return {
    brand: preferPatchScalar(patch.brand, base.brand) ?? undefined,
    name: preferPatchScalar(patch.name, base.name) ?? undefined,
    category: preferPatchCategory(patch.category, base.category) ?? undefined,
    barcode: preferPatchScalar(patch.barcode, base.barcode),
    imageUrls: preferPatchArray(patch.imageUrls, base.imageUrls),
    sizeMl: preferPatchScalar(patch.sizeMl, base.sizeMl),
    description: preferPatchScalar(patch.description, base.description),
    benefits: preferPatchArray(patch.benefits, base.benefits),
    suitedFor: preferPatchArray(patch.suitedFor, base.suitedFor),
    inciIngredients: preferPatchArray(
      patch.inciIngredients,
      base.inciIngredients,
    ),
    inciLastConfirmedAt: preferPatchScalar(
      patch.inciLastConfirmedAt,
      base.inciLastConfirmedAt,
    ),
  };
}

export function mergeGuidance(
  base: Partial<ApplicationGuidance>,
  patch: Partial<ApplicationGuidance>,
): Partial<ApplicationGuidance> {
  return {
    applicationMethod: preferPatchScalar(
      patch.applicationMethod,
      base.applicationMethod,
    ),
    quantity: preferPatchScalar(patch.quantity, base.quantity),
    steps: preferPatchArray(patch.steps, base.steps),
    cautions: preferPatchArray(patch.cautions, base.cautions),
    waitMinutes: preferPatchScalar(patch.waitMinutes, base.waitMinutes),
  };
}

export function mergeManufacturer(
  base: Partial<ManufacturerInfo>,
  patch: Partial<ManufacturerInfo>,
): Partial<ManufacturerInfo> {
  return {
    brand: preferPatchScalar(patch.brand, base.brand) ?? undefined,
    parentCompany: preferPatchScalar(patch.parentCompany, base.parentCompany),
    countryOfOrigin: preferPatchScalar(
      patch.countryOfOrigin,
      base.countryOfOrigin,
    ),
    countryOfManufacture: preferPatchScalar(
      patch.countryOfManufacture,
      base.countryOfManufacture,
    ),
    supportEmail: preferPatchScalar(patch.supportEmail, base.supportEmail),
    productUrl: preferPatchScalar(patch.productUrl, base.productUrl),
    websiteUrl: preferPatchScalar(patch.websiteUrl, base.websiteUrl),
  };
}

export function fillMissingIdentity(
  base: Partial<CatalogueIdentity>,
  patch: Partial<CatalogueIdentity>,
): Partial<CatalogueIdentity> {
  return {
    brand: fillMissingScalar(base.brand, patch.brand) ?? undefined,
    name: fillMissingScalar(base.name, patch.name) ?? undefined,
    category: fillMissingCategory(base.category, patch.category) ?? undefined,
    barcode: fillMissingScalar(base.barcode, patch.barcode),
    imageUrls: fillMissingArray(base.imageUrls, patch.imageUrls),
    sizeMl: fillMissingScalar(base.sizeMl, patch.sizeMl),
    description: fillMissingScalar(base.description, patch.description),
    benefits: fillMissingArray(base.benefits, patch.benefits),
    suitedFor: fillMissingArray(base.suitedFor, patch.suitedFor),
    inciIngredients: fillMissingArray(
      base.inciIngredients,
      patch.inciIngredients,
    ),
    inciLastConfirmedAt: fillMissingScalar(
      base.inciLastConfirmedAt,
      patch.inciLastConfirmedAt,
    ),
  };
}

export function fillMissingGuidance(
  base: Partial<ApplicationGuidance>,
  patch: Partial<ApplicationGuidance>,
): Partial<ApplicationGuidance> {
  return {
    applicationMethod: fillMissingScalar(
      base.applicationMethod,
      patch.applicationMethod,
    ),
    quantity: fillMissingScalar(base.quantity, patch.quantity),
    steps: fillMissingArray(base.steps, patch.steps),
    cautions: fillMissingArray(base.cautions, patch.cautions),
    waitMinutes: fillMissingScalar(base.waitMinutes, patch.waitMinutes),
  };
}

export function fillMissingManufacturer(
  base: Partial<ManufacturerInfo>,
  patch: Partial<ManufacturerInfo>,
): Partial<ManufacturerInfo> {
  return {
    brand: fillMissingScalar(base.brand, patch.brand) ?? undefined,
    parentCompany: fillMissingScalar(base.parentCompany, patch.parentCompany),
    countryOfOrigin: fillMissingScalar(
      base.countryOfOrigin,
      patch.countryOfOrigin,
    ),
    countryOfManufacture: fillMissingScalar(
      base.countryOfManufacture,
      patch.countryOfManufacture,
    ),
    supportEmail: fillMissingScalar(base.supportEmail, patch.supportEmail),
    productUrl: fillMissingScalar(base.productUrl, patch.productUrl),
    websiteUrl: fillMissingScalar(base.websiteUrl, patch.websiteUrl),
  };
}

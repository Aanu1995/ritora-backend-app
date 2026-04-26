import { assertSafeExternalHttpUrl } from '../common/utils/url-security';
import {
  normalizeImportedTextList,
  normalizeImportedTextToNull,
} from '../common/utils/imported-text';
import {
  APPLICATION_METHOD_VALUES,
  PRODUCT_CATEGORY_VALUES,
  QUANTITY_VALUES,
} from '../shelf/shelf.constants';
import {
  ApplicationMethod,
  CatalogueSource,
  ProductCategory,
  Quantity,
  type LookupEvidence,
} from '../shelf/shelf.types';
import type { OpenAiResponsePayload } from './openai-extraction.utils';

const NON_INGREDIENT_PATTERNS = [
  /\bfree of\b/i,
  /\bfragrance[- ]?free\b/i,
  /\bnon[- ]?(irritating|comedogenic|greasy|drying)\b/i,
  /\brecommended use\b/i,
  /\bproduct features?\b/i,
  /\bbenefits?\b/i,
  /\bmassage\b/i,
  /\brinse\b/i,
  /\bavoid\b/i,
  /\bsuitable for\b/i,
  /\bgentle on skin\b/i,
  /\bno microbeads?\b/i,
  /\bdeveloped with dermatologists\b/i,
  /\blearn more\b/i,
  /\bproducts? you may like\b/i,
  /\bview product\b/i,
  /\bbuy online\b/i,
  /\bcontact us\b/i,
  /\bfaq\b/i,
  /\bcookie(?:-| )settings\b/i,
  /\bprivacy policy\b/i,
  /\bterms?(?: &| and)? conditions\b/i,
  /\bcountries?(?: &| and)? regions?\b/i,
  /\byou are now leaving\b/i,
  /\bnot responsible for the content\b/i,
  /\bclicks\b/i,
  /\bdermastore\b/i,
  /\bdis-chem\b/i,
  /\bmydawa\b/i,
  /\bskinmiles\b/i,
  /\b\d+\s*ml\b/i,
  /©/,
];

export function sanitizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return normalizeImportedTextList(
    value.map((item) => (typeof item === 'string' ? item : null)),
  );
}

export function sanitizeSizeMl(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string') {
    const match = value.match(/(\d+(?:[.,]\d+)?)/);
    if (!match) {
      return null;
    }

    const parsed = Number(match[1].replace(',', '.'));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

export function sanitizeIngredientList(value: unknown): string[] {
  const rawItems = sanitizeStringList(value).flatMap((item) => {
    const parts =
      item.includes(',') && !/[.!?]/.test(item)
        ? item.split(/\s*,\s*/)
        : [item];

    return parts.map((part) => part.trim()).filter(Boolean);
  });

  return Array.from(
    new Set(
      rawItems
        .filter((item) => looksLikeIngredientName(item))
        .map((item) =>
          item
            .replace(/\s+/g, ' ')
            .replace(/[.;:,]+$/g, '')
            .trim(),
        ),
    ),
  );
}

export function sanitizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' ? normalizeImportedTextToNull(value) : null;
}

export function sanitizeConciseDescription(value: unknown): string | null {
  const text = sanitizeOptionalString(value);
  if (!text) {
    return null;
  }

  const singleLine = text.replace(/\s+/g, ' ').trim();
  const firstSentence =
    singleLine.match(/^.+?[.!?](?=\s|$)/)?.[0]?.trim() ?? singleLine;

  return truncateAtWordBoundary(firstSentence, 180);
}

export function sanitizeConciseList(
  value: unknown,
  options: {
    maxItems: number;
    maxChars: number;
    maxWords: number;
  },
): string[] {
  const items = sanitizeStringList(value);

  return Array.from(
    new Set(
      items.slice(0, options.maxItems).map((item) => {
        const normalized = item
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/^[•\-–—\d.)\s]+/, '')
          .replace(/[.;:,]+$/g, '');

        const words = normalized
          .split(/\s+/)
          .slice(0, options.maxWords)
          .join(' ');

        return truncateAtWordBoundary(words, options.maxChars);
      }),
    ),
  ).filter(Boolean);
}

export function sanitizeProductCategory(
  value: unknown,
): ProductCategory | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  return PRODUCT_CATEGORY_VALUES.includes(value as ProductCategory)
    ? (value as ProductCategory)
    : undefined;
}

export function sanitizeApplicationMethod(
  value: unknown,
): ApplicationMethod | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  if (APPLICATION_METHOD_VALUES.includes(value as ApplicationMethod)) {
    return value as ApplicationMethod;
  }

  return inferApplicationMethod(value);
}

export function sanitizeQuantity(value: unknown): Quantity | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  if (QUANTITY_VALUES.includes(value as Quantity)) {
    return value as Quantity;
  }

  return inferQuantity(value);
}

export function sanitizeWaitMinutes(value: unknown): number | null {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    return null;
  }

  return Math.round(value);
}

export function sanitizeOptionalUrl(value: unknown): string | null {
  const url = sanitizeOptionalString(value);
  if (!url) {
    return null;
  }

  try {
    assertSafeExternalHttpUrl(url, 'OpenAI product discovery URL');
    return url;
  } catch {
    return null;
  }
}

export function toWebsiteUrl(
  productUrl: string | null,
  fallback: string | null,
): string | null {
  if (fallback) {
    return fallback;
  }

  if (!productUrl) {
    return null;
  }

  try {
    return new URL(productUrl).origin;
  } catch {
    return null;
  }
}

export function extractEvidence(
  payload: OpenAiResponsePayload,
): LookupEvidence[] {
  const urls = new Set<string>();

  for (const item of payload.output ?? []) {
    if (item.type !== 'web_search_call') {
      continue;
    }

    for (const source of item.action?.sources ?? []) {
      if (source.type !== 'url' || typeof source.url !== 'string') {
        continue;
      }

      const safeUrl = sanitizeOptionalUrl(source.url);
      if (!safeUrl || urls.has(safeUrl)) {
        continue;
      }

      urls.add(safeUrl);
    }
  }

  return Array.from(urls).map((url) => ({
    source: CatalogueSource.OfficialPage,
    url,
    title: null,
  }));
}

function looksLikeIngredientName(value: string): boolean {
  const normalized = value.trim();
  if (
    !normalized ||
    NON_INGREDIENT_PATTERNS.some((rule) => rule.test(normalized))
  ) {
    return false;
  }

  if (normalized.length > 80 || /[!?]/.test(normalized)) {
    return false;
  }

  const normalizedWords = normalized
    .split(/\s+/)
    .map((word) => word.toLowerCase().replace(/[^a-z]/g, ''));
  const stopwordCount = normalizedWords.filter((word) =>
    [
      'a',
      'an',
      'and',
      'are',
      'as',
      'for',
      'from',
      'in',
      'is',
      'it',
      'its',
      'of',
      'on',
      'or',
      'our',
      'skin',
      'suitable',
      'that',
      'the',
      'this',
      'to',
      'use',
      'with',
      'your',
    ].includes(word),
  ).length;

  return normalizedWords.length <= 8 && stopwordCount <= 1;
}

function inferApplicationMethod(value: string): ApplicationMethod | undefined {
  if (/\bcotton\s+(?:pad|round|ball)\b/i.test(value)) {
    return ApplicationMethod.CottonPad;
  }

  if (/\b(?:finger(?:tip)?s?|hands?|palms?)\b/i.test(value)) {
    return ApplicationMethod.Fingertips;
  }

  if (/\b(?:spray|spritz|mist)\b/i.test(value)) {
    return ApplicationMethod.Spray;
  }

  if (/\b(?:dropper|pipette)\b/i.test(value)) {
    return ApplicationMethod.Dropper;
  }

  if (/\b(?:brush)\b/i.test(value)) {
    return ApplicationMethod.Brush;
  }

  if (/\b(?:spatula|scoop)\b/i.test(value)) {
    return ApplicationMethod.Spatula;
  }

  return undefined;
}

function inferQuantity(value: string): Quantity | undefined {
  if (/\b(?:two|2)\s*(?:to|-)\s*(?:three|3)\s*drops?\b/i.test(value)) {
    return Quantity.TwoToThreeDrops;
  }

  if (/\b(?:a\s+)?few\s+drops?\b/i.test(value)) {
    return Quantity.TwoToThreeDrops;
  }

  if (/\b(?:one|1|single)\s+drop\b/i.test(value)) {
    return Quantity.OneDrop;
  }

  if (/\bpea[-\s]?sized?\b/i.test(value)) {
    return Quantity.PeaSize;
  }

  if (/\b(?:one|1)\s+pumps?\b/i.test(value)) {
    return Quantity.PumpOne;
  }

  if (/\b(?:two|2)\s+pumps?\b/i.test(value)) {
    return Quantity.PumpTwo;
  }

  if (/\bcoin[-\s]?sized?\b/i.test(value)) {
    return Quantity.CoinSize;
  }

  if (/\b(?:generous|liberal)\s+(?:amount|layer)\b/i.test(value)) {
    return Quantity.Generous;
  }

  if (/\bas needed\b/i.test(value)) {
    return Quantity.AsNeeded;
  }

  return undefined;
}

function truncateAtWordBoundary(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const clipped = value.slice(0, maxLength + 1);
  const boundary = Math.max(
    clipped.lastIndexOf('. '),
    clipped.lastIndexOf('; '),
    clipped.lastIndexOf(', '),
    clipped.lastIndexOf(' '),
  );

  return clipped
    .slice(0, boundary > 40 ? boundary : maxLength)
    .trim()
    .replace(/[,\s]+$/g, '');
}

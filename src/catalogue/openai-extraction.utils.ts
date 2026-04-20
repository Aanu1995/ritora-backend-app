import { assertSafeExternalHttpUrl } from '../common/utils/url-security';
import {
  normalizeImportedTextList,
  normalizeImportedTextToNull,
} from '../common/utils/imported-text';
import { PRODUCT_CATEGORY_VALUES } from '../shelf/shelf.constants';
import {
  CatalogueSource,
  LookupWarningCode,
  ProductCategory,
  type LookupEvidence,
} from '../shelf/shelf.types';

export type ExtractedGroundedData = {
  identity?: {
    brand?: string;
    name?: string;
    category?: ProductCategory;
    sizeMl?: number | null;
    description?: string | null;
    benefits?: string[];
    suitedFor?: string[];
    inciIngredients?: string[];
  };
  guidance?: {
    steps?: string[];
    cautions?: string[];
    waitMinutes?: number | null;
  };
  manufacturer?: {
    supportEmail?: string | null;
    countryOfOrigin?: string | null;
    countryOfManufacture?: string | null;
    parentCompany?: string | null;
    productUrl?: string | null;
    websiteUrl?: string | null;
  };
};

export type ExtractionResult = {
  data: ExtractedGroundedData;
  warnings: LookupWarningCode[];
  evidence: LookupEvidence[];
};

export type OpenAiResponsePayload = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
    action?: {
      sources?: Array<{
        type?: string;
        url?: string;
      }>;
    };
  }>;
};

export function extractJsonObject(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const firstBrace = fenced.indexOf('{');
  const lastBrace = fenced.lastIndexOf('}');

  return firstBrace >= 0 && lastBrace > firstBrace
    ? fenced.slice(firstBrace, lastBrace + 1)
    : fenced;
}

export function extractOutputText(
  payload: OpenAiResponsePayload,
): string | null {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type !== 'output_text') {
        continue;
      }

      if (typeof content.text === 'string' && content.text.trim()) {
        return content.text.trim();
      }
    }
  }

  return null;
}

export function toExtractionResult(
  parsed: ExtractedGroundedData,
  payload: OpenAiResponsePayload,
): ExtractionResult | null {
  const identity = parsed.identity ?? {};
  const guidance = parsed.guidance ?? {};
  const manufacturer = parsed.manufacturer ?? {};
  const evidence = extractEvidence(payload);
  const fallbackEvidenceUrl = evidence[0]?.url ?? null;

  const inferredCategory = sanitizeProductCategory(identity.category);
  const productUrl =
    sanitizeOptionalUrl(manufacturer.productUrl) ?? fallbackEvidenceUrl;
  const websiteUrl = toWebsiteUrl(
    productUrl,
    sanitizeOptionalUrl(manufacturer.websiteUrl),
  );
  const brand = sanitizeOptionalString(identity.brand);
  const name = sanitizeOptionalString(identity.name);
  const sizeMl = sanitizeSizeMl(identity.sizeMl);
  const description = sanitizeConciseDescription(identity.description);
  const supportEmail = sanitizeOptionalString(manufacturer.supportEmail);
  const countryOfOrigin = sanitizeOptionalString(manufacturer.countryOfOrigin);
  const countryOfManufacture = sanitizeOptionalString(
    manufacturer.countryOfManufacture,
  );
  const parentCompany = sanitizeOptionalString(manufacturer.parentCompany);
  const waitMinutes = sanitizeWaitMinutes(guidance.waitMinutes);
  const sanitized: ExtractedGroundedData = {
    identity: {
      ...(brand ? { brand } : {}),
      ...(name ? { name } : {}),
      ...(inferredCategory ? { category: inferredCategory } : {}),
      ...(sizeMl !== null ? { sizeMl } : {}),
      ...(description ? { description } : {}),
      benefits: sanitizeConciseList(identity.benefits, {
        maxItems: 4,
        maxChars: 40,
        maxWords: 4,
      }),
      suitedFor: sanitizeConciseList(identity.suitedFor, {
        maxItems: 4,
        maxChars: 40,
        maxWords: 4,
      }),
      inciIngredients: sanitizeIngredientList(identity.inciIngredients),
    },
    guidance: {
      steps: sanitizeConciseList(guidance.steps, {
        maxItems: 5,
        maxChars: 80,
        maxWords: 10,
      }),
      cautions: sanitizeConciseList(guidance.cautions, {
        maxItems: 5,
        maxChars: 80,
        maxWords: 10,
      }),
      ...(waitMinutes !== null ? { waitMinutes } : {}),
    },
    manufacturer: {
      ...(supportEmail ? { supportEmail } : {}),
      ...(countryOfOrigin ? { countryOfOrigin } : {}),
      ...(countryOfManufacture ? { countryOfManufacture } : {}),
      ...(parentCompany ? { parentCompany } : {}),
      ...(productUrl ? { productUrl } : {}),
      ...(websiteUrl ? { websiteUrl } : {}),
    },
  };

  const usedAnyField =
    Boolean(sanitized.identity?.brand) ||
    Boolean(sanitized.identity?.name) ||
    Boolean(sanitized.identity?.category) ||
    typeof sanitized.identity?.sizeMl === 'number' ||
    Boolean(sanitized.identity?.description) ||
    Boolean(sanitized.identity?.benefits?.length) ||
    Boolean(sanitized.identity?.suitedFor?.length) ||
    Boolean(sanitized.identity?.inciIngredients?.length) ||
    Boolean(sanitized.guidance?.steps?.length) ||
    Boolean(sanitized.guidance?.cautions?.length) ||
    typeof sanitized.guidance?.waitMinutes === 'number' ||
    Boolean(sanitized.manufacturer?.supportEmail) ||
    Boolean(sanitized.manufacturer?.countryOfOrigin) ||
    Boolean(sanitized.manufacturer?.countryOfManufacture) ||
    Boolean(sanitized.manufacturer?.parentCompany) ||
    Boolean(sanitized.manufacturer?.productUrl) ||
    Boolean(sanitized.manufacturer?.websiteUrl);

  if (!usedAnyField) {
    return null;
  }

  const warnings = [LookupWarningCode.AiNormalized];
  if (
    sanitized.guidance?.steps?.length ||
    sanitized.guidance?.cautions?.length
  ) {
    warnings.push(LookupWarningCode.GuidanceUnverified);
  }
  if (sanitized.identity?.inciIngredients?.length) {
    warnings.push(LookupWarningCode.IngredientsUnverified);
  }

  return {
    data: sanitized,
    warnings,
    evidence,
  };
}

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

function sanitizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return normalizeImportedTextList(
    value.map((item) => (typeof item === 'string' ? item : null)),
  );
}

function sanitizeSizeMl(value: unknown): number | null {
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

function sanitizeIngredientList(value: unknown): string[] {
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

function sanitizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' ? normalizeImportedTextToNull(value) : null;
}

function looksLikeIngredientName(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  if (NON_INGREDIENT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  if (normalized.length > 80) {
    return false;
  }

  if (/[!?]/.test(normalized)) {
    return false;
  }

  const words = normalized.split(/\s+/);
  if (words.length > 8) {
    return false;
  }

  const normalizedWords = words.map((word) =>
    word.toLowerCase().replace(/[^a-z]/g, ''),
  );
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

  return stopwordCount <= 1;
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

function sanitizeConciseDescription(value: unknown): string | null {
  const text = sanitizeOptionalString(value);
  if (!text) {
    return null;
  }

  const singleLine = text.replace(/\s+/g, ' ').trim();
  const firstSentence =
    singleLine.match(/^.+?[.!?](?=\s|$)/)?.[0]?.trim() ?? singleLine;

  return truncateAtWordBoundary(firstSentence, 180);
}

function sanitizeConciseList(
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

function sanitizeProductCategory(value: unknown): ProductCategory | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  return PRODUCT_CATEGORY_VALUES.includes(value as ProductCategory)
    ? (value as ProductCategory)
    : undefined;
}

function sanitizeWaitMinutes(value: unknown): number | null {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    return null;
  }

  return Math.round(value);
}

function sanitizeOptionalUrl(value: unknown): string | null {
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

function toWebsiteUrl(
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

function extractEvidence(payload: OpenAiResponsePayload): LookupEvidence[] {
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

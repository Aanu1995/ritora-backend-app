import { CatalogueSource, ProductCategory } from '../shelf/shelf.types';
import {
  decodeHtmlEntities,
  htmlFragmentToText,
} from '../common/utils/imported-text';
import {
  humanizeProductUrlSegment,
  sanitizeProductNameCandidate,
} from '../common/utils/product-name';
import type { OfficialPageExtraction } from './product-discovery.types';
import {
  inferCategoryFromText,
  normalizeBarcode,
  parseSizeMl,
  splitIngredients,
  uniqueNonEmpty,
} from './product-discovery.utils';

type JsonObject = Record<string, unknown>;
type JsonLdProduct = JsonObject & {
  '@type'?: string | string[];
  name?: string;
  description?: string;
  category?: string;
  image?: string | string[] | JsonObject | JsonObject[];
  brand?: string | JsonObject;
  gtin?: string;
  gtin8?: string;
  gtin12?: string;
  gtin13?: string;
  gtin14?: string;
  sku?: string;
};

const SECTION_BOUNDARY_LABELS = [
  'ingredients?',
  'how to use',
  'directions?',
  'usage',
  'warning',
  'warnings',
  'caution',
  'cautions',
  'benefits?',
  'what it does',
  'best for',
  'ideal for',
  'suitable for',
  'skin types?',
  'good for',
];

const BENEFIT_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bhydrat/i, label: 'hydrating' },
  { pattern: /\bmoisturi[sz]/i, label: 'moisturizing' },
  { pattern: /\bsooth/i, label: 'soothing' },
  { pattern: /\bcalm/i, label: 'calming' },
  { pattern: /\bbarrier/i, label: 'barrier-supporting' },
  { pattern: /\bsmooth/i, label: 'smoothing' },
  { pattern: /\bbright/i, label: 'brightening' },
  { pattern: /\bclean(?:se|sing)\b/i, label: 'cleansing' },
  { pattern: /\bclarif/i, label: 'clarifying' },
  { pattern: /\bnon[-\s]?strip/i, label: 'non-stripping' },
  { pattern: /\bnourish/i, label: 'nourishing' },
  { pattern: /\brepair/i, label: 'repairing' },
  { pattern: /\bprotect/i, label: 'protective' },
  { pattern: /\bexfoliat/i, label: 'exfoliating' },
];

const SUITED_FOR_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bdry skin\b/i, label: 'dry skin' },
  { pattern: /\boily skin\b/i, label: 'oily skin' },
  { pattern: /\bcombination skin\b/i, label: 'combination skin' },
  { pattern: /\bsensitive skin\b/i, label: 'sensitive skin' },
  { pattern: /\bnormal skin\b/i, label: 'normal skin' },
  { pattern: /\bacne[-\s]?prone\b/i, label: 'acne-prone skin' },
  { pattern: /\bdehydrated skin\b/i, label: 'dehydrated skin' },
  { pattern: /\bmature skin\b/i, label: 'mature skin' },
  { pattern: /\brough(?: and)? bumpy skin\b/i, label: 'rough and bumpy skin' },
];

function stripCodeFences(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
}

function stripHtml(value: string): string {
  return htmlFragmentToText(value);
}

function flattenJsonLd(node: unknown): JsonLdProduct[] {
  if (!node) {
    return [];
  }

  if (Array.isArray(node)) {
    return node.flatMap((item) => flattenJsonLd(item));
  }

  if (typeof node !== 'object') {
    return [];
  }

  const object = node as JsonObject;
  const graph = object['@graph'];

  if (Array.isArray(graph)) {
    return graph.flatMap((item) => flattenJsonLd(item));
  }

  const typeValue = object['@type'];
  const types = Array.isArray(typeValue) ? typeValue : [typeValue];
  const isProduct = types.some(
    (type) => typeof type === 'string' && type.toLowerCase() === 'product',
  );

  return isProduct ? [object] : [];
}

function extractJsonLdProducts(html: string): JsonLdProduct[] {
  const scripts = Array.from(
    html.matchAll(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  );

  return scripts.flatMap((match) => {
    const raw = stripCodeFences(decodeHtmlEntities(match[1]));

    try {
      return flattenJsonLd(JSON.parse(raw));
    } catch {
      return [];
    }
  });
}

function extractMetaTags(html: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const matches = Array.from(html.matchAll(/<meta\s+[^>]*>/gi));

  for (const [tag] of matches) {
    const nameMatch =
      tag.match(/\b(?:name|property)=["']([^"']+)["']/i) ??
      tag.match(
        /\bcontent=("[^"]*"|'[^']*')[^>]*\b(?:name|property)=["']([^"']+)["']/i,
      );
    const contentMatch =
      tag.match(/\bcontent=["']([^"']*)["']/i) ??
      tag.match(
        /\b(?:name|property)=("[^"]*"|'[^']*')[^>]*\bcontent=["']([^"']*)["']/i,
      );

    const key = nameMatch?.[1] ?? nameMatch?.[2];
    const value = contentMatch?.[1] ?? contentMatch?.[2];

    if (!key || !value) {
      continue;
    }

    meta[key.toLowerCase()] = decodeHtmlEntities(value.trim());
  }

  return meta;
}

function extractTitleTag(html: string): string | null {
  const value = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];

  return value ? stripHtml(value) : null;
}

function extractFirstHeading(html: string): string | null {
  const value = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];

  return value ? stripHtml(value) : null;
}

function cleanBrandCandidate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = stripHtml(value)
    .replace(/\b(official|shop|store|global)\b/gi, '')
    .replace(/[-|:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized.length > 0 ? normalized : null;
}

function pickPageBrand(
  meta: Record<string, string>,
  titleTag: string | null,
  url: string,
): string | null {
  const metaCandidates = [
    meta['og:site_name'],
    meta['application-name'],
    titleTag?.split(/[|–-]/)[0] ?? null,
  ];

  for (const candidate of metaCandidates) {
    const cleaned = cleanBrandCandidate(candidate);
    if (cleaned) {
      return cleaned;
    }
  }

  try {
    const hostname = new URL(url).hostname
      .replace(/^www\./i, '')
      .split('.')[0]
      ?.replace(/[-_]+/g, ' ')
      .trim();

    return cleanBrandCandidate(hostname);
  } catch {
    return null;
  }
}

function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickStructuredBrand(product: JsonLdProduct): string | null {
  if (typeof product.brand === 'string') {
    return product.brand.trim();
  }

  if (product.brand && typeof product.brand === 'object') {
    const brandName = product.brand.name;
    if (typeof brandName === 'string') {
      return brandName.trim();
    }
  }

  return null;
}

function pickStructuredImages(product: JsonLdProduct): string[] {
  if (typeof product.image === 'string') {
    return [product.image];
  }

  if (Array.isArray(product.image)) {
    return uniqueNonEmpty(
      product.image.map((item) => {
        if (typeof item === 'string') {
          return item;
        }

        if (item && typeof item === 'object') {
          const url = item.url;
          return typeof url === 'string' ? url : null;
        }

        return null;
      }),
    );
  }

  if (product.image && typeof product.image === 'object') {
    const url = product.image.url;
    return typeof url === 'string' ? [url] : [];
  }

  return [];
}

function pickStructuredBarcode(product: JsonLdProduct): string | null {
  return (
    uniqueNonEmpty([
      typeof product.gtin13 === 'string' ? product.gtin13 : null,
      typeof product.gtin12 === 'string' ? product.gtin12 : null,
      typeof product.gtin14 === 'string' ? product.gtin14 : null,
      typeof product.gtin8 === 'string' ? product.gtin8 : null,
      typeof product.gtin === 'string' ? product.gtin : null,
    ])
      .map((value) => normalizeBarcode(value))
      .find(Boolean) ?? null
  );
}

function extractRelevantExcerpt(text: string): string | null {
  if (!text) {
    return null;
  }

  const matches = text.match(
    /(benefits?|what it does|best for|ideal for|suitable for|skin types?|good for|ingredients?|how to use|directions|usage|warning|warnings|caution|cautions)[\s\S]{0,3200}/i,
  );

  return (matches?.[0] ?? text.slice(0, 4000)).trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractSectionContent(
  text: string | null,
  labels: string[],
  maxLength = 800,
): string | null {
  if (!text) {
    return null;
  }

  const labelPattern = labels.map((label) => escapeRegex(label)).join('|');
  const boundaryPattern = SECTION_BOUNDARY_LABELS.join('|');
  const regex = new RegExp(
    `(?:${labelPattern})\\s*[:-]\\s*([\\s\\S]{0,${maxLength}}?)(?=(?:${boundaryPattern})\\s*[:-]|$)`,
    'i',
  );

  return text.match(regex)?.[1]?.trim() ?? null;
}

function splitSectionList(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return uniqueNonEmpty(
    value
      .split(/\s*[•·]\s*|;\s*|\.\s+|\n+/)
      .map((item) => item.replace(/\s+/g, ' ').trim())
      .filter(Boolean),
  );
}

function splitCompactList(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return uniqueNonEmpty(
    value.split(/,\s*|\/\s*/).map((item) => item.replace(/\s+/g, ' ').trim()),
  );
}

function extractSupportEmail(text: string, html?: string): string | null {
  const mailtoMatch = html?.match(
    /mailto:\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i,
  )?.[1];
  if (mailtoMatch) {
    return mailtoMatch.trim();
  }

  const match = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);

  return match?.[0]?.trim() ?? null;
}

function splitMetaKeywords(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  return uniqueNonEmpty(
    value.split(/[;,]/).map((item) => item.replace(/\s+/g, ' ').trim()),
  );
}

function extractBenefitsFromText(
  ...values: Array<string | null | undefined>
): string[] {
  const haystack = values.filter(Boolean).join(' ');

  return uniqueNonEmpty(
    BENEFIT_PATTERNS.filter((entry) => entry.pattern.test(haystack)).map(
      (entry) => entry.label,
    ),
  ).slice(0, 4);
}

function extractSuitedForFromText(
  ...values: Array<string | null | undefined>
): string[] {
  const haystack = values.filter(Boolean).join(' ');

  return uniqueNonEmpty(
    SUITED_FOR_PATTERNS.filter((entry) => entry.pattern.test(haystack)).map(
      (entry) => entry.label,
    ),
  ).slice(0, 4);
}

function extractCautionsFromText(text: string): string[] {
  const cautions = [
    text.match(
      /avoid (?:direct )?(?:contact with|getting product in) the eyes?/i,
    )
      ? 'Avoid direct contact with the eyes.'
      : null,
    text.match(/for external use only/i) ? 'For external use only.' : null,
    text.match(/stop use if irritation occurs/i)
      ? 'Stop use if irritation occurs.'
      : null,
    text.match(/keep out of reach of children/i)
      ? 'Keep out of reach of children.'
      : null,
  ];

  return uniqueNonEmpty(cautions);
}

function extractLinkedIngredientList(html: string): string[] {
  const markerIndex = html.search(/ingredlist-short|ingredients overview/i);
  if (markerIndex < 0) {
    return [];
  }

  const excerpt = html.slice(markerIndex, markerIndex + 12000);

  return uniqueNonEmpty(
    Array.from(
      excerpt.matchAll(
        /<a[^>]*class="[^"]*ingred-link[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
      ),
      (match) =>
        stripHtml(match[1])
          .replace(/\s+\d+(?:\.\d+)?%$/g, '')
          .trim(),
    ),
  );
}

function extractNameFromUrl(url: string): string | null {
  try {
    const segments = new URL(url).pathname
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean);
    const lastSegment = segments.at(-1);

    if (!lastSegment) {
      return null;
    }

    const candidate = humanizeProductUrlSegment(lastSegment);

    return candidate.length > 0 ? candidate : null;
  } catch {
    return null;
  }
}

function cleanNameCandidate(
  value: string | null | undefined,
  brand: string | null,
): string | null {
  if (!value) {
    return null;
  }

  let candidate = value.replace(/\s+/g, ' ').trim();
  candidate = candidate
    .replace(/\s+\|\s+.*$/, '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/:\s*product page$/i, '')
    .replace(/^product page for\s+/i, '')
    .replace(/^shop\s+/i, '')
    .replace(/\s+official site$/i, '')
    .replace(/\s+review$/i, '')
    .trim();

  if (brand) {
    const escapedBrand = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    candidate = candidate
      .replace(new RegExp(`^${escapedBrand}\\s+`, 'i'), '')
      .replace(new RegExp(`\\s+by\\s+${escapedBrand}$`, 'i'), '')
      .trim();
  }

  candidate = sanitizeProductNameCandidate(candidate);

  return candidate.length > 1 ? candidate : null;
}

function looksPromotional(value: string): boolean {
  return (
    /\bi love\b/i.test(value) ||
    /\byou will too\b/i.test(value) ||
    /\bshop now\b/i.test(value) ||
    /\bbuy now\b/i.test(value) ||
    value.length > 110
  );
}

function normalizeCandidate(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function chooseProductName(options: {
  structuredName: string | null;
  headingName: string | null;
  titleName: string | null;
  pageTitle: string | null;
  urlName: string | null;
  brand: string | null;
}): string | null {
  const candidates = [
    {
      value: cleanNameCandidate(options.structuredName, options.brand),
      baseScore: 100,
    },
    {
      value: cleanNameCandidate(options.headingName, options.brand),
      baseScore: 80,
    },
    {
      value: cleanNameCandidate(options.titleName, options.brand),
      baseScore: 70,
    },
    {
      value: cleanNameCandidate(options.pageTitle, options.brand),
      baseScore: 55,
    },
    {
      value: cleanNameCandidate(options.urlName, options.brand),
      baseScore: 60,
    },
  ].filter((entry): entry is { value: string; baseScore: number } =>
    Boolean(entry.value),
  );

  if (candidates.length === 0) {
    return null;
  }

  const scored = candidates
    .map((entry) => {
      let score = entry.baseScore;

      if (inferCategoryFromText(entry.value) !== ProductCategory.Other) {
        score += 25;
      }

      if (
        options.urlName &&
        normalizeCandidate(entry.value) === normalizeCandidate(options.urlName)
      ) {
        score += 20;
      }

      if (looksPromotional(entry.value)) {
        score -= 80;
      }

      return {
        value: entry.value,
        score,
      };
    })
    .sort((left, right) => right.score - left.score);

  return scored[0]?.value ?? null;
}

export function extractOfficialPageExtraction(
  html: string,
  url: string,
): OfficialPageExtraction {
  const products = extractJsonLdProducts(html);
  const structuredProduct = products[0];
  const meta = extractMetaTags(html);
  const titleTag = extractTitleTag(html);
  const headingName = extractFirstHeading(html);
  const text = extractText(html);
  const excerpt = extractRelevantExcerpt(text);
  const pageTitle = meta['og:title'] ?? meta['twitter:title'] ?? titleTag;
  const description =
    structuredProduct?.description ??
    meta['og:description'] ??
    meta['description'] ??
    null;
  const brand =
    (structuredProduct ? pickStructuredBrand(structuredProduct) : null) ??
    pickPageBrand(meta, titleTag, url);
  const urlName = extractNameFromUrl(url);
  const name = chooseProductName({
    structuredName: structuredProduct?.name?.trim() ?? null,
    headingName,
    titleName: titleTag,
    pageTitle,
    urlName,
    brand,
  });
  const imageUrls = structuredProduct
    ? pickStructuredImages(structuredProduct)
    : uniqueNonEmpty([meta['og:image'], meta['twitter:image']]);
  const barcode = structuredProduct
    ? pickStructuredBarcode(structuredProduct)
    : null;
  const ingredients = uniqueNonEmpty([
    ...splitIngredients(extractSectionContent(excerpt, ['ingredients'], 2400)),
    ...extractLinkedIngredientList(html),
  ]);
  const metaKeywords = splitMetaKeywords(meta['keywords']);
  const benefits = uniqueNonEmpty([
    ...splitSectionList(
      extractSectionContent(excerpt, ['benefits', 'what it does']),
    ),
    ...extractBenefitsFromText(description, excerpt, metaKeywords.join(' ')),
  ]).slice(0, 4);
  const suitedFor = uniqueNonEmpty([
    ...splitCompactList(
      extractSectionContent(excerpt, [
        'best for',
        'ideal for',
        'suitable for',
        'skin type',
        'skin types',
        'good for',
      ]),
    ),
    ...extractSuitedForFromText(description, excerpt, metaKeywords.join(' ')),
  ]).slice(0, 4);
  const steps = splitSectionList(
    extractSectionContent(excerpt, ['how to use', 'directions', 'usage']),
  );
  const cautions = uniqueNonEmpty([
    ...splitSectionList(
      extractSectionContent(excerpt, [
        'warning',
        'warnings',
        'caution',
        'cautions',
      ]),
    ),
    ...extractCautionsFromText(text),
  ]).slice(0, 5);
  const supportEmail = extractSupportEmail(text, html);
  const sizeMl = parseSizeMl(
    [name, description, excerpt].filter(Boolean).join(' '),
  );
  const category =
    structuredProduct?.category &&
    typeof structuredProduct.category === 'string'
      ? inferCategoryFromText(structuredProduct.category)
      : inferCategoryFromText(name, description, pageTitle);

  return {
    identity: {
      brand: brand ?? undefined,
      name: name ?? undefined,
      category: category ?? ProductCategory.Other,
      barcode,
      imageUrls,
      sizeMl,
      description: description?.trim() ?? null,
      benefits,
      suitedFor,
      ...(ingredients.length > 0
        ? {
            inciIngredients: ingredients,
            inciLastConfirmedAt: new Date().toISOString(),
          }
        : {}),
    },
    guidance: {
      steps,
      cautions,
    },
    manufacturer: {
      brand: brand ?? undefined,
      ...(supportEmail ? { supportEmail } : {}),
      productUrl: url,
      websiteUrl: new URL(url).origin,
    },
    evidence: [
      {
        source: CatalogueSource.OfficialPage,
        url,
        title: name ?? pageTitle,
      },
    ],
    rawSource: {
      url,
      meta,
      structuredProduct: structuredProduct ?? null,
      titleTag,
      headingName,
    },
    textExcerpt: excerpt,
  };
}

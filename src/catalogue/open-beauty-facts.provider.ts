import { Injectable, Logger } from '@nestjs/common';
import {
  CatalogueSource,
  DataProvenance,
  LookupConfidence,
  LookupWarningCode,
} from '../shelf/shelf.types';
import type {
  DiscoveredSuggestion,
  ResolvedProductDraft,
} from './product-discovery.types';
import {
  inferCategoryFromText,
  normalizeBarcode,
  parseSizeMl,
  splitIngredients,
  uniqueNonEmpty,
} from './product-discovery.utils';

type OpenBeautyFactsProduct = {
  code?: string;
  product_name?: string;
  product_name_en?: string;
  generic_name?: string;
  generic_name_en?: string;
  brands?: string;
  brands_owner?: string;
  quantity?: string;
  image_front_small_url?: string;
  image_front_url?: string;
  image_url?: string;
  ingredients_text?: string;
  categories?: string;
  categories_tags?: string[];
  origins?: string;
  manufacturing_places?: string;
  contact_email?: string;
  customer_service?: string;
  link?: string;
  url?: string;
  product_web_page_url?: string;
};

type SearchResponse = {
  products?: OpenBeautyFactsProduct[];
  page?: number;
  page_count?: number;
};

type ProductResponse = {
  product?: OpenBeautyFactsProduct;
  status?: number;
};

const SEARCH_PAGE_SIZE = 20;
const SEARCH_ENDPOINT = 'https://world.openbeautyfacts.org/cgi/search.pl';
const PRODUCT_ENDPOINT = 'https://world.openbeautyfacts.org/api/v2/product';
const REQUEST_TIMEOUT_MS = 8000;
const REQUEST_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Ritora/1.0 (+https://getritora.com)',
};

function pickProductName(product: OpenBeautyFactsProduct): string {
  return (
    product.product_name ??
    product.product_name_en ??
    product.generic_name ??
    product.generic_name_en ??
    ''
  ).trim();
}

function pickBrand(product: OpenBeautyFactsProduct): string {
  return (
    (product.brands ?? '')
      .split(',')
      .map((value) => value.trim())
      .find(Boolean) ?? ''
  );
}

function pickProductUrl(product: OpenBeautyFactsProduct): string | null {
  return product.product_web_page_url ?? null;
}

function pickEvidenceUrl(product: OpenBeautyFactsProduct): string | null {
  return product.product_web_page_url ?? product.link ?? product.url ?? null;
}

function pickFirstValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const candidate =
    value
      .split(',')
      .map((part) => part.trim())
      .find(Boolean) ?? null;

  return candidate && candidate.length > 0 ? candidate : null;
}

function pickSupportEmail(product: OpenBeautyFactsProduct): string | null {
  for (const source of [product.contact_email, product.customer_service]) {
    if (!source) {
      continue;
    }

    const email = source.match(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    )?.[0];

    if (email) {
      return email.trim();
    }
  }

  return null;
}

function productOrigin(url: string | null): string | null {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function pickImageUrls(product: OpenBeautyFactsProduct): string[] {
  return uniqueNonEmpty([
    product.image_front_small_url,
    product.image_front_url,
    product.image_url,
  ]);
}

function toSuggestion(
  product: OpenBeautyFactsProduct,
): DiscoveredSuggestion | null {
  const barcode = normalizeBarcode(product.code ?? '');
  const name = pickProductName(product);
  const brand = pickBrand(product);

  if (!barcode || !name || !brand) {
    return null;
  }

  return {
    id: barcode,
    source: CatalogueSource.OpenBeautyFacts,
    brand,
    name,
    category: inferCategoryFromText(name, product.categories),
    imageUrls: pickImageUrls(product),
    sizeMl: parseSizeMl(product.quantity),
    barcode,
    confidence: LookupConfidence.Low,
    reviewRequired: true,
  };
}

function toResolvedDraft(
  product: OpenBeautyFactsProduct,
  provenance: DataProvenance,
): ResolvedProductDraft | null {
  const barcode = normalizeBarcode(product.code ?? '');
  const name = pickProductName(product);
  const brand = pickBrand(product);

  if (!barcode || !name || !brand) {
    return null;
  }

  const productUrl = pickProductUrl(product);
  const evidenceUrl = pickEvidenceUrl(product);
  const ingredients = splitIngredients(product.ingredients_text);

  return {
    identity: {
      brand,
      name,
      category: inferCategoryFromText(name, product.categories),
      barcode,
      imageUrls: pickImageUrls(product),
      sizeMl: parseSizeMl(product.quantity),
      description: product.generic_name_en ?? product.generic_name ?? null,
      benefits: [],
      suitedFor: [],
      inciIngredients: ingredients,
      inciLastConfirmedAt:
        ingredients.length > 0 ? new Date().toISOString() : null,
    },
    guidance: {},
    manufacturer: {
      brand,
      parentCompany: pickFirstValue(product.brands_owner),
      countryOfOrigin: pickFirstValue(product.origins),
      countryOfManufacture: pickFirstValue(product.manufacturing_places),
      supportEmail: pickSupportEmail(product),
      productUrl,
      websiteUrl: productOrigin(productUrl),
    },
    provenance,
    source: CatalogueSource.OpenBeautyFacts,
    confidence: LookupConfidence.Low,
    reviewRequired: true,
    warnings: [
      LookupWarningCode.ReviewRequired,
      LookupWarningCode.CommunityData,
      ...(ingredients.length > 0
        ? [LookupWarningCode.IngredientsUnverified]
        : [LookupWarningCode.PartialData]),
    ],
    evidence: [
      {
        source: CatalogueSource.OpenBeautyFacts,
        url: evidenceUrl,
        title: `${brand} ${name}`,
      },
    ],
    cacheKey: {
      source: CatalogueSource.OpenBeautyFacts,
      id: barcode,
      url: productUrl,
    },
    rawSource: {
      openBeautyFacts: product,
    },
  };
}

@Injectable()
export class OpenBeautyFactsProvider {
  private readonly logger = new Logger(OpenBeautyFactsProvider.name);

  async search(
    query: string,
    page: number,
  ): Promise<{
    items: DiscoveredSuggestion[];
    hasMore: boolean;
  }> {
    const params = new URLSearchParams({
      search_terms: query,
      search_simple: '1',
      action: 'process',
      json: '1',
      page: String(page),
      page_size: String(SEARCH_PAGE_SIZE),
      fields: [
        'code',
        'product_name',
        'product_name_en',
        'generic_name',
        'generic_name_en',
        'brands',
        'brands_owner',
        'quantity',
        'image_front_small_url',
        'image_front_url',
        'image_url',
        'categories',
      ].join(','),
    });

    const response = await this.fetchJson<SearchResponse>(
      `${SEARCH_ENDPOINT}?${params.toString()}`,
    );
    const products = response?.products ?? [];
    const items = products
      .map((product) => toSuggestion(product))
      .filter((product): product is DiscoveredSuggestion => product !== null);
    const currentPage = response?.page ?? page;
    const pageCount = response?.page_count ?? currentPage;

    return {
      items,
      hasMore: currentPage < pageCount,
    };
  }

  async resolveBarcode(
    barcode: string,
    provenance: DataProvenance,
  ): Promise<ResolvedProductDraft | null> {
    const normalizedBarcode = normalizeBarcode(barcode);
    if (!normalizedBarcode) {
      return null;
    }

    const fields = [
      'code',
      'product_name',
      'product_name_en',
      'generic_name',
      'generic_name_en',
      'brands',
      'brands_owner',
      'quantity',
      'image_front_small_url',
      'image_front_url',
      'image_url',
      'ingredients_text',
      'categories',
      'categories_tags',
      'origins',
      'manufacturing_places',
      'contact_email',
      'customer_service',
      'link',
      'url',
      'product_web_page_url',
    ].join(',');
    const response = await this.fetchJson<ProductResponse>(
      `${PRODUCT_ENDPOINT}/${encodeURIComponent(normalizedBarcode)}.json?fields=${fields}`,
    );
    const product =
      response?.status === 1 && response.product ? response.product : null;

    return product ? toResolvedDraft(product, provenance) : null;
  }

  private async fetchJson<T>(url: string): Promise<T | null> {
    try {
      const response = await fetch(url, {
        headers: REQUEST_HEADERS,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        return null;
      }

      return (await response.json()) as T;
    } catch (error) {
      this.logger.warn(
        `Open Beauty Facts request failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      return null;
    }
  }
}

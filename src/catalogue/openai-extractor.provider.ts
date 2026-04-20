import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isSafeExternalHttpUrl } from '../common/utils/url-security';
import { ProductCategory } from '../shelf/shelf.types';
import type {
  OfficialPageExtraction,
  ResolvedProductDraft,
} from './product-discovery.types';
import {
  extractJsonObject,
  extractOutputText,
  type ExtractedGroundedData,
  type ExtractionResult,
  type OpenAiResponsePayload,
  toExtractionResult,
} from './openai-extraction.utils';
import { normalizeUrl } from './product-discovery.utils';

const REQUEST_TIMEOUT_MS = 15000;
const PHOTO_REQUEST_TIMEOUT_MS = 45000;
const WEB_SEARCH_REQUEST_TIMEOUT_MS = 20000;
const OFFICIAL_DISCOVERY_REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_MODEL = 'gpt-5.4';

@Injectable()
export class OpenAiExtractorProvider {
  private readonly logger = new Logger(OpenAiExtractorProvider.name);
  private readonly officialDiscoveryCache = new Map<
    string,
    Promise<string[]>
  >();

  constructor(private readonly configService: ConfigService) {}

  async extract(
    extraction: OfficialPageExtraction,
  ): Promise<ExtractionResult | null> {
    const prompt = this.buildPrompt(extraction);
    return this.runRequest(prompt, {
      useWebSearch: false,
      timeoutMs: REQUEST_TIMEOUT_MS,
      failureLabel: 'OpenAI extraction',
    });
  }

  async extractFromImages(input: {
    images: Array<{
      buffer: Buffer;
      mimetype: string;
    }>;
    heroImageIndex: number;
  }): Promise<ExtractionResult | null> {
    const imageContent = input.images.flatMap((image, index) => {
      const imageNumber = index + 1;
      const imageLabel =
        index === input.heroImageIndex
          ? `Image ${imageNumber} is the selected product photo to save with the item.`
          : `Image ${imageNumber} is an additional label photo of the same product. It may overlap with other label photos.`;

      return [
        {
          type: 'input_text' as const,
          text: imageLabel,
        },
        {
          type: 'input_image' as const,
          image_url: this.toDataUrl(image.buffer, image.mimetype),
        },
      ];
    });

    return this.runRequest(
      [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: this.buildPhotoPrompt(input.images.length),
            },
            ...imageContent,
          ],
        },
      ],
      {
        useWebSearch: false,
        timeoutMs: PHOTO_REQUEST_TIMEOUT_MS,
        failureLabel: 'OpenAI photo extraction',
        maxOutputTokens: 900,
      },
    );
  }

  async completeMissingFields(
    draft: ResolvedProductDraft,
  ): Promise<ExtractionResult | null> {
    const prompt = this.buildDiscoveryPrompt(draft);
    return this.runRequest(prompt, {
      useWebSearch: true,
      timeoutMs: WEB_SEARCH_REQUEST_TIMEOUT_MS,
      failureLabel: 'OpenAI product discovery',
      maxOutputTokens: 900,
    });
  }

  async discoverOfficialProductUrls(input: {
    query: string;
    brand?: string;
    name?: string;
    barcode?: string;
  }): Promise<string[]> {
    const normalizedQuery = input.query.trim();
    if (!normalizedQuery) {
      return [];
    }

    const cacheKey = JSON.stringify({
      query: normalizedQuery.toLowerCase(),
      brand: input.brand?.trim().toLowerCase() ?? null,
      name: input.name?.trim().toLowerCase() ?? null,
      barcode: input.barcode?.trim() ?? null,
    });
    const cached = this.officialDiscoveryCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const pending = this.runOfficialDiscoveryRequest({
      query: normalizedQuery,
      brand: input.brand?.trim() || undefined,
      name: input.name?.trim() || undefined,
      barcode: input.barcode?.trim() || undefined,
    });
    this.officialDiscoveryCache.set(cacheKey, pending);
    return pending;
  }

  private async runRequest(
    input: unknown,
    options: {
      useWebSearch: boolean;
      timeoutMs: number;
      failureLabel: string;
      maxOutputTokens?: number;
    },
  ): Promise<ExtractionResult | null> {
    const response = await this.requestOutputText(input, options);
    if (!response) {
      return null;
    }

    try {
      const parsed = JSON.parse(
        extractJsonObject(response.outputText),
      ) as ExtractedGroundedData;

      return toExtractionResult(parsed, response.payload);
    } catch (error) {
      this.logger.warn(
        `${options.failureLabel} failed: ${
          error instanceof Error ? error.message : 'Invalid JSON output'
        }`,
      );
      return null;
    }
  }

  private async requestOutputText(
    input: unknown,
    options: {
      useWebSearch: boolean;
      timeoutMs: number;
      failureLabel: string;
      maxOutputTokens?: number;
    },
  ): Promise<{ outputText: string; payload: OpenAiResponsePayload } | null> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      return null;
    }

    const configuredModel = this.configService
      .get<string>('OPENAI_PRODUCT_DISCOVERY_MODEL')
      ?.trim();
    const model =
      !configuredModel || configuredModel === 'gpt-5'
        ? DEFAULT_MODEL
        : configuredModel;

    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          ...(options.useWebSearch
            ? {
                tools: [{ type: 'web_search' }],
                tool_choice: 'auto',
              }
            : {}),
          input,
          max_output_tokens: options.maxOutputTokens ?? 1200,
          reasoning: { effort: 'low' },
          text: { verbosity: 'low' },
        }),
        signal: AbortSignal.timeout(options.timeoutMs),
      });

      if (!response.ok) {
        this.logger.warn(
          `${options.failureLabel} failed with status ${response.status}`,
        );
        return null;
      }

      const payload = (await response.json()) as OpenAiResponsePayload;
      const outputText = extractOutputText(payload);
      return outputText ? { outputText, payload } : null;
    } catch (error) {
      this.logger.warn(
        `${options.failureLabel} failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      return null;
    }
  }

  private async runOfficialDiscoveryRequest(input: {
    query: string;
    brand?: string;
    name?: string;
    barcode?: string;
  }): Promise<string[]> {
    const response = await this.requestOutputText(
      this.buildOfficialDiscoveryPrompt(input),
      {
        useWebSearch: true,
        timeoutMs: OFFICIAL_DISCOVERY_REQUEST_TIMEOUT_MS,
        failureLabel: 'OpenAI official product discovery',
        maxOutputTokens: 1200,
      },
    );
    if (!response) {
      return [];
    }

    const rawUrls = this.extractOfficialDiscoveryUrls(response.outputText);
    return Array.from(
      new Set(
        rawUrls
          .filter((url) => isSafeExternalHttpUrl(url))
          .map((url) => normalizeUrl(url)),
      ),
    ).slice(0, 3);
  }

  private extractOfficialDiscoveryUrls(outputText: string): string[] {
    try {
      const parsed = JSON.parse(extractJsonObject(outputText)) as {
        productUrls?: string[];
      };

      if (Array.isArray(parsed.productUrls)) {
        return parsed.productUrls.filter(
          (value): value is string => typeof value === 'string',
        );
      }
    } catch (error) {
      void error;
    }

    return Array.from(
      outputText.matchAll(/https?:\/\/[^\s"'`<>()]+/gi),
      (match) => match[0],
    );
  }

  private buildPrompt(extraction: OfficialPageExtraction): string {
    return [
      'You normalize skincare product data into JSON for a cosmetics inventory app.',
      'Only use facts explicitly present in the provided structured data, meta tags, or text excerpt.',
      'Treat the provided page content as the only source of truth.',
      'Every returned field must be cleaned so it contains only product-specific data for the exact item.',
      'Exclude navigation, cookie banners, legal text, store locators, retailer lists, related products, footer links, and page chrome from every field.',
      'Do not infer unsupported facts. Do not guess parent company, support email, or country information.',
      'Descriptions must be factual, one sentence, concise, and based only on the actual product description.',
      'Benefits and suited-for values must be short phrases for this exact product, not general brand copy or related items.',
      'Guidance and cautions must be brief direct phrases copied or tightly paraphrased from the page.',
      'For identity.inciIngredients, extract the complete ingredient list only.',
      'If the page shows hero ingredients plus a longer full INCI list, return only the full INCI list.',
      'Exclude claims, directions, warnings, headings, sizes, retailer names, links, and legal text from identity.inciIngredients.',
      'Return each ingredient as its own array item in source order and keep the list complete through the last ingredient shown.',
      'Return JSON only with this shape:',
      JSON.stringify(
        {
          identity: {
            brand: 'string|null',
            name: 'string|null',
            category: Object.values(ProductCategory),
            description: 'string|null',
            benefits: ['string'],
            suitedFor: ['string'],
            inciIngredients: ['string'],
          },
          guidance: {
            steps: ['string'],
            cautions: ['string'],
            waitMinutes: 'number|null',
          },
          manufacturer: {
            supportEmail: 'string|null',
            countryOfOrigin: 'string|null',
            countryOfManufacture: 'string|null',
            parentCompany: 'string|null',
            productUrl: 'string|null',
            websiteUrl: 'string|null',
          },
        },
        null,
        2,
      ),
      'Use empty arrays or null when absent.',
      'Formatting rules:',
      '- description: maximum 20 words',
      '- benefits: 1 to 4 short phrases, maximum 4 words each',
      '- suitedFor: 1 to 4 short phrases, maximum 4 words each',
      '- steps and cautions: short imperative phrases, maximum 10 words each',
      'Context:',
      JSON.stringify(
        {
          structured: extraction.rawSource,
          textExcerpt: extraction.textExcerpt,
        },
        null,
        2,
      ),
    ].join('\n');
  }

  private buildPhotoPrompt(imageCount: number): string {
    return [
      `You extract skincare product facts from ${imageCount} user-provided photos of the same product into JSON for a cosmetics inventory app.`,
      'One image is the selected product photo that will be saved with the item.',
      'The remaining images are label photos and may be overlapping captures from curved, cylindrical, spherical, or wrapped packaging.',
      'Use only what is visible in the provided photos. Do not use outside knowledge or web search.',
      'If the photos show multiple products, conflicting products, unreadable text, or do not clearly match, return empty arrays and null values for any ambiguous field instead of guessing.',
      'Use the selected product photo as the primary source for brand, product name, variant, category, size, and front-label claims.',
      'Use all photos together to reconstruct the complete INCI ingredient list, description, benefits, suited-for text, and usage/caution text.',
      'Combine overlapping label text across the full image set, dedupe repeated fragments, and preserve ingredient order when the packaging supports it.',
      'If the full ingredient list is not visible across the photo set, return an empty ingredients array instead of a partial or guessed list.',
      'Clean every field so it contains only product-specific data for the exact item shown.',
      'Exclude stickers, prices, retailer overlays, navigation-like text, icons without text meaning, legal footers, distributor blocks, barcode numbers, lot codes, website chrome, and unrelated packaging copy.',
      'For identity.inciIngredients, extract the complete ingredient list only.',
      'If the packaging shows hero ingredients plus a longer full INCI list, return only the full INCI list in source order.',
      'Never return claims, headings, directions, warnings, sizes, store names, or legal text in identity.inciIngredients.',
      'Descriptions must be factual, one sentence, concise, and based only on the product text visible in the photos.',
      'Benefits and suited-for values must be short phrases for this exact product, not marketing slogans or inferred effects.',
      'Guidance steps and cautions must be brief direct phrases copied or tightly paraphrased from the packaging.',
      'Manufacturer fields should stay null unless they are explicitly printed on the packaging.',
      'Return JSON only with this shape:',
      JSON.stringify(
        {
          identity: {
            brand: 'string|null',
            name: 'string|null',
            category: Object.values(ProductCategory),
            sizeMl: 'number|null',
            description: 'string|null',
            benefits: ['string'],
            suitedFor: ['string'],
            inciIngredients: ['string'],
          },
          guidance: {
            steps: ['string'],
            cautions: ['string'],
            waitMinutes: 'number|null',
          },
          manufacturer: {
            supportEmail: 'string|null',
            countryOfOrigin: 'string|null',
            countryOfManufacture: 'string|null',
            parentCompany: 'string|null',
            productUrl: 'string|null',
            websiteUrl: 'string|null',
          },
        },
        null,
        2,
      ),
      'Use empty arrays or null when a field cannot be supported cleanly.',
      'Formatting rules:',
      '- description: maximum 20 words',
      '- benefits: 1 to 4 short phrases, maximum 4 words each',
      '- suitedFor: 1 to 4 short phrases, maximum 4 words each',
      '- steps and cautions: short imperative phrases, maximum 10 words each',
    ].join('\n');
  }

  private buildDiscoveryPrompt(draft: ResolvedProductDraft): string {
    const missingFields = this.listMissingFields(draft);

    return [
      'You help a skincare inventory app complete missing product details.',
      'Use web search to find the official manufacturer product page first.',
      'If needed, also use the official support/contact page and official company/about page for parent company or support details.',
      'Only fill fields that are currently missing or empty.',
      'Known product data is authoritative. Never rewrite or replace a non-empty known field.',
      'Prefer official brand/manufacturer pages for productUrl, supportEmail, benefits, suitedFor, cautions, parentCompany, and manufacturing details.',
      'Use community sources like Open Beauty Facts only to support barcode, brand, name, size, image, ingredients, or generic description when official pages do not provide them.',
      'Clean every returned field by excluding navigation, cookie banners, legal text, retailer blocks, related products, and footer content.',
      'Do not invent skincare instructions, cautions, support emails, countries, or parent companies.',
      'For identity.inciIngredients, only return the complete INCI ingredient list as raw ingredient names in separate array items.',
      'If a source shows hero ingredients and a longer full INCI list, return only the full INCI list in source order.',
      'Never return sentences, summaries, navigation text, policies, usage directions, claims, store lists, or marketing copy in identity.inciIngredients.',
      'If a clean ingredient list cannot be verified, return an empty array for identity.inciIngredients.',
      'Descriptions must be factual, one sentence, concise, and based only on the actual product description.',
      `Missing fields to complete: ${missingFields.join(', ') || 'none'}.`,
      'Return JSON only with this shape:',
      JSON.stringify(
        {
          identity: {
            brand: 'string|null',
            name: 'string|null',
            category: Object.values(ProductCategory),
            description: 'string|null',
            benefits: ['string'],
            suitedFor: ['string'],
            inciIngredients: ['string'],
          },
          guidance: {
            steps: ['string'],
            cautions: ['string'],
            waitMinutes: 'number|null',
          },
          manufacturer: {
            supportEmail: 'string|null',
            countryOfOrigin: 'string|null',
            countryOfManufacture: 'string|null',
            parentCompany: 'string|null',
            productUrl: 'string|null',
            websiteUrl: 'string|null',
          },
        },
        null,
        2,
      ),
      'Use empty arrays or null when a field cannot be supported.',
      'Formatting rules:',
      '- description: maximum 20 words',
      '- benefits: 1 to 4 short phrases, maximum 4 words each',
      '- suitedFor: 1 to 4 short phrases, maximum 4 words each',
      '- steps and cautions: short imperative phrases, maximum 10 words each',
      'Known product data:',
      JSON.stringify(
        {
          brand: draft.identity.brand ?? null,
          name: draft.identity.name ?? null,
          barcode: draft.identity.barcode ?? null,
          category: draft.identity.category ?? null,
          description: draft.identity.description ?? null,
          benefits: draft.identity.benefits ?? [],
          suitedFor: draft.identity.suitedFor ?? [],
          ingredients: draft.identity.inciIngredients ?? [],
          cautions: draft.guidance.cautions ?? [],
          steps: draft.guidance.steps ?? [],
          productUrl: draft.manufacturer.productUrl ?? null,
          supportEmail: draft.manufacturer.supportEmail ?? null,
          parentCompany: draft.manufacturer.parentCompany ?? null,
          countryOfManufacture: draft.manufacturer.countryOfManufacture ?? null,
          rawSource: draft.rawSource,
        },
        null,
        2,
      ),
    ].join('\n');
  }

  private buildOfficialDiscoveryPrompt(input: {
    query: string;
    brand?: string;
    name?: string;
    barcode?: string;
  }): string {
    return [
      'You help a skincare inventory app find official manufacturer product pages.',
      'Use web search to find the brand or manufacturer official product page for the exact product.',
      'Only return URLs on the official brand or manufacturer site.',
      'Never return retailers, marketplaces, distributors, databases, review sites, blogs, or social media.',
      'Return up to 3 candidate product page URLs.',
      'Return JSON only with this shape:',
      JSON.stringify(
        {
          productUrls: ['https://official-brand-site.com/product-page'],
        },
        null,
        2,
      ),
      'Use an empty array if no official product page can be found confidently.',
      'Known clues:',
      JSON.stringify(
        {
          query: input.query,
          brand: input.brand ?? null,
          name: input.name ?? null,
          barcode: input.barcode ?? null,
        },
        null,
        2,
      ),
    ].join('\n');
  }

  private toDataUrl(buffer: Buffer, mimeType: string): string {
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  }

  private listMissingFields(draft: ResolvedProductDraft): string[] {
    const missingFields: string[] = [];

    if (!draft.identity.brand) missingFields.push('identity.brand');
    if (!draft.identity.name) missingFields.push('identity.name');
    if (!draft.identity.description) missingFields.push('identity.description');
    if (!draft.identity.benefits?.length) {
      missingFields.push('identity.benefits');
    }
    if (!draft.identity.suitedFor?.length) {
      missingFields.push('identity.suitedFor');
    }
    if (!draft.identity.inciIngredients?.length) {
      missingFields.push('identity.inciIngredients');
    }
    if (!draft.guidance.steps?.length) missingFields.push('guidance.steps');
    if (!draft.guidance.cautions?.length) {
      missingFields.push('guidance.cautions');
    }
    if (draft.guidance.waitMinutes === undefined) {
      missingFields.push('guidance.waitMinutes');
    }
    if (!draft.manufacturer.supportEmail) {
      missingFields.push('manufacturer.supportEmail');
    }
    if (!draft.manufacturer.countryOfOrigin) {
      missingFields.push('manufacturer.countryOfOrigin');
    }
    if (!draft.manufacturer.countryOfManufacture) {
      missingFields.push('manufacturer.countryOfManufacture');
    }
    if (!draft.manufacturer.parentCompany) {
      missingFields.push('manufacturer.parentCompany');
    }
    if (!draft.manufacturer.productUrl) {
      missingFields.push('manufacturer.productUrl');
    }
    if (!draft.manufacturer.websiteUrl) {
      missingFields.push('manufacturer.websiteUrl');
    }

    return missingFields;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isSafeExternalHttpUrl } from '../common/utils/url-security';
import { hashBuffer, hashStableValue } from './catalogue-cache-key.utils';
import { TimedMemoryCache } from './catalogue-memory-cache';
import type { CataloguePhotoExtractionInput } from './catalogue-photo.types';
import {
  extractJsonObject,
  extractOutputText,
  type ExtractedGroundedData,
  type ExtractionResult,
  type OpenAiResponsePayload,
  toExtractionResult,
} from './openai-extraction.utils';
import {
  buildDiscoveryPrompt,
  buildOfficialDiscoveryPrompt,
  buildOfficialPageExtractionPrompt,
  buildPhotoExtractionPrompt,
  describePhotoVariant,
} from './openai-product-prompts';
import {
  OPENAI_OFFICIAL_DISCOVERY_FORMAT,
  OPENAI_PRODUCT_EXTRACTION_FORMAT,
  type OpenAiTextFormat,
} from './openai-response-schemas';
import type {
  OfficialPageExtraction,
  ResolvedProductDraft,
} from './product-discovery.types';
import { normalizeUrl } from './product-discovery.utils';

const REQUEST_TIMEOUT_MS = 15000;
const PHOTO_REQUEST_TIMEOUT_MS = 45000;
const WEB_SEARCH_REQUEST_TIMEOUT_MS = 20000;
const OFFICIAL_DISCOVERY_REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_MODEL = 'gpt-5.4';
const OPENAI_CACHE_TTL_MS = 30 * 60 * 1000;
const OPENAI_CACHE_MAX_ENTRIES = 100;
const OFFICIAL_DISCOVERY_CACHE_TTL_MS = 60 * 60 * 1000;

function createExtractionCache() {
  return new TimedMemoryCache<ExtractionResult | null>({
    ttlMs: OPENAI_CACHE_TTL_MS,
    maxEntries: OPENAI_CACHE_MAX_ENTRIES,
    shouldCacheValue: (value) => Boolean(value),
  });
}

@Injectable()
export class OpenAiExtractorProvider {
  private readonly logger = new Logger(OpenAiExtractorProvider.name);
  private readonly officialPageExtractionCache = createExtractionCache();
  private readonly photoExtractionCache = createExtractionCache();
  private readonly discoveryCompletionCache = createExtractionCache();
  private readonly officialDiscoveryCache = new TimedMemoryCache<string[]>({
    ttlMs: OFFICIAL_DISCOVERY_CACHE_TTL_MS,
    maxEntries: OPENAI_CACHE_MAX_ENTRIES,
    shouldCacheValue: (value) => value.length > 0,
  });

  constructor(private readonly configService: ConfigService) {}

  async extract(
    extraction: OfficialPageExtraction,
  ): Promise<ExtractionResult | null> {
    const prompt = buildOfficialPageExtractionPrompt(extraction);
    const cacheKey = this.toTextRequestCacheKey(
      'openai-official-page-extraction:v1',
      prompt,
      OPENAI_PRODUCT_EXTRACTION_FORMAT,
      false,
    );

    return this.officialPageExtractionCache.getOrCreate(cacheKey, () =>
      this.runRequest(prompt, {
        useWebSearch: false,
        timeoutMs: REQUEST_TIMEOUT_MS,
        failureLabel: 'OpenAI extraction',
        responseFormat: OPENAI_PRODUCT_EXTRACTION_FORMAT,
      }),
    );
  }

  async extractFromImages(
    input: CataloguePhotoExtractionInput,
  ): Promise<ExtractionResult | null> {
    const cacheKey = this.toPhotoRequestCacheKey(input);
    return this.photoExtractionCache.getOrCreate(cacheKey, () =>
      this.runRequest(
        [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: buildPhotoExtractionPrompt(
                  input.sourceImageCount ?? input.images.length,
                  input.images.length,
                ),
              },
              ...this.toImageContent(input),
            ],
          },
        ],
        {
          useWebSearch: false,
          timeoutMs: PHOTO_REQUEST_TIMEOUT_MS,
          failureLabel: 'OpenAI photo extraction',
          maxOutputTokens: 1400,
          responseFormat: OPENAI_PRODUCT_EXTRACTION_FORMAT,
        },
      ),
    );
  }

  async completeMissingFields(
    draft: ResolvedProductDraft,
  ): Promise<ExtractionResult | null> {
    const prompt = buildDiscoveryPrompt(draft);
    const cacheKey = this.toTextRequestCacheKey(
      'openai-product-discovery:v1',
      prompt,
      OPENAI_PRODUCT_EXTRACTION_FORMAT,
      true,
    );

    return this.discoveryCompletionCache.getOrCreate(cacheKey, () =>
      this.runRequest(prompt, {
        useWebSearch: true,
        timeoutMs: WEB_SEARCH_REQUEST_TIMEOUT_MS,
        failureLabel: 'OpenAI product discovery',
        maxOutputTokens: 900,
        responseFormat: OPENAI_PRODUCT_EXTRACTION_FORMAT,
      }),
    );
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
    return this.officialDiscoveryCache.getOrCreate(cacheKey, () =>
      this.runOfficialDiscoveryRequest({
        query: normalizedQuery,
        brand: input.brand?.trim() || undefined,
        name: input.name?.trim() || undefined,
        barcode: input.barcode?.trim() || undefined,
      }),
    );
  }

  private toImageContent(input: CataloguePhotoExtractionInput) {
    return input.images.flatMap((image, index) => {
      const imageNumber = index + 1;
      const sourceIndex = image.sourceIndex ?? index;
      const sourceNumber = sourceIndex + 1;
      const isHero =
        image.isHero ??
        (image.sourceIndex !== undefined
          ? image.sourceIndex === input.heroImageIndex
          : index === input.heroImageIndex);
      const dimensions =
        image.width && image.height ? ` ${image.width}x${image.height}` : '';
      const imageLabel = [
        `Image ${imageNumber} is a ${describePhotoVariant(image.variant)}${dimensions} derived from source photo ${sourceNumber}.`,
        isHero
          ? 'That source photo is the selected product photo to save with the item.'
          : 'That source photo is an additional label photo of the same product and may overlap with other label photos.',
        image.variant === 'text-enhanced'
          ? 'Use this variant especially for small, low-contrast, blurred, or curved label text.'
          : 'Use this variant for overall packaging layout, brand, product name, size, and context.',
      ].join(' ');

      return [
        {
          type: 'input_text' as const,
          text: imageLabel,
        },
        {
          type: 'input_image' as const,
          image_url: this.toDataUrl(image.buffer, image.mimetype),
          detail: 'high' as const,
        },
      ];
    });
  }

  private async runRequest(
    input: unknown,
    options: {
      useWebSearch: boolean;
      timeoutMs: number;
      failureLabel: string;
      maxOutputTokens?: number;
      responseFormat: OpenAiTextFormat;
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
      responseFormat: OpenAiTextFormat;
    },
  ): Promise<{ outputText: string; payload: OpenAiResponsePayload } | null> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      return null;
    }

    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.getModel(),
          ...(options.useWebSearch
            ? { tools: [{ type: 'web_search' }], tool_choice: 'auto' }
            : {}),
          input,
          max_output_tokens: options.maxOutputTokens ?? 1200,
          reasoning: { effort: 'low' },
          text: {
            verbosity: 'low',
            format: options.responseFormat,
          },
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

  private getModel(): string {
    const configuredModel = this.configService
      .get<string>('OPENAI_PRODUCT_DISCOVERY_MODEL')
      ?.trim();

    return !configuredModel || configuredModel === 'gpt-5'
      ? DEFAULT_MODEL
      : configuredModel;
  }

  private toTextRequestCacheKey(
    scope: string,
    prompt: string,
    responseFormat: OpenAiTextFormat,
    useWebSearch: boolean,
  ): string {
    return hashStableValue(scope, {
      model: this.getModel(),
      prompt,
      responseFormat: responseFormat.name,
      useWebSearch,
    });
  }

  private toPhotoRequestCacheKey(input: CataloguePhotoExtractionInput): string {
    return hashStableValue('openai-photo-extraction:v1', {
      model: this.getModel(),
      responseFormat: OPENAI_PRODUCT_EXTRACTION_FORMAT.name,
      heroImageIndex: input.heroImageIndex,
      sourceImageCount: input.sourceImageCount ?? input.images.length,
      images: input.images.map((image) => ({
        bufferHash: hashBuffer(image.buffer),
        height: image.height ?? null,
        isHero: image.isHero ?? null,
        mimetype: image.mimetype,
        sourceIndex: image.sourceIndex ?? null,
        variant: image.variant ?? null,
        width: image.width ?? null,
      })),
    });
  }

  private async runOfficialDiscoveryRequest(input: {
    query: string;
    brand?: string;
    name?: string;
    barcode?: string;
  }): Promise<string[]> {
    const response = await this.requestOutputText(
      buildOfficialDiscoveryPrompt(input),
      {
        useWebSearch: true,
        timeoutMs: OFFICIAL_DISCOVERY_REQUEST_TIMEOUT_MS,
        failureLabel: 'OpenAI official product discovery',
        maxOutputTokens: 1200,
        responseFormat: OPENAI_OFFICIAL_DISCOVERY_FORMAT,
      },
    );
    if (!response) {
      return [];
    }

    return Array.from(
      new Set(
        this.extractOfficialDiscoveryUrls(response.outputText)
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

  private toDataUrl(buffer: Buffer, mimeType: string): string {
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CATALOGUE_AI_MODEL_ENV_KEY,
  readFeatureOpenAiModel,
} from '../common/utils/openai-config';
import {
  OPENAI_REASONING_EFFORT,
  openAiRepeatabilityRequestOptions,
} from '../common/utils/openai-request-options';
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
} from './openai-product-prompts';
import { extractOfficialDiscoveryUrls } from './openai-official-discovery.utils';
import {
  createOpenAiExtractionCache,
  formatOpenAiFailure,
  formatOpenAiTimeout,
  isOpenAiTimeoutError,
  OPENAI_CACHE_MAX_ENTRIES,
} from './openai-provider-runtime';
import { toPhotoImageContent } from './openai-photo-content.utils';
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
const DEFAULT_MODEL = 'gpt-5.2';
const OFFICIAL_DISCOVERY_CACHE_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class OpenAiExtractorProvider {
  private readonly logger = new Logger(OpenAiExtractorProvider.name);
  private readonly officialPageExtractionCache = createOpenAiExtractionCache();
  private readonly photoExtractionCache = createOpenAiExtractionCache();
  private readonly discoveryCompletionCache = createOpenAiExtractionCache();
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
    const model = this.getModel();
    const cacheKey = this.toTextRequestCacheKey(
      'openai-official-page-extraction:v1',
      prompt,
      OPENAI_PRODUCT_EXTRACTION_FORMAT,
      false,
      model,
    );

    return this.officialPageExtractionCache.getOrCreate(cacheKey, () =>
      this.runRequest(prompt, {
        useWebSearch: false,
        timeoutMs: REQUEST_TIMEOUT_MS,
        failureLabel: 'Optional OpenAI official page normalization',
        optionalFallbackMessage: 'continuing with page parser result',
        model,
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
              ...toPhotoImageContent(input),
            ],
          },
        ],
        {
          useWebSearch: false,
          timeoutMs: PHOTO_REQUEST_TIMEOUT_MS,
          failureLabel: 'OpenAI photo extraction',
          model: this.getModel(),
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
    const model = this.getModel();
    const cacheKey = this.toTextRequestCacheKey(
      'openai-product-discovery:v1',
      prompt,
      OPENAI_PRODUCT_EXTRACTION_FORMAT,
      true,
      model,
    );

    return this.discoveryCompletionCache.getOrCreate(cacheKey, () =>
      this.runRequest(prompt, {
        useWebSearch: true,
        timeoutMs: WEB_SEARCH_REQUEST_TIMEOUT_MS,
        failureLabel: 'Optional OpenAI product discovery enrichment',
        optionalFallbackMessage: 'continuing with photo extraction result',
        model,
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

  private async runRequest(
    input: unknown,
    options: {
      useWebSearch: boolean;
      timeoutMs: number;
      failureLabel: string;
      optionalFallbackMessage?: string;
      model?: string;
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
        formatOpenAiFailure(
          options,
          error instanceof Error ? error.message : 'Invalid JSON output',
        ),
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
      optionalFallbackMessage?: string;
      model?: string;
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
          model: options.model ?? this.getModel(),
          store: false,
          ...(options.useWebSearch
            ? { tools: [{ type: 'web_search' }], tool_choice: 'auto' }
            : {}),
          input,
          max_output_tokens: options.maxOutputTokens ?? 1200,
          ...openAiRepeatabilityRequestOptions(
            options.model ?? this.getModel(),
          ),
          text: {
            verbosity: 'low',
            format: options.responseFormat,
          },
        }),
        signal: AbortSignal.timeout(options.timeoutMs),
      });

      if (!response.ok) {
        this.logger.warn(
          formatOpenAiFailure(options, `status ${response.status}`),
        );
        return null;
      }

      const payload = (await response.json()) as OpenAiResponsePayload;
      const outputText = extractOutputText(payload);
      return outputText ? { outputText, payload } : null;
    } catch (error) {
      if (isOpenAiTimeoutError(error)) {
        this.logger.warn(formatOpenAiTimeout(options));
      } else {
        this.logger.warn(
          formatOpenAiFailure(
            options,
            error instanceof Error ? error.message : 'Unknown error',
          ),
        );
      }
      return null;
    }
  }

  private getModel(): string {
    return (
      readFeatureOpenAiModel(
        this.configService,
        CATALOGUE_AI_MODEL_ENV_KEY,
        DEFAULT_MODEL,
      ) ?? DEFAULT_MODEL
    );
  }

  private toTextRequestCacheKey(
    scope: string,
    prompt: string,
    responseFormat: OpenAiTextFormat,
    useWebSearch: boolean,
    model = this.getModel(),
  ): string {
    return hashStableValue(scope, {
      model,
      prompt,
      reasoningEffort: OPENAI_REASONING_EFFORT,
      responseFormat: responseFormat.name,
      useWebSearch,
    });
  }

  private toPhotoRequestCacheKey(input: CataloguePhotoExtractionInput): string {
    return hashStableValue('openai-photo-extraction:v1', {
      model: this.getModel(),
      reasoningEffort: OPENAI_REASONING_EFFORT,
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
        failureLabel: 'Optional OpenAI official product URL discovery',
        optionalFallbackMessage: 'continuing without official URL candidates',
        model: this.getModel(),
        maxOutputTokens: 1200,
        responseFormat: OPENAI_OFFICIAL_DISCOVERY_FORMAT,
      },
    );
    if (!response) {
      return [];
    }

    return Array.from(
      new Set(
        extractOfficialDiscoveryUrls(response.outputText)
          .filter((url) => isSafeExternalHttpUrl(url))
          .map((url) => normalizeUrl(url)),
      ),
    ).slice(0, 3);
  }
}

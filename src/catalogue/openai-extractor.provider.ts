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
export const OPENAI_PRODUCT_EXTRACTION_MAX_OUTPUT_TOKENS = 6_000;
export const OPENAI_PRODUCT_DISCOVERY_MAX_OUTPUT_TOKENS = 4_000;
export const OPENAI_OFFICIAL_DISCOVERY_MAX_OUTPUT_TOKENS = 2_000;
export const OPENAI_EXTRACTION_STRUCTURED_OUTPUT_ATTEMPTS = 2;
const DEFAULT_MODEL = 'gpt-5.2';
const OFFICIAL_DISCOVERY_CACHE_TTL_MS = 60 * 60 * 1000;

type OpenAiRawResponseResult =
  | {
      ok: true;
      outputText: string | null;
      payload: OpenAiResponsePayload;
    }
  | {
      ok: false;
      reason: string;
      retryable: boolean;
      timedOut: boolean;
    };

function isRetryableOpenAiStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

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
          maxOutputTokens: OPENAI_PRODUCT_EXTRACTION_MAX_OUTPUT_TOKENS,
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
        maxOutputTokens: OPENAI_PRODUCT_DISCOVERY_MAX_OUTPUT_TOKENS,
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
    for (
      let attempt = 1;
      attempt <= OPENAI_EXTRACTION_STRUCTURED_OUTPUT_ATTEMPTS;
      attempt += 1
    ) {
      const response = await this.requestOutputTextOnce(input, options);
      if (!response.ok) {
        if (
          attempt < OPENAI_EXTRACTION_STRUCTURED_OUTPUT_ATTEMPTS &&
          response.retryable
        ) {
          continue;
        }
        this.logRequestFailure(options, response);
        return null;
      }

      if (!response.outputText) {
        if (attempt < OPENAI_EXTRACTION_STRUCTURED_OUTPUT_ATTEMPTS) {
          continue;
        }
        this.logger.warn(formatOpenAiFailure(options, 'empty output'));
        return null;
      }

      try {
        const parsed = JSON.parse(
          extractJsonObject(response.outputText),
        ) as ExtractedGroundedData;

        return toExtractionResult(parsed, response.payload);
      } catch (error) {
        if (attempt < OPENAI_EXTRACTION_STRUCTURED_OUTPUT_ATTEMPTS) {
          continue;
        }
        this.logger.warn(
          formatOpenAiFailure(
            options,
            error instanceof Error ? error.message : 'Invalid JSON output',
          ),
        );
        return null;
      }
    }

    return null;
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
    for (
      let attempt = 1;
      attempt <= OPENAI_EXTRACTION_STRUCTURED_OUTPUT_ATTEMPTS;
      attempt += 1
    ) {
      const response = await this.requestOutputTextOnce(input, options);
      if (!response.ok) {
        if (
          attempt < OPENAI_EXTRACTION_STRUCTURED_OUTPUT_ATTEMPTS &&
          response.retryable
        ) {
          continue;
        }
        this.logRequestFailure(options, response);
        return null;
      }

      if (response.outputText) {
        return { outputText: response.outputText, payload: response.payload };
      }

      if (attempt === OPENAI_EXTRACTION_STRUCTURED_OUTPUT_ATTEMPTS) {
        this.logger.warn(formatOpenAiFailure(options, 'empty output'));
      }
    }

    return null;
  }

  private async requestOutputTextOnce(
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
  ): Promise<OpenAiRawResponseResult> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      return {
        ok: false,
        reason: 'missing OpenAI API key',
        retryable: false,
        timedOut: false,
      };
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
          max_output_tokens:
            options.maxOutputTokens ??
            OPENAI_PRODUCT_EXTRACTION_MAX_OUTPUT_TOKENS,
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
        return {
          ok: false,
          reason: `status ${response.status}`,
          retryable: isRetryableOpenAiStatus(response.status),
          timedOut: false,
        };
      }

      const payload = (await response.json()) as OpenAiResponsePayload;
      const outputText = extractOutputText(payload);
      return { ok: true, outputText, payload };
    } catch (error) {
      const timedOut = isOpenAiTimeoutError(error);
      return {
        ok: false,
        reason: error instanceof Error ? error.message : 'Unknown error',
        retryable: !timedOut,
        timedOut,
      };
    }
  }

  private logRequestFailure(
    options: {
      timeoutMs: number;
      failureLabel: string;
      optionalFallbackMessage?: string;
    },
    failure: Extract<OpenAiRawResponseResult, { ok: false }>,
  ): void {
    if (failure.timedOut) {
      this.logger.warn(formatOpenAiTimeout(options));
      return;
    }

    this.logger.warn(formatOpenAiFailure(options, failure.reason));
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
        maxOutputTokens: OPENAI_OFFICIAL_DISCOVERY_MAX_OUTPUT_TOKENS,
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

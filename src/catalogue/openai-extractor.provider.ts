import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isSafeExternalHttpUrl } from '../common/utils/url-security';
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
    return this.runRequest(buildOfficialPageExtractionPrompt(extraction), {
      useWebSearch: false,
      timeoutMs: REQUEST_TIMEOUT_MS,
      failureLabel: 'OpenAI extraction',
      responseFormat: OPENAI_PRODUCT_EXTRACTION_FORMAT,
    });
  }

  async extractFromImages(
    input: CataloguePhotoExtractionInput,
  ): Promise<ExtractionResult | null> {
    return this.runRequest(
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
    );
  }

  async completeMissingFields(
    draft: ResolvedProductDraft,
  ): Promise<ExtractionResult | null> {
    return this.runRequest(buildDiscoveryPrompt(draft), {
      useWebSearch: true,
      timeoutMs: WEB_SEARCH_REQUEST_TIMEOUT_MS,
      failureLabel: 'OpenAI product discovery',
      maxOutputTokens: 900,
      responseFormat: OPENAI_PRODUCT_EXTRACTION_FORMAT,
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

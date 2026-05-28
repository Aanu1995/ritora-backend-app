import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  extractJsonObject,
  extractOutputText,
  type OpenAiResponsePayload,
} from '../catalogue/openai-extraction.utils';
import {
  OPENAI_MODEL_ENV_KEY,
  PRODUCT_CHECK_AI_MODEL_ENV_KEY,
  readFeatureOpenAiModel,
} from '../common/utils/openai-config';
import { openAiRepeatabilityRequestOptions } from '../common/utils/openai-request-options';
import {
  buildProductCompareAiReviewPayload,
  sanitizeProductCompareAiReview,
  unavailableProductCompareAiReview,
} from './product-compare-ai-review.payload';
import type { ProductCompareAiReviewPort } from './product-compare-ai-review.port';
import { productCompareAiReviewPrompt } from './product-compare-ai-review.prompt';
import {
  PRODUCT_COMPARE_REVIEW_FORMAT,
  type ParsedProductCompareAiReview,
} from './product-compare-ai-review.schema';
import type {
  ProductCompareAiReview,
  ProductCompareAiReviewInput,
} from './product-compare.types';

export const OPENAI_PRODUCT_COMPARE_REVIEW_REQUEST_TIMEOUT_MS = 90_000;
const DEFAULT_MODEL = 'gpt-5-mini';

@Injectable()
export class OpenAiProductCompareReviewProvider implements ProductCompareAiReviewPort {
  private readonly logger = new Logger(OpenAiProductCompareReviewProvider.name);
  private hasWarnedMissingModel = false;

  constructor(private readonly configService: ConfigService) {}

  warnIfMisconfigured(): void {
    const model = this.readModel();
    if (!model) {
      this.logger.warn(
        `${PRODUCT_CHECK_AI_MODEL_ENV_KEY} or ${OPENAI_MODEL_ENV_KEY} is not set. Product Compare AI review will fall back to deterministic comparison.`,
      );
      this.hasWarnedMissingModel = true;
    }
  }

  async review(
    input: ProductCompareAiReviewInput,
  ): Promise<ProductCompareAiReview> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      this.logStructured('warn', {
        event: 'product_compare_ai_review_skipped',
        reason: 'missing_api_key',
      });
      return unavailableProductCompareAiReview();
    }

    const model = this.readModel();
    if (!model) {
      if (!this.hasWarnedMissingModel) {
        this.logStructured('warn', {
          event: 'product_compare_ai_review_skipped',
          reason: 'missing_model_env',
        });
        this.hasWarnedMissingModel = true;
      }
      return unavailableProductCompareAiReview();
    }

    const startedAt = Date.now();
    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          store: false,
          max_output_tokens: 700,
          ...openAiRepeatabilityRequestOptions(model),
          input: [
            {
              role: 'system',
              content: [
                {
                  type: 'input_text',
                  text: productCompareAiReviewPrompt(
                    input.language,
                    input.goal,
                  ),
                },
              ],
            },
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: JSON.stringify(
                    buildProductCompareAiReviewPayload(input),
                  ),
                },
              ],
            },
          ],
          text: {
            verbosity: 'low',
            format: PRODUCT_COMPARE_REVIEW_FORMAT,
          },
        }),
        signal: AbortSignal.timeout(
          OPENAI_PRODUCT_COMPARE_REVIEW_REQUEST_TIMEOUT_MS,
        ),
      });

      const durationMs = Date.now() - startedAt;
      if (!response.ok) {
        this.logStructured('warn', {
          event: 'product_compare_ai_review_failed',
          reason: 'http_error',
          status: response.status,
          model,
          durationMs,
        });
        return unavailableProductCompareAiReview();
      }

      const payload = (await response.json()) as OpenAiResponsePayload;
      const outputText = extractOutputText(payload);
      if (!outputText) {
        this.logStructured('warn', {
          event: 'product_compare_ai_review_failed',
          reason: 'empty_output',
          model,
          durationMs,
        });
        return unavailableProductCompareAiReview();
      }

      const parsed = JSON.parse(
        extractJsonObject(outputText),
      ) as ParsedProductCompareAiReview;
      return sanitizeProductCompareAiReview(parsed, input);
    } catch (error) {
      this.logStructured('warn', {
        event: 'product_compare_ai_review_failed',
        reason: 'exception',
        message: error instanceof Error ? error.message : 'Unknown error',
        model,
        durationMs: Date.now() - startedAt,
      });
      return unavailableProductCompareAiReview();
    }
  }

  private readModel(): string | null {
    return readFeatureOpenAiModel(
      this.configService,
      PRODUCT_CHECK_AI_MODEL_ENV_KEY,
      DEFAULT_MODEL,
    );
  }

  private logStructured(
    level: 'warn' | 'error',
    payload: Record<string, unknown>,
  ): void {
    const message = JSON.stringify(payload);
    if (level === 'error') {
      this.logger.error(message);
    } else {
      this.logger.warn(message);
    }
  }
}

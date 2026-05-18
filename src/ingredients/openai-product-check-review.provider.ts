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
import { AnalysisStatus } from './ingredients.types';
import {
  buildProductCheckAiReviewPayload,
  sanitizeProductCheckAiReview,
  unavailableProductCheckAiReview,
} from './product-check-ai-review.payload';
import type {
  ProductCheckAiReviewInput,
  ProductCheckAiReviewPort,
} from './product-check-ai-review.port';
import { productCheckAiReviewPrompt } from './product-check-ai-review.prompt';
import {
  PRODUCT_CHECK_REVIEW_FORMAT,
  type ParsedProductCheckAiReview,
} from './product-check-ai-review.schema';
import type { ProductCheckAiReview } from './product-check.types';

export const OPENAI_PRODUCT_CHECK_REVIEW_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_MODEL = 'gpt-5-mini';

@Injectable()
export class OpenAiProductCheckReviewProvider implements ProductCheckAiReviewPort {
  private readonly logger = new Logger(OpenAiProductCheckReviewProvider.name);
  private hasWarnedMissingModel = false;

  constructor(private readonly configService: ConfigService) {}

  warnIfMisconfigured(): void {
    const model = this.readModel();
    if (!model) {
      this.logger.warn(
        `${PRODUCT_CHECK_AI_MODEL_ENV_KEY} or ${OPENAI_MODEL_ENV_KEY} is not set. Quick Check AI review will fall back to deterministic verdicts.`,
      );
      this.hasWarnedMissingModel = true;
    }
  }

  async review(
    input: ProductCheckAiReviewInput,
  ): Promise<ProductCheckAiReview> {
    if (input.analysis.status === AnalysisStatus.InsufficientData) {
      return unavailableProductCheckAiReview();
    }

    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      this.logStructured('warn', {
        event: 'product_check_ai_review_skipped',
        reason: 'missing_api_key',
      });
      return unavailableProductCheckAiReview();
    }

    const model = this.readModel();
    if (!model) {
      if (!this.hasWarnedMissingModel) {
        this.logStructured('warn', {
          event: 'product_check_ai_review_skipped',
          reason: 'missing_model_env',
        });
        this.hasWarnedMissingModel = true;
      }
      return unavailableProductCheckAiReview();
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
          reasoning: { effort: 'low' },
          max_output_tokens: 700,
          ...openAiRepeatabilityRequestOptions(model),
          input: [
            {
              role: 'system',
              content: [
                {
                  type: 'input_text',
                  text: productCheckAiReviewPrompt(input.language),
                },
              ],
            },
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: JSON.stringify(buildProductCheckAiReviewPayload(input)),
                },
              ],
            },
          ],
          text: {
            verbosity: 'low',
            format: PRODUCT_CHECK_REVIEW_FORMAT,
          },
        }),
        signal: AbortSignal.timeout(
          OPENAI_PRODUCT_CHECK_REVIEW_REQUEST_TIMEOUT_MS,
        ),
      });

      const durationMs = Date.now() - startedAt;
      if (!response.ok) {
        this.logStructured('warn', {
          event: 'product_check_ai_review_failed',
          reason: 'http_error',
          status: response.status,
          model,
          durationMs,
        });
        return unavailableProductCheckAiReview();
      }

      const payload = (await response.json()) as OpenAiResponsePayload;
      const outputText = extractOutputText(payload);
      if (!outputText) {
        this.logStructured('warn', {
          event: 'product_check_ai_review_failed',
          reason: 'empty_output',
          model,
          durationMs,
        });
        return unavailableProductCheckAiReview();
      }

      const parsed = JSON.parse(
        extractJsonObject(outputText),
      ) as ParsedProductCheckAiReview;
      return sanitizeProductCheckAiReview(parsed, input);
    } catch (error) {
      this.logStructured('warn', {
        event: 'product_check_ai_review_failed',
        reason: 'exception',
        message: error instanceof Error ? error.message : 'Unknown error',
        model,
        durationMs: Date.now() - startedAt,
      });
      return unavailableProductCheckAiReview();
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

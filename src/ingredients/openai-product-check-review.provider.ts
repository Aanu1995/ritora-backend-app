import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { ulid } from 'ulid';
import {
  extractJsonObject,
  type OpenAiResponsePayload,
} from '../catalogue/openai-extraction.utils';
import {
  OPENAI_MODEL_ENV_KEY,
  PRODUCT_CHECK_AI_MODEL_ENV_KEY,
  readFeatureOpenAiModel,
} from '../common/utils/openai-config';
import { openAiRepeatabilityRequestOptions } from '../common/utils/openai-request-options';
import { estimateCost } from '../suggestions/services/suggestion-ai-contract';
import {
  PRODUCT_CHECK_AI_MAX_OUTPUT_TOKENS,
  PRODUCT_CHECK_AI_STRUCTURED_OUTPUT_ATTEMPTS,
  PRODUCT_CHECK_SYNC_AI_REQUEST_TIMEOUT_MS,
} from './ingredient-analysis-runtime.constants';
import { AnalysisStatus } from './ingredients.types';
import { requestOpenAiStructuredOutput } from './openai-structured-output-request';
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
import { ProductCheckAiReviewStatus } from './product-check.types';

export const OPENAI_PRODUCT_CHECK_REVIEW_REQUEST_TIMEOUT_MS =
  PRODUCT_CHECK_SYNC_AI_REQUEST_TIMEOUT_MS;
export const OPENAI_PRODUCT_CHECK_REVIEW_MAX_OUTPUT_TOKENS =
  PRODUCT_CHECK_AI_MAX_OUTPUT_TOKENS;
export const OPENAI_PRODUCT_CHECK_REVIEW_STRUCTURED_OUTPUT_ATTEMPTS =
  PRODUCT_CHECK_AI_STRUCTURED_OUTPUT_ATTEMPTS;
const DEFAULT_MODEL = 'gpt-5-mini';

type ProductCheckAiReviewUsage = {
  estimatedCostUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

type ProductCheckAiReviewMetricInput = {
  durationMs: number;
  model: string | null;
  source: ProductCheckAiReviewInput['source'];
  status: ProductCheckAiReviewStatus;
  usage: ProductCheckAiReviewUsage | null;
  userId: string;
};

@Injectable()
export class OpenAiProductCheckReviewProvider implements ProductCheckAiReviewPort {
  private readonly logger = new Logger(OpenAiProductCheckReviewProvider.name);
  private hasWarnedMissingModel = false;
  private hasWarnedMetricWriteFailure = false;

  constructor(
    private readonly configService: ConfigService,
    @Optional()
    @Inject(DataSource)
    private readonly dataSource?: DataSource,
  ) {}

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

    const model = this.readModel();
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      this.logStructured('warn', {
        event: 'product_check_ai_review_skipped',
        reason: 'missing_api_key',
      });
      this.recordMetricInBackground({
        durationMs: 0,
        model,
        source: input.source,
        status: ProductCheckAiReviewStatus.Unavailable,
        usage: null,
        userId: input.userId,
      });
      return unavailableProductCheckAiReview();
    }

    if (!model) {
      if (!this.hasWarnedMissingModel) {
        this.logStructured('warn', {
          event: 'product_check_ai_review_skipped',
          reason: 'missing_model_env',
        });
        this.hasWarnedMissingModel = true;
      }
      this.recordMetricInBackground({
        durationMs: 0,
        model: null,
        source: input.source,
        status: ProductCheckAiReviewStatus.Unavailable,
        usage: null,
        userId: input.userId,
      });
      return unavailableProductCheckAiReview();
    }

    const startedAt = Date.now();
    try {
      const response = await requestOpenAiStructuredOutput({
        apiKey,
        attempts: OPENAI_PRODUCT_CHECK_REVIEW_STRUCTURED_OUTPUT_ATTEMPTS,
        timeoutMs: OPENAI_PRODUCT_CHECK_REVIEW_REQUEST_TIMEOUT_MS,
        body: {
          model,
          store: false,
          max_output_tokens: OPENAI_PRODUCT_CHECK_REVIEW_MAX_OUTPUT_TOKENS,
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
        },
      });

      const durationMs = Date.now() - startedAt;
      if (!response.ok) {
        this.logStructured('warn', {
          event: 'product_check_ai_review_failed',
          reason: 'http_error',
          status: response.status,
          model,
          attempt: response.attempt,
          durationMs,
        });
        this.recordMetricInBackground({
          durationMs,
          model,
          source: input.source,
          status: ProductCheckAiReviewStatus.Unavailable,
          usage: null,
          userId: input.userId,
        });
        return unavailableProductCheckAiReview();
      }

      const payload = response.payload;
      const usage = normalizeUsage(payload.usage);
      const outputText = response.outputText;
      if (!outputText) {
        this.logStructured('warn', {
          event: 'product_check_ai_review_failed',
          reason: 'empty_output',
          model,
          attempts: OPENAI_PRODUCT_CHECK_REVIEW_STRUCTURED_OUTPUT_ATTEMPTS,
          durationMs,
        });
        this.recordMetricInBackground({
          durationMs,
          model,
          source: input.source,
          status: ProductCheckAiReviewStatus.Unavailable,
          usage,
          userId: input.userId,
        });
        return unavailableProductCheckAiReview();
      }

      try {
        const parsed = JSON.parse(
          extractJsonObject(outputText),
        ) as ParsedProductCheckAiReview;
        const review = sanitizeProductCheckAiReview(parsed, input);
        this.recordMetricInBackground({
          durationMs,
          model,
          source: input.source,
          status: review.status,
          usage,
          userId: input.userId,
        });
        return review;
      } catch (error) {
        this.logStructured('warn', {
          event: 'product_check_ai_review_failed',
          reason: 'invalid_output',
          message: error instanceof Error ? error.message : 'Unknown error',
          model,
          attempt: response.attempt,
          durationMs,
        });
        this.recordMetricInBackground({
          durationMs,
          model,
          source: input.source,
          status: ProductCheckAiReviewStatus.Unavailable,
          usage,
          userId: input.userId,
        });
        return unavailableProductCheckAiReview();
      }
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      this.logStructured('warn', {
        event: 'product_check_ai_review_failed',
        reason: 'exception',
        message: error instanceof Error ? error.message : 'Unknown error',
        model,
        durationMs,
      });
      this.recordMetricInBackground({
        durationMs,
        model,
        source: input.source,
        status: ProductCheckAiReviewStatus.Unavailable,
        usage: null,
        userId: input.userId,
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

  private recordMetricInBackground(
    input: ProductCheckAiReviewMetricInput,
  ): void {
    void this.recordMetric(input);
  }

  private async recordMetric(
    input: ProductCheckAiReviewMetricInput,
  ): Promise<void> {
    if (!this.dataSource) {
      return;
    }

    try {
      await this.dataSource.query(
        `
          INSERT INTO product_check_ai_review_metrics (
            id,
            product_source,
            status,
            model,
            input_tokens,
            output_tokens,
            total_tokens,
            ai_estimated_cost_usd,
            duration_ms,
            occurred_at,
            user_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `,
        [
          ulid(),
          input.source,
          input.status,
          input.model,
          input.usage?.inputTokens ?? null,
          input.usage?.outputTokens ?? null,
          input.usage?.totalTokens ?? null,
          input.usage?.estimatedCostUsd ?? null,
          Math.max(input.durationMs, 0),
          new Date(),
          input.userId,
        ],
      );
    } catch (error) {
      if (this.hasWarnedMetricWriteFailure) {
        return;
      }

      this.hasWarnedMetricWriteFailure = true;
      this.logStructured('warn', {
        event: 'product_check_ai_review_metric_write_failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

function normalizeUsage(
  usage: OpenAiResponsePayload['usage'] | undefined,
): ProductCheckAiReviewUsage | null {
  if (!usage) {
    return null;
  }

  const inputTokens = numberOrNull(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = numberOrNull(
    usage.output_tokens ?? usage.completion_tokens,
  );
  const totalTokens =
    numberOrNull(usage.total_tokens) ?? nullableSum(inputTokens, outputTokens);
  const estimatedCostUsd =
    inputTokens === null && outputTokens === null
      ? null
      : estimateCost({
          input_tokens: inputTokens ?? undefined,
          output_tokens: outputTokens ?? undefined,
        });

  return {
    estimatedCostUsd,
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nullableSum(...values: Array<number | null>): number | null {
  const numbers = values.filter((value): value is number => value !== null);
  if (numbers.length === 0) {
    return null;
  }

  return numbers.reduce((sum, value) => sum + value, 0);
}

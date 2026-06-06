import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ulid } from 'ulid';
import type { OpenAiResponsePayload } from '../catalogue/openai-extraction.utils';
import { estimateCost } from '../suggestions/services/suggestion-ai-contract';

export const IngredientAnalysisAiMetricOperation = {
  Classification: 'classification',
  Explanation: 'explanation',
} as const;

export type IngredientAnalysisAiMetricOperation =
  (typeof IngredientAnalysisAiMetricOperation)[keyof typeof IngredientAnalysisAiMetricOperation];

export const IngredientAnalysisAiMetricSource = {
  IngredientProductAnalysisWorker: 'ingredient_product_analysis_worker',
  QuickCheck: 'quick_check',
  ShelfAnalysis: 'shelf_analysis',
  Unknown: 'unknown',
} as const;

export type IngredientAnalysisAiMetricSource =
  (typeof IngredientAnalysisAiMetricSource)[keyof typeof IngredientAnalysisAiMetricSource];

export const IngredientAnalysisAiMetricStatus = {
  Completed: 'completed',
  Failed: 'failed',
} as const;

export type IngredientAnalysisAiMetricStatus =
  (typeof IngredientAnalysisAiMetricStatus)[keyof typeof IngredientAnalysisAiMetricStatus];

export type IngredientAnalysisAiTrackingContext = {
  productId?: string | null;
  source: IngredientAnalysisAiMetricSource;
  userId?: string | null;
};

export type IngredientAnalysisAiUsage = {
  estimatedCostUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type IngredientAnalysisAiUsageMetricInput = {
  durationMs: number;
  model: string | null;
  operation: IngredientAnalysisAiMetricOperation;
  status: IngredientAnalysisAiMetricStatus;
  tracking?: IngredientAnalysisAiTrackingContext;
  usage: IngredientAnalysisAiUsage | null;
};

export type IngredientAnalysisAiUsageMetricOptions = {
  logFailure?: boolean;
};

export function normalizeIngredientAnalysisAiUsage(
  usage: OpenAiResponsePayload['usage'] | undefined,
): IngredientAnalysisAiUsage | null {
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

export async function recordIngredientAnalysisAiUsageMetric(
  dataSource: DataSource | undefined,
  logger: Logger,
  input: IngredientAnalysisAiUsageMetricInput,
  options: IngredientAnalysisAiUsageMetricOptions = {},
): Promise<boolean> {
  if (!dataSource || !input.tracking?.userId) {
    return true;
  }

  try {
    await dataSource.query(
      `
        INSERT INTO ingredient_analysis_ai_usage_metrics (
          id,
          user_id,
          product_id,
          source,
          operation,
          status,
          model,
          input_tokens,
          output_tokens,
          total_tokens,
          ai_estimated_cost_usd,
          duration_ms,
          occurred_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
      `,
      [
        ulid(),
        input.tracking.userId,
        input.tracking.productId ?? null,
        input.tracking.source,
        input.operation,
        input.status,
        input.model,
        input.usage?.inputTokens ?? null,
        input.usage?.outputTokens ?? null,
        input.usage?.totalTokens ?? null,
        input.usage?.estimatedCostUsd ?? null,
        Math.max(0, Math.round(input.durationMs)),
      ],
    );
    return true;
  } catch (error) {
    if (options.logFailure !== false) {
      logger.warn(
        JSON.stringify({
          event: 'ingredient_analysis_ai_usage_metric_write_failed',
          message: error instanceof Error ? error.message : 'Unknown error',
          operation: input.operation,
          source: input.tracking.source,
        }),
      );
    }
    return false;
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nullableSum(left: number | null, right: number | null): number | null {
  if (left === null && right === null) {
    return null;
  }

  return (left ?? 0) + (right ?? 0);
}

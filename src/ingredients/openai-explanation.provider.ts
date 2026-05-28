import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  extractJsonObject,
  extractOutputText,
  type OpenAiResponsePayload,
} from '../catalogue/openai-extraction.utils';
import {
  INGREDIENT_EXPLANATION_AI_MODEL_ENV_KEY,
  OPENAI_MODEL_ENV_KEY,
  readFeatureOpenAiModel,
} from '../common/utils/openai-config';
import { openAiRepeatabilityRequestOptions } from '../common/utils/openai-request-options';
import type {
  ExplanationInput,
  ExplanationOutput,
  ExplanationPort,
} from './explanation.port';
import {
  IngredientAnalysisAiMetricOperation,
  IngredientAnalysisAiMetricStatus,
  type IngredientAnalysisAiUsage,
  normalizeIngredientAnalysisAiUsage,
  recordIngredientAnalysisAiUsageMetric,
} from './ingredient-analysis-ai-usage-metrics';

export const OPENAI_EXPLANATION_REQUEST_TIMEOUT_MS = 45_000;
const DEFAULT_MODEL = 'gpt-5-mini';
const EXPLANATION_JSON_CONTRACT =
  'Keep JSON keys exactly as schema keys: conflicts, overlaps, id, explanation. Keep ids exactly as provided. Translate only explanation string values.';
const EXPLANATION_RESPONSE_FORMAT = {
  type: 'json_schema',
  name: 'ingredient_explanations',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['conflicts', 'overlaps'],
    properties: {
      conflicts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'explanation'],
          properties: {
            id: { type: 'string' },
            explanation: { type: 'string' },
          },
        },
      },
      overlaps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'explanation'],
          properties: {
            id: { type: 'string' },
            explanation: { type: 'string' },
          },
        },
      },
    },
  },
} as const;

@Injectable()
export class OpenAiExplanationProvider implements ExplanationPort {
  private readonly logger = new Logger(OpenAiExplanationProvider.name);
  private hasWarnedMissingModel = false;
  private hasWarnedMetricWriteFailure = false;

  constructor(
    private readonly configService: ConfigService,
    @Optional()
    private readonly dataSource?: DataSource,
  ) {}

  /**
   * Check once at boot whether the model env var is set. Emits a single WARN
   * if it is missing so the misconfiguration surfaces in logs rather than
   * silently suppressing explanations on every analyze call.
   */
  warnIfMisconfigured(): void {
    const model = this.readModel();
    if (!model) {
      this.logger.warn(
        `${INGREDIENT_EXPLANATION_AI_MODEL_ENV_KEY} or ${OPENAI_MODEL_ENV_KEY} is not set. Ingredient explanations will be skipped; clients will receive deterministic findings only.`,
      );
      this.hasWarnedMissingModel = true;
    }
  }

  async explainFindings(
    input: ExplanationInput,
  ): Promise<ExplanationOutput | null> {
    if (input.conflicts.length === 0 && input.overlaps.length === 0) {
      return null;
    }

    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      this.logStructured('warn', {
        event: 'explanation_skipped',
        reason: 'missing_api_key',
      });
      return null;
    }

    const model = this.readModel();
    if (!model) {
      if (!this.hasWarnedMissingModel) {
        this.logStructured('warn', {
          event: 'explanation_skipped',
          reason: 'missing_model_env',
        });
        this.hasWarnedMissingModel = true;
      }
      return null;
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
          text: {
            verbosity: 'low',
            format: EXPLANATION_RESPONSE_FORMAT,
          },
          max_output_tokens: 700,
          ...openAiRepeatabilityRequestOptions(model),
          input: [
            {
              role: 'system',
              content: [
                {
                  type: 'input_text',
                  text: this.systemPrompt(input.language),
                },
              ],
            },
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: JSON.stringify({
                    language: input.language,
                    schema: {
                      conflicts: [{ id: 'string', explanation: 'string' }],
                      overlaps: [{ id: 'string', explanation: 'string' }],
                    },
                    findings: {
                      conflicts: input.conflicts,
                      overlaps: input.overlaps,
                    },
                  }),
                },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(OPENAI_EXPLANATION_REQUEST_TIMEOUT_MS),
      });

      const durationMs = Date.now() - startedAt;

      if (!response.ok) {
        this.logStructured('warn', {
          event: 'explanation_failed',
          reason: 'http_error',
          status: response.status,
          model,
          durationMs,
        });
        await this.recordMetric({
          durationMs,
          model,
          status: IngredientAnalysisAiMetricStatus.Failed,
          tracking: input.tracking,
          usage: null,
        });
        return null;
      }

      const payload = (await response.json()) as OpenAiResponsePayload;
      const usage = normalizeIngredientAnalysisAiUsage(payload.usage);
      const outputText = extractOutputText(payload);
      if (!outputText) {
        this.logStructured('warn', {
          event: 'explanation_failed',
          reason: 'empty_output',
          model,
          durationMs,
        });
        await this.recordMetric({
          durationMs,
          model,
          status: IngredientAnalysisAiMetricStatus.Failed,
          tracking: input.tracking,
          usage,
        });
        return null;
      }

      let parsed: Partial<{
        conflicts: Array<{ id?: string; explanation?: string }>;
        overlaps: Array<{ id?: string; explanation?: string }>;
      }>;
      try {
        parsed = JSON.parse(extractJsonObject(outputText)) as Partial<{
          conflicts: Array<{ id?: string; explanation?: string }>;
          overlaps: Array<{ id?: string; explanation?: string }>;
        }>;
      } catch (error) {
        this.logStructured('warn', {
          event: 'explanation_failed',
          reason: 'invalid_output',
          message: error instanceof Error ? error.message : 'Unknown error',
          model,
          durationMs,
        });
        await this.recordMetric({
          durationMs,
          model,
          status: IngredientAnalysisAiMetricStatus.Failed,
          tracking: input.tracking,
          usage,
        });
        return null;
      }

      const output = {
        conflicts: this.toLookup(parsed.conflicts),
        overlaps: this.toLookup(parsed.overlaps),
      };
      await this.recordMetric({
        durationMs,
        model,
        status: IngredientAnalysisAiMetricStatus.Completed,
        tracking: input.tracking,
        usage,
      });
      return output;
    } catch (error) {
      this.logStructured('warn', {
        event: 'explanation_failed',
        reason: 'exception',
        message: error instanceof Error ? error.message : 'Unknown error',
        model,
        durationMs: Date.now() - startedAt,
      });
      await this.recordMetric({
        durationMs: Date.now() - startedAt,
        model,
        status: IngredientAnalysisAiMetricStatus.Failed,
        tracking: input.tracking,
        usage: null,
      });
      return null;
    }
  }

  private async recordMetric(input: {
    durationMs: number;
    model: string;
    status: IngredientAnalysisAiMetricStatus;
    tracking?: ExplanationInput['tracking'];
    usage: IngredientAnalysisAiUsage | null;
  }): Promise<void> {
    const recorded = await recordIngredientAnalysisAiUsageMetric(
      this.dataSource,
      this.logger,
      {
        durationMs: input.durationMs,
        model: input.model,
        operation: IngredientAnalysisAiMetricOperation.Explanation,
        status: input.status,
        tracking: input.tracking,
        usage: input.usage,
      },
      { logFailure: !this.hasWarnedMetricWriteFailure },
    );
    if (!recorded) {
      this.hasWarnedMetricWriteFailure = true;
    }
  }

  private readModel(): string | null {
    return readFeatureOpenAiModel(
      this.configService,
      INGREDIENT_EXPLANATION_AI_MODEL_ENV_KEY,
      DEFAULT_MODEL,
    );
  }

  private systemPrompt(language: ExplanationInput['language']): string {
    if (language === 'sv') {
      return [
        'Du skriver korta, tydliga hudvårdsförklaringar på svenska. Håll dig strikt till de strukturerade fynden. Hitta inte på nya risker eller instruktioner. Svara endast med JSON.',
        EXPLANATION_JSON_CONTRACT,
      ].join(' ');
    }

    if (language === 'es') {
      return [
        'Escribes explicaciones breves y claras de cuidado de la piel en español. Mantente estrictamente dentro de los hallazgos estructurados. No inventes nuevos riesgos ni instrucciones. Responde solo con JSON.',
        EXPLANATION_JSON_CONTRACT,
      ].join(' ');
    }

    return [
      'You write short, clear skincare explanations in English. Stay strictly within the structured findings. Do not invent any new risk or instruction. Return JSON only.',
      EXPLANATION_JSON_CONTRACT,
    ].join(' ');
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

  private toLookup(
    items: Array<{ id?: string; explanation?: string }> | undefined,
  ): Record<string, string> {
    const lookup: Record<string, string> = {};

    for (const item of items ?? []) {
      if (typeof item.id !== 'string' || typeof item.explanation !== 'string') {
        continue;
      }

      const explanation = item.explanation.trim();
      if (!explanation) {
        continue;
      }

      lookup[item.id] = explanation;
    }

    return lookup;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  extractJsonObject,
  extractOutputText,
  type OpenAiResponsePayload,
} from '../catalogue/openai-extraction.utils';
import {
  OPENAI_MODEL_ENV_KEY,
  readOpenAiModel,
} from '../common/utils/openai-config';
import type {
  ExplanationInput,
  ExplanationOutput,
  ExplanationPort,
} from './explanation.port';

const REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_MODEL = 'gpt-5.5';

@Injectable()
export class OpenAiExplanationProvider implements ExplanationPort {
  private readonly logger = new Logger(OpenAiExplanationProvider.name);
  private hasWarnedMissingModel = false;

  constructor(private readonly configService: ConfigService) {}

  /**
   * Check once at boot whether the model env var is set. Emits a single WARN
   * if it is missing so the misconfiguration surfaces in logs rather than
   * silently suppressing explanations on every analyze call.
   */
  warnIfMisconfigured(): void {
    const model = this.readModel();
    if (!model) {
      this.logger.warn(
        `${OPENAI_MODEL_ENV_KEY} is not set. Ingredient explanations will be skipped; clients will receive deterministic findings only.`,
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
          reasoning: { effort: 'low' },
          text: { verbosity: 'low' },
          max_output_tokens: 700,
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
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
        return null;
      }

      const payload = (await response.json()) as OpenAiResponsePayload;
      const outputText = extractOutputText(payload);
      if (!outputText) {
        this.logStructured('warn', {
          event: 'explanation_failed',
          reason: 'empty_output',
          model,
          durationMs,
        });
        return null;
      }

      const parsed = JSON.parse(extractJsonObject(outputText)) as Partial<{
        conflicts: Array<{ id?: string; explanation?: string }>;
        overlaps: Array<{ id?: string; explanation?: string }>;
      }>;

      return {
        conflicts: this.toLookup(parsed.conflicts),
        overlaps: this.toLookup(parsed.overlaps),
      };
    } catch (error) {
      this.logStructured('warn', {
        event: 'explanation_failed',
        reason: 'exception',
        message: error instanceof Error ? error.message : 'Unknown error',
        model,
        durationMs: Date.now() - startedAt,
      });
      return null;
    }
  }

  private readModel(): string | null {
    return readOpenAiModel(this.configService, DEFAULT_MODEL);
  }

  private systemPrompt(language: ExplanationInput['language']): string {
    if (language === 'sv') {
      return 'Du skriver korta, tydliga hudvårdsförklaringar på svenska. Håll dig strikt till de strukturerade fynden. Hitta inte på nya risker eller instruktioner. Svara endast med JSON.';
    }

    return 'You write short, clear skincare explanations in English. Stay strictly within the structured findings. Do not invent any new risk or instruction. Return JSON only.';
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

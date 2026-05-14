import { ConfigService } from '@nestjs/config';
import {
  extractJsonObject,
  extractOutputText,
  type OpenAiResponsePayload,
} from '../catalogue/openai-extraction.utils';
import {
  INGREDIENT_TRANSLATION_AI_MODEL_ENV_KEY,
  readFeatureOpenAiModel,
} from '../common/utils/openai-config';
import { openAiRepeatabilityRequestOptions } from '../common/utils/openai-request-options';

const DEFAULT_MODEL = 'gpt-5-mini';
const REQUEST_TIMEOUT_MS = 15000;
const MAX_OUTPUT_TOKENS = 220;
const MAX_BATCH_OUTPUT_TOKENS = 1600;
const MAX_OUTPUT_TOKENS_PER_TRANSLATION = 120;

export async function translateWithOpenAi(
  configService: ConfigService,
  sourceTexts: string[],
  targetLanguage: string,
  logStructured: (payload: Record<string, unknown>) => void,
): Promise<string[] | null> {
  const apiKey = configService.get<string>('OPENAI_API_KEY')?.trim();
  if (!apiKey) {
    logStructured({ event: 'translation_skipped', reason: 'missing_api_key' });
    return null;
  }

  const model = readFeatureOpenAiModel(
    configService,
    INGREDIENT_TRANSLATION_AI_MODEL_ENV_KEY,
    DEFAULT_MODEL,
  );
  if (!model) {
    logStructured({
      event: 'translation_skipped',
      reason: 'missing_model_env',
    });
    return null;
  }

  const startedAt = Date.now();
  const maxOutputTokens = Math.max(
    MAX_OUTPUT_TOKENS,
    Math.min(
      MAX_BATCH_OUTPUT_TOKENS,
      sourceTexts.length * MAX_OUTPUT_TOKENS_PER_TRANSLATION,
    ),
  );

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
        text: { verbosity: 'low' },
        max_output_tokens: maxOutputTokens,
        ...openAiRepeatabilityRequestOptions(model),
        input: buildTranslationInput(sourceTexts, targetLanguage),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const durationMs = Date.now() - startedAt;
    if (!response.ok) {
      logStructured({
        event: 'translation_failed',
        reason: 'http_error',
        status: response.status,
        model,
        durationMs,
      });
      return null;
    }

    return parseTranslationResponse(
      (await response.json()) as OpenAiResponsePayload,
      sourceTexts.length,
      model,
      durationMs,
      logStructured,
    );
  } catch (error) {
    logStructured({
      event: 'translation_failed',
      reason: 'exception',
      message: error instanceof Error ? error.message : 'Unknown error',
      model,
      durationMs: Date.now() - startedAt,
    });
    return null;
  }
}

function parseTranslationResponse(
  payload: OpenAiResponsePayload,
  sourceCount: number,
  model: string,
  durationMs: number,
  logStructured: (payload: Record<string, unknown>) => void,
): string[] | null {
  const outputText = extractOutputText(payload);
  if (!outputText) {
    logStructured({
      event: 'translation_failed',
      reason: 'empty_output',
      model,
      durationMs,
    });
    return null;
  }

  const parsed = JSON.parse(extractJsonObject(outputText)) as {
    translations?: unknown;
    translation?: unknown;
  };

  if (
    Array.isArray(parsed.translations) &&
    parsed.translations.every((item) => typeof item === 'string')
  ) {
    return parsed.translations.map((item) => item.trim());
  }

  if (sourceCount === 1 && typeof parsed.translation === 'string') {
    return [parsed.translation.trim()];
  }

  if (sourceCount === 1 && typeof parsed.translations === 'string') {
    return [parsed.translations.trim()];
  }

  if (sourceCount > 1) {
    logStructured({
      event: 'translation_failed',
      reason: 'invalid_shape',
      model,
      durationMs,
    });
  }

  return null;
}

function buildTranslationInput(sourceTexts: string[], targetLanguage: string) {
  return [
    {
      role: 'system',
      content: [
        {
          type: 'input_text',
          text: systemPrompt(targetLanguage),
        },
      ],
    },
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: JSON.stringify({
            schema: { translations: ['string'] },
            sources: sourceTexts,
          }),
        },
      ],
    },
  ];
}

function systemPrompt(targetLanguage: string): string {
  return `You translate skincare reference text from English to ${targetLanguage}.
- Keep ingredient names (retinol, niacinamide, salicylic acid, etc.) in their original scientific form unless an established local lay name exists.
- Preserve register: calm, professional, non-alarmist, short.
- Do not add new risk information or instructions beyond the source.
- Return only JSON: {"translations": ["<translated text>"]} with the translations in the same order as the input sources.`;
}

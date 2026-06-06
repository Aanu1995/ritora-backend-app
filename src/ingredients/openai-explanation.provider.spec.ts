import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import { AnalysisSeverity } from './ingredients.types';
import {
  OPENAI_EXPLANATION_MAX_OUTPUT_TOKENS,
  OPENAI_EXPLANATION_REQUEST_TIMEOUT_MS,
  OpenAiExplanationProvider,
} from './openai-explanation.provider';

type ExplainInput = Parameters<OpenAiExplanationProvider['explainFindings']>[0];

function buildInput(overrides: Partial<ExplainInput> = {}): ExplainInput {
  return {
    language: 'en',
    conflicts: [
      {
        id: 'RETINOID_AHA:a:b:retinol:glycolic-acid',
        code: 'RETINOID_AHA',
        severity: AnalysisSeverity.High,
        ingredientA: 'Retinol',
        ingredientB: 'Glycolic acid',
        description:
          'Retinoids and AHAs can irritate skin in the same routine.',
        mitigation: 'Alternate nights.',
      },
    ],
    overlaps: [],
    ...overrides,
  };
}

function buildConfig(
  values: Record<string, string | undefined>,
): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('OpenAiExplanationProvider', () => {
  const originalFetch = global.fetch;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    // Stub the logger at the prototype level so the in-class logger stays silent.
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('keeps the OpenAI timeout long enough for launch Quick Check requests', () => {
    expect(OPENAI_EXPLANATION_REQUEST_TIMEOUT_MS).toBe(180_000);
    expect(OPENAI_EXPLANATION_MAX_OUTPUT_TOKENS).toBe(24_000);
  });

  it('returns null and skips the network when the api key is missing', async () => {
    const provider = new OpenAiExplanationProvider(
      buildConfig({
        OPENAI_API_KEY: '',
        INGREDIENT_EXPLANATION_AI_MODEL: 'ingredient-explanation-model',
      }),
    );
    global.fetch = jest.fn();

    const result = await provider.explainFindings(buildInput());

    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns null and skips the network when the model env var is missing', async () => {
    const provider = new OpenAiExplanationProvider(
      buildConfig({
        OPENAI_API_KEY: 'sk-test',
        INGREDIENT_EXPLANATION_AI_MODEL: undefined,
        OPENAI_MODEL: undefined,
      }),
    );
    global.fetch = jest.fn();

    const result = await provider.explainFindings(buildInput());

    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns null on a non-ok http response and logs a structured event', async () => {
    const provider = new OpenAiExplanationProvider(
      buildConfig({
        OPENAI_API_KEY: 'sk-test',
        INGREDIENT_EXPLANATION_AI_MODEL: 'ingredient-explanation-model',
        OPENAI_MODEL: 'fallback-model',
      }),
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    });

    const result = await provider.explainFindings(buildInput());

    expect(result).toBeNull();
    const loggedPayloads = warnSpy.mock.calls.map(([message]) => {
      try {
        return JSON.parse(String(message));
      } catch {
        return { raw: message };
      }
    });
    expect(loggedPayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'explanation_failed',
          reason: 'http_error',
          status: 503,
          model: 'ingredient-explanation-model',
        }),
      ]),
    );
  });

  it('records privacy-safe user-attributed AI usage metrics for generated explanations', async () => {
    const query = jest.fn<Promise<unknown>, [string, unknown[]?]>(
      async () => [],
    );
    const provider = new OpenAiExplanationProvider(
      buildConfig({
        OPENAI_API_KEY: 'sk-test',
        INGREDIENT_EXPLANATION_AI_MODEL: 'ingredient-explanation-model',
      }),
      { query } as unknown as DataSource,
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          conflicts: [
            {
              id: 'RETINOID_AHA:a:b:retinol:glycolic-acid',
              explanation: 'Alternate these to reduce irritation risk.',
            },
          ],
          overlaps: [],
        }),
        usage: {
          input_tokens: 900,
          output_tokens: 120,
          total_tokens: 1020,
        },
      }),
    });

    await provider.explainFindings(
      buildInput({
        tracking: {
          productId: '01PRODUCT',
          source: 'ingredient_product_analysis_worker',
          userId: '01USER',
        },
      }),
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('ingredient_analysis_ai_usage_metrics'),
      expect.arrayContaining([
        expect.any(String),
        '01USER',
        '01PRODUCT',
        'ingredient_product_analysis_worker',
        'explanation',
        'completed',
        'ingredient-explanation-model',
        900,
        120,
        1020,
        expect.any(Number),
        expect.any(Number),
      ]),
    );
    expect(String(query.mock.calls[0]?.[0])).not.toContain('retinol');
  });

  it('suppresses repeated AI usage metric write warnings when telemetry storage is unavailable', async () => {
    const query = jest.fn<Promise<unknown>, [string, unknown[]?]>(async () => {
      throw new Error('telemetry unavailable');
    });
    const provider = new OpenAiExplanationProvider(
      buildConfig({
        OPENAI_API_KEY: 'sk-test',
        INGREDIENT_EXPLANATION_AI_MODEL: 'ingredient-explanation-model',
      }),
      { query } as unknown as DataSource,
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          conflicts: [
            {
              id: 'RETINOID_AHA:a:b:retinol:glycolic-acid',
              explanation: 'Alternate these to reduce irritation risk.',
            },
          ],
          overlaps: [],
        }),
      }),
    });

    const trackedInput = buildInput({
      tracking: {
        source: 'ingredient_product_analysis_worker',
        userId: '01USER',
      },
    });
    await provider.explainFindings(trackedInput);
    await provider.explainFindings(trackedInput);

    const metricWarnings = warnSpy.mock.calls.filter(([message]) =>
      String(message).includes(
        'ingredient_analysis_ai_usage_metric_write_failed',
      ),
    );
    expect(query).toHaveBeenCalledTimes(2);
    expect(metricWarnings).toHaveLength(1);
  });

  it('warnIfMisconfigured logs once when the model env var is unset', () => {
    const provider = new OpenAiExplanationProvider(
      buildConfig({
        INGREDIENT_EXPLANATION_AI_MODEL: undefined,
        OPENAI_MODEL: undefined,
      }),
    );

    provider.warnIfMisconfigured();

    expect(warnSpy).toHaveBeenCalled();
    const warned = warnSpy.mock.calls.some(([message]) =>
      String(message).includes('INGREDIENT_EXPLANATION_AI_MODEL'),
    );
    expect(warned).toBe(true);
  });

  it('falls back to OPENAI_MODEL when the ingredient explanation model is missing', async () => {
    const provider = new OpenAiExplanationProvider(
      buildConfig({
        OPENAI_API_KEY: 'sk-test',
        INGREDIENT_EXPLANATION_AI_MODEL: '',
        OPENAI_MODEL: 'fallback-model',
      }),
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    });

    await provider.explainFindings(buildInput());

    const loggedPayloads = warnSpy.mock.calls.map(([message]) => {
      try {
        return JSON.parse(String(message));
      } catch {
        return { raw: message };
      }
    });
    expect(loggedPayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'explanation_failed',
          model: 'fallback-model',
        }),
      ]),
    );
  });

  it('requests no-storage, low-temperature output for repeatable explanations', async () => {
    const input = buildInput();
    const provider = new OpenAiExplanationProvider(
      buildConfig({
        OPENAI_API_KEY: 'sk-test',
        INGREDIENT_EXPLANATION_AI_MODEL: 'ingredient-explanation-model',
        OPENAI_MODEL: 'fallback-model',
      }),
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          conflicts: [
            {
              id: input.conflicts[0]?.id,
              explanation: 'Use these on different nights.',
            },
          ],
          overlaps: [],
        }),
      }),
    });

    const result = await provider.explainFindings(input);

    expect(result?.conflicts[input.conflicts[0]?.id ?? '']).toBe(
      'Use these on different nights.',
    );
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(String(init.body)) as {
      max_output_tokens?: number;
      store?: boolean;
      temperature?: number;
      text?: { format?: { type?: string; strict?: boolean } };
    };
    expect(body.store).toBe(false);
    expect(body.max_output_tokens).toBe(OPENAI_EXPLANATION_MAX_OUTPUT_TOKENS);
    expect(body.temperature).toBe(0);
    expect(body.text?.format).toEqual(
      expect.objectContaining({
        type: 'json_schema',
        strict: true,
      }),
    );
  });

  it('keeps explanation JSON keys and IDs stable for localized responses', async () => {
    const input = buildInput({ language: 'es' });
    const provider = new OpenAiExplanationProvider(
      buildConfig({
        OPENAI_API_KEY: 'sk-test',
        INGREDIENT_EXPLANATION_AI_MODEL: 'ingredient-explanation-model',
      }),
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          conflicts: [
            {
              id: input.conflicts[0]?.id,
              explanation: 'Usa estos activos en noches separadas.',
            },
          ],
          overlaps: [],
        }),
      }),
    });

    await provider.explainFindings(input);

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(String(init.body)) as {
      input?: Array<{
        role?: string;
        content?: Array<{ text?: string }>;
      }>;
    };
    const systemText = body.input?.[0]?.content?.[0]?.text ?? '';
    expect(systemText).toContain(
      'Keep JSON keys exactly as schema keys: conflicts, overlaps, id, explanation.',
    );
    expect(systemText).toContain('Keep ids exactly as provided.');
    expect(systemText).toContain('Translate only explanation string values.');
  });

  it('short-circuits with null when there are no findings', async () => {
    const provider = new OpenAiExplanationProvider(
      buildConfig({
        OPENAI_API_KEY: 'sk-test',
        INGREDIENT_EXPLANATION_AI_MODEL: 'ingredient-explanation-model',
      }),
    );
    global.fetch = jest.fn();

    const result = await provider.explainFindings(
      buildInput({ conflicts: [], overlaps: [] }),
    );

    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

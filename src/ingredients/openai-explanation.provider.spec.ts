import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnalysisSeverity } from './ingredients.types';
import {
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
    expect(OPENAI_EXPLANATION_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(
      45_000,
    );
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
      store?: boolean;
      temperature?: number;
      text?: { format?: { type?: string; strict?: boolean } };
    };
    expect(body.store).toBe(false);
    expect(body.temperature).toBe(0);
    expect(body.text?.format).toEqual(
      expect.objectContaining({
        type: 'json_schema',
        strict: true,
      }),
    );
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

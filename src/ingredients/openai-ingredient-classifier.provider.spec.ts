import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import { AnalysisSeverity } from './ingredients.types';
import type { IngredientAiClassificationCacheEntry } from './entities/ingredient-ai-classification-cache-entry.entity';
import type { IngredientClassification } from './ingredient-classifier.port';
import { IngredientCategory } from './ingredients.types';
import {
  MAX_TOKENS_PER_INGREDIENT_CLASSIFICATION_REQUEST,
  OPENAI_INGREDIENT_CLASSIFIER_REQUEST_TIMEOUT_MS,
  OpenAiIngredientClassifierProvider,
} from './openai-ingredient-classifier.provider';

function config(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

type FetchRequestBody = {
  input: Array<{
    content: Array<{
      text: string;
    }>;
  }>;
};

type CacheRepositoryMock = {
  find: jest.Mock<Promise<IngredientAiClassificationCacheEntry[]>>;
  create: jest.Mock<
    IngredientAiClassificationCacheEntry,
    [Partial<IngredientAiClassificationCacheEntry>]
  >;
  upsert: jest.Mock<
    Promise<unknown>,
    [IngredientAiClassificationCacheEntry[], string[]]
  >;
  createQueryBuilder: jest.Mock;
};

type DataSourceMock = {
  query: jest.Mock<Promise<unknown>, [string, unknown[]?]>;
};

function classification(
  rawToken: string,
  category: IngredientCategory = IngredientCategory.Humectant,
): IngredientClassification {
  return {
    rawToken,
    canonicalName: rawToken,
    category,
    confidence: 0.8,
    summaryEn: `${rawToken} classified for routine safety.`,
    phSensitive: false,
    photosensitizing: false,
    requiresSpf: false,
    irritationRisk: false,
    overlapSeverity: AnalysisSeverity.Low,
  };
}

function cacheEntry(
  normalizedToken: string,
  cachedClassification: IngredientClassification,
): IngredientAiClassificationCacheEntry {
  return {
    cache_key: `cache-${normalizedToken}`,
    normalized_token: normalizedToken,
    normalized_token_hash: `hash-${normalizedToken}`,
    model: 'ingredient-analysis-model',
    contract_version: 'v-test',
    classification: cachedClassification,
    confidence: String(cachedClassification.confidence),
    category: cachedClassification.category,
    overlap_severity: cachedClassification.overlapSeverity,
    hit_count: 0,
    expires_at: new Date(Date.now() + 60_000),
    last_used_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

function repository(
  entries: IngredientAiClassificationCacheEntry[] = [],
): CacheRepositoryMock {
  return {
    find: jest.fn().mockResolvedValue(entries),
    create: jest.fn((entry: Partial<IngredientAiClassificationCacheEntry>) => {
      return entry as IngredientAiClassificationCacheEntry;
    }),
    upsert: jest.fn().mockResolvedValue({}),
    createQueryBuilder: jest.fn().mockReturnValue({
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({}),
    }),
  };
}

function extractRequestedTokens(init: RequestInit): string[] {
  if (typeof init.body !== 'string') {
    throw new Error('Expected OpenAI request body to be a string');
  }

  const body = JSON.parse(init.body) as FetchRequestBody;
  const userMessage = body.input[1];
  const payload = JSON.parse(userMessage.content[0].text) as {
    tokens: string[];
  };
  return payload.tokens;
}

describe('OpenAiIngredientClassifierProvider', () => {
  const originalFetch = global.fetch;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('keeps the classifier timeout long enough for worker-backed product analysis', () => {
    expect(OPENAI_INGREDIENT_CLASSIFIER_REQUEST_TIMEOUT_MS).toBe(60_000);
  });

  it('returns no classifications and skips network calls when the API key is missing', async () => {
    const provider = new OpenAiIngredientClassifierProvider(
      config({ OPENAI_API_KEY: '', INGREDIENT_ANALYSIS_AI_MODEL: 'model' }),
    );
    global.fetch = jest.fn();

    const result = await provider.classify({ tokens: ['Retinol'] });

    expect(result).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('requests strict structured output with no OpenAI response storage', async () => {
    const provider = new OpenAiIngredientClassifierProvider(
      config({
        OPENAI_API_KEY: 'sk-test',
        INGREDIENT_ANALYSIS_AI_MODEL: 'ingredient-analysis-model',
      }),
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          classifications: [
            {
              rawToken: 'Retinol',
              canonicalName: 'Retinol',
              category: IngredientCategory.Retinoid,
              confidence: 0.91,
              summaryEn: 'Retinoid-style active.',
              phSensitive: false,
              photosensitizing: true,
              requiresSpf: true,
              irritationRisk: true,
              overlapSeverity: 'high',
            },
            {
              rawToken: 'Fragrance',
              canonicalName: 'Fragrance',
              category: 'unknown',
              confidence: 0.9,
              summaryEn: 'Not safety-classified.',
              phSensitive: false,
              photosensitizing: false,
              requiresSpf: false,
              irritationRisk: false,
              overlapSeverity: 'low',
            },
          ],
        }),
      }),
    });

    const result = await provider.classify({
      tokens: ['Retinol', 'Fragrance'],
    });

    expect(result).toEqual([
      expect.objectContaining({
        rawToken: 'Retinol',
        canonicalName: 'Retinol',
        category: IngredientCategory.Retinoid,
        confidence: 0.82,
        requiresSpf: true,
      }),
    ]);
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(String(init.body)) as {
      model?: string;
      store?: boolean;
      text?: { format?: { type?: string; strict?: boolean } };
    };
    expect(body.model).toBe('ingredient-analysis-model');
    expect(body.store).toBe(false);
    expect(body.text?.format).toEqual(
      expect.objectContaining({
        type: 'json_schema',
        strict: true,
      }),
    );
  });

  it('records privacy-safe user-attributed AI usage metrics for cache misses', async () => {
    const query = jest.fn<Promise<unknown>, [string, unknown[]?]>(
      async () => [],
    );
    const dataSource: DataSourceMock = {
      query,
    };
    const provider = new OpenAiIngredientClassifierProvider(
      config({
        OPENAI_API_KEY: 'sk-test',
        INGREDIENT_ANALYSIS_AI_MODEL: 'ingredient-analysis-model',
      }),
      undefined,
      dataSource as unknown as DataSource,
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          classifications: [
            {
              rawToken: 'Retinol',
              canonicalName: 'Retinol',
              category: IngredientCategory.Retinoid,
              confidence: 0.91,
              summaryEn: 'Retinoid-style active.',
              phSensitive: false,
              photosensitizing: true,
              requiresSpf: true,
              irritationRisk: true,
              overlapSeverity: 'high',
            },
          ],
        }),
        usage: {
          input_tokens: 1200,
          output_tokens: 300,
          total_tokens: 1500,
        },
      }),
    });

    await provider.classify({
      tokens: ['Retinol'],
      tracking: {
        productId: '01PRODUCT',
        source: 'ingredient_product_analysis_worker',
        userId: '01USER',
      },
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('ingredient_analysis_ai_usage_metrics'),
      expect.arrayContaining([
        expect.any(String),
        '01USER',
        '01PRODUCT',
        'ingredient_product_analysis_worker',
        'classification',
        'completed',
        'ingredient-analysis-model',
        1200,
        300,
        1500,
        expect.any(Number),
        expect.any(Number),
      ]),
    );
    expect(String(query.mock.calls[0]?.[0])).not.toContain('Retinol');
  });

  it('suppresses repeated AI usage metric write warnings when telemetry storage is unavailable', async () => {
    const query = jest.fn<Promise<unknown>, [string, unknown[]?]>(async () => {
      throw new Error('telemetry unavailable');
    });
    const provider = new OpenAiIngredientClassifierProvider(
      config({
        OPENAI_API_KEY: 'sk-test',
        INGREDIENT_ANALYSIS_AI_MODEL: 'ingredient-analysis-model',
      }),
      undefined,
      { query } as unknown as DataSource,
    );
    global.fetch = jest
      .fn()
      .mockImplementation(async (_url: string, init: RequestInit) => {
        const [token = 'Unknown'] = extractRequestedTokens(init);
        return {
          ok: true,
          json: async () => ({
            output_text: JSON.stringify({
              classifications: [classification(token)],
            }),
          }),
        };
      });

    await provider.classify({
      tokens: ['Retinol'],
      tracking: {
        source: 'ingredient_product_analysis_worker',
        userId: '01USER',
      },
    });
    await provider.classify({
      tokens: ['Bakuchiol'],
      tracking: {
        source: 'ingredient_product_analysis_worker',
        userId: '01USER',
      },
    });

    const metricWarnings = warnSpy.mock.calls.filter(([message]) =>
      String(message).includes(
        'ingredient_analysis_ai_usage_metric_write_failed',
      ),
    );
    expect(query).toHaveBeenCalledTimes(2);
    expect(metricWarnings).toHaveLength(1);
  });

  it('uses OPENAI_MODEL as fallback when the feature model is empty', async () => {
    const provider = new OpenAiIngredientClassifierProvider(
      config({
        OPENAI_API_KEY: 'sk-test',
        INGREDIENT_ANALYSIS_AI_MODEL: '',
        OPENAI_MODEL: 'fallback-model',
      }),
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    });

    await provider.classify({ tokens: ['Retinol'] });

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(String(init.body)) as { model?: string };
    expect(body.model).toBe('fallback-model');
  });

  it('serves valid database-cached classifications without calling OpenAI', async () => {
    const cachedClassification = classification(
      'Retinol',
      IngredientCategory.Retinoid,
    );
    const cacheRepository = repository([
      cacheEntry('retinol', cachedClassification),
    ]);
    const provider = new OpenAiIngredientClassifierProvider(
      config({
        OPENAI_API_KEY: '',
        INGREDIENT_ANALYSIS_AI_MODEL: 'ingredient-analysis-model',
      }),
      cacheRepository,
    );
    global.fetch = jest.fn();

    const result = await provider.classify({ tokens: ['Retinol'] });

    expect(result).toEqual([
      expect.objectContaining({
        rawToken: 'Retinol',
        category: IngredientCategory.Retinoid,
      }),
    ]);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(cacheRepository.find).toHaveBeenCalled();
  });

  it('chunks large ingredient lists instead of silently dropping tokens', async () => {
    const cacheRepository = repository();
    const provider = new OpenAiIngredientClassifierProvider(
      config({
        OPENAI_API_KEY: 'sk-test',
        INGREDIENT_ANALYSIS_AI_MODEL: 'ingredient-analysis-model',
      }),
      cacheRepository,
    );
    const tokens = Array.from(
      { length: MAX_TOKENS_PER_INGREDIENT_CLASSIFICATION_REQUEST + 7 },
      (_, index) => `Token ${index + 1}`,
    );
    global.fetch = jest
      .fn()
      .mockImplementation(async (_url: string, init: RequestInit) => {
        const requestedTokens = extractRequestedTokens(init);
        return {
          ok: true,
          json: async () => ({
            output_text: JSON.stringify({
              classifications: requestedTokens.map((token) =>
                classification(token),
              ),
            }),
          }),
        };
      });

    const result = await provider.classify({ tokens });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const requestedTokenBatches = (global.fetch as jest.Mock).mock.calls.map(
      ([, init]) => extractRequestedTokens(init as RequestInit),
    );
    expect(requestedTokenBatches.map((batch) => batch.length)).toEqual([
      MAX_TOKENS_PER_INGREDIENT_CLASSIFICATION_REQUEST,
      7,
    ]);
    for (const batch of requestedTokenBatches) {
      expect(batch.length).toBeLessThanOrEqual(
        MAX_TOKENS_PER_INGREDIENT_CLASSIFICATION_REQUEST,
      );
    }
    expect(result).toHaveLength(tokens.length);
    expect(result.at(-1)).toEqual(
      expect.objectContaining({ rawToken: `Token ${tokens.length}` }),
    );
  });

  it('persists successful AI classifications for future requests', async () => {
    const cacheRepository = repository();
    const provider = new OpenAiIngredientClassifierProvider(
      config({
        OPENAI_API_KEY: 'sk-test',
        INGREDIENT_ANALYSIS_AI_MODEL: 'ingredient-analysis-model',
      }),
      cacheRepository,
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          classifications: [
            classification('Glycerin', IngredientCategory.Humectant),
          ],
        }),
      }),
    });

    await provider.classify({ tokens: ['Glycerin'] });

    expect(cacheRepository.upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          normalized_token: 'glycerin',
          model: 'ingredient-analysis-model',
          category: IngredientCategory.Humectant,
        }),
      ],
      ['cache_key'],
    );
  });
});

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { TranslationService } from './translation.service';

function buildConfig(
  values: Record<string, string | undefined>,
): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function buildDataSource(): DataSource {
  return {
    query: jest.fn(async (sql: string) =>
      sql.includes('SELECT source_hash') ? [] : undefined,
    ),
  } as unknown as DataSource;
}

function readRequestedSources(init: RequestInit | undefined): string[] {
  const rawBody = init?.body;
  if (typeof rawBody !== 'string') {
    throw new Error('Translation request body was not a string');
  }

  const body = JSON.parse(rawBody) as {
    input?: Array<{
      role?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
  };
  const userText = body.input
    ?.find((item) => item.role === 'user')
    ?.content?.find((content) => content.type === 'input_text')?.text;

  if (!userText) {
    throw new Error('Translation request did not include user text');
  }

  const parsed = JSON.parse(userText) as {
    source?: string;
    sources?: string[];
  };

  if (Array.isArray(parsed.sources)) {
    return parsed.sources;
  }

  return typeof parsed.source === 'string' ? [parsed.source] : [];
}

function buildTranslationResponse(sources: string[]): Response {
  return new Response(
    JSON.stringify({
      output_text: JSON.stringify({
        translations: sources.map((source) => `sv:${source}`),
        translation: sources.length === 1 ? `sv:${sources[0]}` : undefined,
      }),
    }),
    { status: 200 },
  );
}

describe('TranslationService', () => {
  const originalFetch = global.fetch;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('batches unique cache misses, preserves order, and caps LLM concurrency', async () => {
    const service = new TranslationService(
      buildConfig({
        OPENAI_API_KEY: 'sk-test',
        INGREDIENT_TRANSLATION_AI_MODEL: 'ingredient-translation-model',
        OPENAI_MODEL: 'fallback-model',
        INGREDIENT_TRANSLATION_SOURCE_LANGUAGE: 'en',
      }),
      buildDataSource(),
    );
    const sourceTexts = Array.from(
      { length: 45 },
      (_, index) => `Text ${index}`,
    );
    const inputs = [
      sourceTexts[0],
      sourceTexts[1],
      sourceTexts[0],
      '',
      ...sourceTexts.slice(2),
    ];
    let activeRequests = 0;
    let maxActiveRequests = 0;

    global.fetch = jest.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        activeRequests += 1;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        await new Promise((resolve) => setTimeout(resolve, 1));
        activeRequests -= 1;
        return buildTranslationResponse(readRequestedSources(init));
      },
    );

    const result = await service.translateMany(inputs, 'sv');

    expect(global.fetch).toHaveBeenCalledTimes(3);
    const [, firstInit] = (global.fetch as jest.Mock).mock.calls[0];
    const firstBody = JSON.parse(String(firstInit.body)) as { model?: string };
    expect(firstBody.model).toBe('ingredient-translation-model');
    expect(maxActiveRequests).toBeLessThanOrEqual(2);
    expect(result[0]).toBe('sv:Text 0');
    expect(result[1]).toBe('sv:Text 1');
    expect(result[2]).toBe('sv:Text 0');
    expect(result[3]).toBe('');
    expect(result.at(-1)).toBe('sv:Text 44');
  });

  it('falls back to source text for a failed translation chunk only', async () => {
    const service = new TranslationService(
      buildConfig({
        OPENAI_API_KEY: 'sk-test',
        INGREDIENT_TRANSLATION_AI_MODEL: 'ingredient-translation-model',
        INGREDIENT_TRANSLATION_SOURCE_LANGUAGE: 'en',
      }),
      buildDataSource(),
    );

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockImplementation(
        async (_url: string | URL | Request, init?: RequestInit) =>
          buildTranslationResponse(readRequestedSources(init)),
      ) as jest.MockedFunction<typeof fetch>;

    const result = await service.translateMany(
      Array.from({ length: 22 }, (_, index) => `Text ${index}`),
      'sv',
    );

    expect(result.slice(0, 20)).toEqual(
      Array.from({ length: 20 }, (_, index) => `Text ${index}`),
    );
    expect(result[20]).toBe('sv:Text 20');
    expect(result[21]).toBe('sv:Text 21');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('falls back to OPENAI_MODEL when the ingredient translation model is missing', async () => {
    const service = new TranslationService(
      buildConfig({
        OPENAI_API_KEY: 'sk-test',
        INGREDIENT_TRANSLATION_AI_MODEL: '',
        OPENAI_MODEL: 'fallback-model',
        INGREDIENT_TRANSLATION_SOURCE_LANGUAGE: 'en',
      }),
      buildDataSource(),
    );

    global.fetch = jest.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        buildTranslationResponse(readRequestedSources(init)),
    );

    await service.translateMany(['Text 0'], 'sv');

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(String(init.body)) as { model?: string };
    expect(body.model).toBe('fallback-model');
  });
});

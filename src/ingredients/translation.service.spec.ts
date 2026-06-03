import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { TranslationService } from './translation.service';

function buildConfig(
  values: Record<string, string | undefined>,
): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => {
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        return values[key];
      }
      throw new Error(`Missing config ${key}`);
    }),
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
  const body = readOpenAiRequestBody(init);
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

function readOpenAiRequestBody(init: RequestInit | undefined): {
  input?: Array<{
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  model?: string;
  store?: boolean;
  temperature?: number;
  max_output_tokens?: number;
  reasoning?: { effort?: string };
  text?: {
    verbosity?: string;
    format?: {
      type?: string;
      name?: string;
      strict?: boolean;
      schema?: {
        required?: string[];
        properties?: {
          translations?: {
            type?: string;
            items?: { type?: string };
          };
        };
      };
    };
  };
} {
  const rawBody = init?.body;
  if (typeof rawBody !== 'string') {
    throw new Error('Translation request body was not a string');
  }

  return JSON.parse(rawBody) as {
    input?: Array<{
      role?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
    model?: string;
    store?: boolean;
    temperature?: number;
    max_output_tokens?: number;
    reasoning?: { effort?: string };
    text?: {
      verbosity?: string;
      format?: {
        type?: string;
        name?: string;
        strict?: boolean;
        schema?: {
          required?: string[];
          properties?: {
            translations?: {
              type?: string;
              items?: { type?: string };
            };
          };
        };
      };
    };
  };
}

function readTranslationPromptPayload(init: RequestInit | undefined): {
  sourceLanguage?: string;
  targetLanguage?: string;
  sourceCount?: number;
  sources?: string[];
} {
  const body = readOpenAiRequestBody(init);
  const userText = body.input
    ?.find((item) => item.role === 'user')
    ?.content?.find((content) => content.type === 'input_text')?.text;
  if (!userText) {
    throw new Error('Translation request did not include user text');
  }

  return JSON.parse(userText) as {
    sourceLanguage?: string;
    targetLanguage?: string;
    sourceCount?: number;
    sources?: string[];
  };
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
    const firstBody = readOpenAiRequestBody(firstInit as RequestInit);
    expect(firstBody.model).toBe('ingredient-translation-model');
    expect(firstBody.store).toBe(false);
    expect(firstBody.temperature).toBe(0);
    expect(firstBody.text?.verbosity).toBe('low');
    expect(firstBody.text?.format).toMatchObject({
      type: 'json_schema',
      name: 'ritora_ingredient_translation',
      strict: true,
    });
    expect(firstBody.text?.format?.schema?.required).toEqual(['translations']);
    expect(
      firstBody.text?.format?.schema?.properties?.translations,
    ).toMatchObject({
      type: 'array',
      items: { type: 'string' },
    });
    const systemPrompt =
      firstBody.input
        ?.find((item) => item.role === 'system')
        ?.content?.find((content) => content.type === 'input_text')?.text ?? '';
    expect(systemPrompt).toContain(
      'Role: translate Ritora skincare and ingredient-intelligence reference copy',
    );
    expect(systemPrompt).toContain('Decision inputs:');
    expect(systemPrompt).toContain('sourceLanguage, targetLanguage');
    expect(systemPrompt).toContain('Do not infer extra product');
    expect(systemPrompt).toContain('Hard rules:');
    expect(systemPrompt).toContain('Preserve order');
    expect(systemPrompt).toContain('Do not merge, split, drop');
    expect(systemPrompt).toContain(
      'Copy brand names, product names, INCI names',
    );
    expect(systemPrompt).toContain(
      'copy scientific ingredient wording exactly',
    );
    expect(systemPrompt).toContain('including casing and spacing');
    expect(systemPrompt).toContain(
      'Do not replace protected terms with localized forms',
    );
    expect(systemPrompt).toContain('Generic skincare nouns are not protected');
    expect(systemPrompt).toContain(
      'translate words like sunscreen, cleanser, moisturizer',
    );
    expect(systemPrompt).toContain('Safety and medical meaning');
    expect(systemPrompt).toContain(
      'Translate caution and uncertainty wording into the target language',
    );
    expect(systemPrompt).toContain('"may" and "can" should become "kan"');
    expect(systemPrompt).toContain(
      'Do not leave English caution words untranslated',
    );
    expect(systemPrompt).toContain('Keep the same sentence count');
    expect(systemPrompt).toContain('Do not summarize or expand');
    expect(systemPrompt).toContain('copy line breaks, bullet markers');
    expect(systemPrompt).toContain('Notes authority');
    expect(systemPrompt).toContain('JSON output');
    expect(systemPrompt).not.toContain('common lay name');
    expect(systemPrompt).not.toContain('small change');
    expect(systemPrompt).not.toContain('where practical');
    expect(systemPrompt).not.toContain('Preserve hedging words');
    const promptPayload = readTranslationPromptPayload(
      firstInit as RequestInit,
    );
    expect(promptPayload).toMatchObject({
      sourceLanguage: 'en',
      targetLanguage: 'sv',
      sourceCount: 20,
    });
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
    const body = readOpenAiRequestBody(init as RequestInit);
    expect(body.model).toBe('fallback-model');
  });

  it('falls back to source text when the LLM returns the wrong translation count', async () => {
    const service = new TranslationService(
      buildConfig({
        OPENAI_API_KEY: 'sk-test',
        INGREDIENT_TRANSLATION_AI_MODEL: 'ingredient-translation-model',
        INGREDIENT_TRANSLATION_SOURCE_LANGUAGE: 'en',
      }),
      buildDataSource(),
    );

    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            translations: ['sv:Text 0'],
          }),
        }),
        { status: 200 },
      ),
    );

    const result = await service.translateMany(['Text 0', 'Text 1'], 'sv');

    expect(result).toEqual(['Text 0', 'Text 1']);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('restores protected ingredient terms when the translation localizes them', async () => {
    const service = new TranslationService(
      buildConfig({
        OPENAI_API_KEY: 'sk-test',
        INGREDIENT_TRANSLATION_AI_MODEL: 'ingredient-translation-model',
        INGREDIENT_TRANSLATION_SOURCE_LANGUAGE: 'en',
      }),
      buildDataSource(),
    );

    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            translations: [
              'Niacinamid kan stödja hudbarriären.',
              'Salicylsyra kan kännas uttorkande.',
            ],
          }),
        }),
        { status: 200 },
      ),
    );

    const result = await service.translateMany(
      [
        'Niacinamide can support the skin barrier.',
        'Salicylic acid can feel drying.',
      ],
      'sv',
    );

    expect(result).toEqual([
      'Niacinamide kan stödja hudbarriären.',
      'Salicylic acid kan kännas uttorkande.',
    ]);
  });
});

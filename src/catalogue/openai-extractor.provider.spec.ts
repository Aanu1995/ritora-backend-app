import { ConfigService } from '@nestjs/config';
import { OPENAI_CATALOGUE_REASONING_EFFORT } from '../common/utils/openai-request-options';
import {
  CatalogueSource,
  DataProvenance,
  LookupConfidence,
  ProductCategory,
} from '../shelf/shelf.types';
import {
  OPENAI_EXTRACTION_STRUCTURED_OUTPUT_ATTEMPTS,
  OPENAI_OFFICIAL_DISCOVERY_MAX_OUTPUT_TOKENS,
  OPENAI_PHOTO_INGREDIENT_RECOVERY_MAX_OUTPUT_TOKENS,
  OPENAI_PRODUCT_DISCOVERY_MAX_OUTPUT_TOKENS,
  OPENAI_PRODUCT_EXTRACTION_MAX_OUTPUT_TOKENS,
  OpenAiExtractorProvider,
} from './openai-extractor.provider';

function buildConfig(
  values: Record<string, number | string | undefined>,
): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function buildProvider(
  overrides: Record<string, number | string | undefined> = {},
): OpenAiExtractorProvider {
  return new OpenAiExtractorProvider(
    buildConfig({
      OPENAI_API_KEY: 'sk-test',
      CATALOGUE_AI_MODEL: 'catalogue-model',
      OPENAI_MODEL: 'fallback-model',
      ...overrides,
    }),
  );
}

function mockFetchJson(output: unknown): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      output_text: JSON.stringify(output),
    }),
  });
}

function lastRequestBody(): Record<string, unknown> {
  return requestBodyAt(-1);
}

function requestBodyAt(index: number): Record<string, unknown> {
  const call =
    index < 0
      ? (global.fetch as jest.Mock).mock.calls.at(index)
      : (global.fetch as jest.Mock).mock.calls[index];
  if (!call) {
    throw new Error(`Missing fetch call at index ${index}`);
  }
  const [, init] = call;
  const body = (init as RequestInit | undefined)?.body;
  if (typeof body !== 'string') {
    throw new Error(`Fetch call at index ${index} has no JSON body`);
  }
  return JSON.parse(body) as Record<string, unknown>;
}

function buildProductOutput(
  name = 'Glycolic Acid Daily Toner',
  inciIngredients: string[] = ['Aqua'],
) {
  return {
    identity: {
      brand: 'Q+A',
      name,
      category: ProductCategory.Toner,
      sizeMl: 100,
      description: 'A daily exfoliating toner.',
      benefits: ['exfoliating'],
      suitedFor: ['oily skin'],
      inciIngredients,
    },
    guidance: {
      applicationMethod: null,
      quantity: null,
      steps: [],
      cautions: [],
      waitMinutes: null,
    },
    manufacturer: {
      supportEmail: null,
      countryOfOrigin: null,
      countryOfManufacture: null,
      parentCompany: null,
      productUrl: null,
      websiteUrl: null,
    },
  };
}

function buildDraft() {
  return {
    identity: {
      brand: 'Q+A',
      name: 'Glycolic Acid Daily Toner',
      category: ProductCategory.Toner,
    },
    guidance: {},
    manufacturer: {},
    provenance: DataProvenance.PhotoLookup,
    source: CatalogueSource.UserPhotos,
    confidence: LookupConfidence.Low,
    reviewRequired: true,
    warnings: [],
    evidence: [],
    cacheKey: { source: CatalogueSource.UserPhotos, id: null, url: null },
    rawSource: { photoExtraction: { brand: 'Q+A' } },
  };
}

describe('OpenAiExtractorProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('uses strict structured outputs for product extraction', async () => {
    const provider = buildProvider();
    mockFetchJson(buildProductOutput());

    const result = await provider.extract({
      identity: {},
      guidance: {},
      manufacturer: {},
      evidence: [],
      rawSource: {},
      textExcerpt: null,
    });

    expect(result?.data.identity?.name).toBe('Glycolic Acid Daily Toner');
    const body = lastRequestBody();
    expect(body.model).toBe('catalogue-model');
    expect(body.store).toBe(false);
    expect(body.max_output_tokens).toBe(
      OPENAI_PRODUCT_EXTRACTION_MAX_OUTPUT_TOKENS,
    );
    expect(body.reasoning).toEqual({
      effort: OPENAI_CATALOGUE_REASONING_EFFORT,
    });
    expect(body.temperature).toBe(0);
    expect(body.text).toMatchObject({
      verbosity: 'low',
      format: {
        type: 'json_schema',
        name: 'ritora_product_extraction',
        strict: true,
      },
    });
    expect(
      (body.text as { format: { schema: { additionalProperties: boolean } } })
        .format.schema.additionalProperties,
    ).toBe(false);
  });

  it('uses strict structured outputs for official URL discovery', async () => {
    const provider = buildProvider();
    mockFetchJson({
      productUrls: ['https://brand.example/product'],
    });

    const urls = await provider.discoverOfficialProductUrls({
      query: 'Q+A Glycolic Acid Daily Toner',
      brand: 'Q+A',
      name: 'Glycolic Acid Daily Toner',
    });
    const cachedUrls = await provider.discoverOfficialProductUrls({
      query: 'q+a glycolic acid daily toner',
      brand: 'q+a',
      name: 'glycolic acid daily toner',
    });

    expect(urls).toEqual(['https://brand.example/product']);
    expect(cachedUrls).toEqual(['https://brand.example/product']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(lastRequestBody().text).toMatchObject({
      format: {
        type: 'json_schema',
        name: 'ritora_official_product_urls',
        strict: true,
      },
    });
    expect(lastRequestBody().max_output_tokens).toBe(
      OPENAI_OFFICIAL_DISCOVERY_MAX_OUTPUT_TOKENS,
    );
  });

  it('retries malformed structured extraction output before falling back', async () => {
    const provider = buildProvider();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output_text: '{"identity":{"brand":"Q+A","name":"Broken"',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output_text: JSON.stringify(buildProductOutput('Recovered Toner')),
        }),
      });

    const result = await provider.extract({
      identity: {},
      guidance: {},
      manufacturer: {},
      evidence: [],
      rawSource: {},
      textExcerpt: null,
    });

    expect(result?.data.identity?.name).toBe('Recovered Toner');
    expect(global.fetch).toHaveBeenCalledTimes(
      OPENAI_EXTRACTION_STRUCTURED_OUTPUT_ATTEMPTS,
    );
  });

  it('caches identical processed photo extraction requests', async () => {
    const provider = buildProvider();
    mockFetchJson(buildProductOutput('Cached Toner'));
    const input = {
      images: [
        {
          buffer: Buffer.from('processed-image'),
          mimetype: 'image/webp',
          sourceIndex: 0,
          isHero: true,
          variant: 'overview' as const,
          width: 1200,
          height: 900,
        },
      ],
      heroImageIndex: 0,
      sourceImageCount: 1,
    };

    const first = await provider.extractFromImages(input);
    const second = await provider.extractFromImages({
      ...input,
      images: [{ ...input.images[0], buffer: Buffer.from('processed-image') }],
    });

    expect(first?.data.identity?.name).toBe('Cached Toner');
    expect(second?.data.identity?.name).toBe('Cached Toner');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(lastRequestBody().max_output_tokens).toBe(
      OPENAI_PRODUCT_EXTRACTION_MAX_OUTPUT_TOKENS,
    );
  });

  it('runs targeted ingredient recovery when photo extraction has identity but no ingredients', async () => {
    const provider = buildProvider();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output_text: JSON.stringify(buildProductOutput('Daily SPF', [])),
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output_text: JSON.stringify({
            inciIngredients: [
              'Aqua',
              'Ethylhexyl Triazone',
              'Glycerin',
              'Niacinamide',
            ],
          }),
        }),
      });
    const input = {
      images: [
        {
          buffer: Buffer.from('hero-image'),
          mimetype: 'image/webp',
          sourceIndex: 0,
          isHero: true,
          variant: 'overview' as const,
        },
        {
          buffer: Buffer.from('label-image'),
          mimetype: 'image/webp',
          sourceIndex: 1,
          isHero: false,
          variant: 'text-enhanced' as const,
        },
      ],
      heroImageIndex: 0,
      sourceImageCount: 2,
    };

    const result = await provider.extractFromImages(input);

    expect(result?.data.identity?.inciIngredients).toEqual([
      'Aqua',
      'Ethylhexyl Triazone',
      'Glycerin',
      'Niacinamide',
    ]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(requestBodyAt(1).max_output_tokens).toBe(
      OPENAI_PHOTO_INGREDIENT_RECOVERY_MAX_OUTPUT_TOKENS,
    );
    expect(requestBodyAt(1).text).toMatchObject({
      format: {
        type: 'json_schema',
        name: 'ritora_photo_ingredient_recovery',
        strict: true,
      },
    });
    expect(JSON.stringify(requestBodyAt(1).input)).toContain(
      'ingredient-block recovery specialist',
    );
  });

  it('does not run ingredient recovery when photo extraction already has ingredients', async () => {
    const provider = buildProvider();
    mockFetchJson(buildProductOutput('Complete SPF', ['Aqua', 'Glycerin']));

    const result = await provider.extractFromImages({
      images: [
        {
          buffer: Buffer.from('complete-label'),
          mimetype: 'image/webp',
          sourceIndex: 0,
          isHero: true,
          variant: 'overview' as const,
        },
      ],
      heroImageIndex: 0,
      sourceImageCount: 1,
    });

    expect(result?.data.identity?.inciIngredients).toEqual([
      'Aqua',
      'Glycerin',
    ]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not cache failed photo extraction requests', async () => {
    const provider = buildProvider();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output_text: JSON.stringify(buildProductOutput()),
        }),
      });
    const input = {
      images: [{ buffer: Buffer.from('image'), mimetype: 'image/webp' }],
      heroImageIndex: 0,
    };

    const first = await provider.extractFromImages(input);
    const second = await provider.extractFromImages(input);

    expect(first).toBeNull();
    expect(second?.data.identity?.name).toBe('Glycolic Acid Daily Toner');
    expect(global.fetch).toHaveBeenCalledTimes(
      OPENAI_EXTRACTION_STRUCTURED_OUTPUT_ATTEMPTS + 1,
    );
  });

  it('caches identical web discovery completion requests', async () => {
    const provider = buildProvider();
    mockFetchJson(buildProductOutput('Completed Toner'));
    const draft = buildDraft();

    await provider.completeMissingFields(draft);
    await provider.completeMissingFields({ ...draft });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('uses the product model and shared reasoning for optional web discovery', async () => {
    const provider = buildProvider();
    const timeoutSpy = jest
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(new AbortController().signal);
    mockFetchJson(buildProductOutput('Fast Completion'));

    await provider.completeMissingFields(buildDraft());

    const body = lastRequestBody();
    expect(body.model).toBe('catalogue-model');
    expect(body.max_output_tokens).toBe(
      OPENAI_PRODUCT_DISCOVERY_MAX_OUTPUT_TOKENS,
    );
    expect(body.reasoning).toEqual({
      effort: OPENAI_CATALOGUE_REASONING_EFFORT,
    });
    expect(timeoutSpy).toHaveBeenCalledWith(20000);
  });

  it('falls back to OPENAI_MODEL when the catalogue model is not configured', async () => {
    const provider = buildProvider({
      CATALOGUE_AI_MODEL: '',
      OPENAI_MODEL: 'fallback-model',
    });
    mockFetchJson(buildProductOutput('Fallback Model Toner'));

    await provider.extract({
      identity: {},
      guidance: {},
      manufacturer: {},
      evidence: [],
      rawSource: {},
      textExcerpt: null,
    });

    expect(lastRequestBody().model).toBe('fallback-model');
  });

  it('logs optional web discovery timeouts as non-fatal enrichment skips', async () => {
    const provider = buildProvider();
    const warn = jest
      .spyOn(
        (provider as unknown as { logger: { warn: (message: string) => void } })
          .logger,
        'warn',
      )
      .mockImplementation(() => undefined);
    global.fetch = jest.fn().mockRejectedValue(
      Object.assign(new Error('The operation was aborted due to timeout'), {
        name: 'TimeoutError',
      }),
    );

    const result = await provider.completeMissingFields(buildDraft());

    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      'Optional OpenAI product discovery enrichment timed out after 20000ms; continuing with photo extraction result',
    );
  });
});

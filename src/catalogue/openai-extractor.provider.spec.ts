import { ConfigService } from '@nestjs/config';
import {
  CatalogueSource,
  DataProvenance,
  LookupConfidence,
  ProductCategory,
} from '../shelf/shelf.types';
import { OpenAiExtractorProvider } from './openai-extractor.provider';

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
      OPENAI_PRODUCT_DISCOVERY_REASONING_EFFORT: 'low',
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
  const [, init] = (global.fetch as jest.Mock).mock.calls.at(-1);
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

function buildProductOutput(name = 'Glycolic Acid Daily Toner') {
  return {
    identity: {
      brand: 'Q+A',
      name,
      category: ProductCategory.Toner,
      sizeMl: 100,
      description: 'A daily exfoliating toner.',
      benefits: ['exfoliating'],
      suitedFor: ['oily skin'],
      inciIngredients: ['Aqua'],
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
  });

  it('does not cache failed photo extraction requests', async () => {
    const provider = buildProvider();
    global.fetch = jest
      .fn()
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
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('caches identical web discovery completion requests', async () => {
    const provider = buildProvider();
    mockFetchJson(buildProductOutput('Completed Toner'));
    const draft = buildDraft();

    await provider.completeMissingFields(draft);
    await provider.completeMissingFields({ ...draft });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('uses the product model for optional web discovery with task-specific reasoning', async () => {
    const provider = buildProvider({
      OPENAI_PRODUCT_DISCOVERY_WEB_REASONING_EFFORT: 'none',
    });
    const timeoutSpy = jest
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(new AbortController().signal);
    mockFetchJson(buildProductOutput('Fast Completion'));

    await provider.completeMissingFields(buildDraft());

    const body = lastRequestBody();
    expect(body.model).toBe('catalogue-model');
    expect(body.reasoning).toBeUndefined();
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

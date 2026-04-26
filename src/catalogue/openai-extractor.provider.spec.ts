import { ConfigService } from '@nestjs/config';
import { ProductCategory } from '../shelf/shelf.types';
import { OpenAiExtractorProvider } from './openai-extractor.provider';

function buildConfig(
  values: Record<string, string | undefined>,
): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function buildProvider(): OpenAiExtractorProvider {
  return new OpenAiExtractorProvider(
    buildConfig({
      OPENAI_API_KEY: 'sk-test',
      OPENAI_PRODUCT_DISCOVERY_MODEL: 'gpt-5.4',
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

describe('OpenAiExtractorProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('uses strict structured outputs for product extraction', async () => {
    const provider = buildProvider();
    mockFetchJson({
      identity: {
        brand: 'Q+A',
        name: 'Glycolic Acid Daily Toner',
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
    });

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

    expect(urls).toEqual(['https://brand.example/product']);
    expect(lastRequestBody().text).toMatchObject({
      format: {
        type: 'json_schema',
        name: 'ritora_official_product_urls',
        strict: true,
      },
    });
  });
});

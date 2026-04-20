import { ProductPageDiscoveryProvider } from './product-page-discovery.provider';
import {
  CatalogueSource,
  DataProvenance,
  LookupConfidence,
} from '../shelf/shelf.types';

describe('ProductPageDiscoveryProvider', () => {
  const openAiExtractorProvider = {
    discoverOfficialProductUrls: jest.fn(),
  };
  const catalogueSourceRuleService = {
    evaluateUrl: jest.fn(),
  };

  let provider: ProductPageDiscoveryProvider;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    provider = new ProductPageDiscoveryProvider(
      openAiExtractorProvider as never,
      catalogueSourceRuleService as never,
    );
    fetchMock = jest.fn();
    global.fetch = fetchMock as never;

    openAiExtractorProvider.discoverOfficialProductUrls.mockReset();
    openAiExtractorProvider.discoverOfficialProductUrls.mockResolvedValue([]);
    catalogueSourceRuleService.evaluateUrl.mockReset();
    catalogueSourceRuleService.evaluateUrl.mockResolvedValue({
      blocked: false,
      scoreAdjustment: 0,
      matchedLabels: [],
    });
  });

  afterEach(() => {
    fetchMock.mockReset();
  });

  it('prefers known brand hosts over ingredient databases for discovery', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => `
        <html>
          <body>
            <a class="result__a" href="https://incidecoder.com/products/the-ordinary-azelaic-acid-suspension-10">
              The Ordinary Azelaic Acid Suspension 10% ingredients (Explained)
            </a>
            <div class="result__snippet">Ingredients explained</div>
            <a class="result__a" href="https://theordinary.com/en-us/azelaic-acid-suspension-10-100407.html">
              Azelaic Acid Suspension 10% - The Ordinary
            </a>
            <div class="result__snippet">Official The Ordinary product page</div>
          </body>
        </html>
      `,
    });

    const results = await provider.discover({
      identity: {
        brand: 'The Ordinary',
        name: 'Azelaic Acid Suspension 10%',
      },
      manufacturer: {},
      guidance: {},
      provenance: DataProvenance.Catalogue,
      source: CatalogueSource.OfficialPage,
      confidence: LookupConfidence.Low,
      reviewRequired: true,
      warnings: [],
      evidence: [],
      cacheKey: {
        source: CatalogueSource.OfficialPage,
        id: null,
        url: null,
      },
      rawSource: {},
    });

    expect(results[0]?.url).toBe(
      'https://theordinary.com/en-us/azelaic-acid-suspension-10-100407.html',
    );
    expect(
      results.some((result) => result.url.includes('incidecoder.com')),
    ).toBe(true);
  });
});

import { SuggestionEvidenceSourceId } from '../../suggestions/suggestions.constants';
import { GeneratedSmartPick } from './smart-picks-ai-generator';
import { SmartPicksRetailerVerifierService } from './smart-picks-retailer-verifier.service';

describe('SmartPicksRetailerVerifierService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('marks a pick as retailer-verified when at least one safe retailer URL responds', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(response(200));
    const verifier = new SmartPicksRetailerVerifierService();

    const result = await verifier.verifyGeneratedPick(generatedPick());

    expect(result.verificationStatus).toBe('retailer_verified');
    expect(result.availabilityStatus).toBe('local');
    expect(result.retailers).toEqual([
      expect.objectContaining({
        name: 'Derm Store',
        inStock: true,
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/spf',
      expect.objectContaining({ method: 'HEAD', redirect: 'manual' }),
    );
  });

  it('does not fetch unsafe retailer URLs and downgrades availability to unknown', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    const verifier = new SmartPicksRetailerVerifierService();

    const result = await verifier.verifyGeneratedPick(
      generatedPick({
        availabilityStatus: 'local',
        retailers: [
          {
            name: 'Localhost',
            url: 'http://127.0.0.1:3000/private',
            priceCents: 2200,
            currency: 'USD',
            inStock: true,
            isAffiliate: false,
          },
        ],
      }),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.verificationStatus).toBe('retailer_unverified');
    expect(result.availabilityStatus).toBe('unknown');
    expect(result.retailers).toEqual([]);
  });

  it('blocks redirects to private hosts while verifying retailer URLs', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(
      response(302, { location: 'http://localhost:3001/admin' }),
    );
    const verifier = new SmartPicksRetailerVerifierService();

    const result = await verifier.verifyGeneratedPick(generatedPick());

    expect(result.verificationStatus).toBe('retailer_unverified');
    expect(result.availabilityStatus).toBe('unknown');
    expect(result.retailers[0]).toEqual(
      expect.objectContaining({ inStock: false }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to a minimal GET when a retailer blocks HEAD requests', async () => {
    const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
    fetchMock.mockResolvedValueOnce(response(405));
    fetchMock.mockResolvedValueOnce(response(200));
    const verifier = new SmartPicksRetailerVerifierService();

    const result = await verifier.verifyGeneratedPick(generatedPick());

    expect(result.verificationStatus).toBe('retailer_verified');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://example.com/spf',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Range: 'bytes=0-0' }),
      }),
    );
  });
});

function generatedPick(
  overrides: Partial<GeneratedSmartPick> = {},
): GeneratedSmartPick {
  return {
    brand: 'Good Brand',
    productName: 'Mineral SPF 50',
    budgetTier: 'mid',
    priceCents: 2200,
    currency: 'USD',
    retailers: [
      {
        name: 'Derm Store',
        url: 'https://example.com/spf',
        priceCents: 2200,
        currency: 'USD',
        inStock: true,
        isAffiliate: false,
      },
    ],
    reasoningChips: [],
    reasoningFacts: {},
    ruledOut: [],
    sourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
    alternatives: [],
    verificationStatus: 'ai_named',
    availabilityStatus: 'local',
    recommendationRankReason: 'Best match.',
    localAlternativeReason: null,
    ...overrides,
  };
}

function response(status: number, headers: Record<string, string> = {}) {
  return {
    status,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  } as Response;
}

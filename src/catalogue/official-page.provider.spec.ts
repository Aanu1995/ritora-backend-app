import { OfficialPageProvider } from './official-page.provider';

const PRODUCT_HTML = `
  <html>
    <head>
      <title>Glycolic Acid Daily Toner | Q+A</title>
      <meta property="og:site_name" content="Q+A" />
      <script type="application/ld+json">
        {
          "@type": "Product",
          "name": "Glycolic Acid Daily Toner",
          "description": "A daily exfoliating toner for oily skin.",
          "brand": { "name": "Q+A" }
        }
      </script>
    </head>
    <body>
      <h1>Glycolic Acid Daily Toner</h1>
      <p>Ingredients: Aqua, Glycerin, Glycolic Acid.</p>
    </body>
  </html>
`;

function mockHtmlResponse(html: string): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: {
      get: jest.fn((name: string) =>
        name.toLowerCase() === 'content-type' ? 'text/html' : null,
      ),
    },
    text: async () => html,
  });
}

describe('OfficialPageProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('caches successful official page extraction by product URL', async () => {
    const provider = new OfficialPageProvider();
    mockHtmlResponse(PRODUCT_HTML);

    const first = await provider.extract('https://example.com/products/toner');
    const second = await provider.extract('https://example.com/products/toner');

    expect(first?.identity.name).toBe('Glycolic Acid Daily Toner');
    expect(second?.identity.name).toBe('Glycolic Acid Daily Toner');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not cache failed official page extraction', async () => {
    const provider = new OfficialPageProvider();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: { get: jest.fn() },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: jest.fn((name: string) =>
            name.toLowerCase() === 'content-type' ? 'text/html' : null,
          ),
        },
        text: async () => PRODUCT_HTML,
      });

    const first = await provider.extract('https://example.com/products/toner');
    const second = await provider.extract('https://example.com/products/toner');

    expect(first).toBeNull();
    expect(second?.identity.name).toBe('Glycolic Acid Daily Toner');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

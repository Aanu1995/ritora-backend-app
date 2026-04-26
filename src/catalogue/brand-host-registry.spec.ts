import {
  getKnownBrandHostPatterns,
  getPreferredBrandHostPatterns,
  inferKnownBrandFromQuery,
  urlMatchesHostPatterns,
  urlMatchesKnownBrandHost,
} from './brand-host-registry';

describe('brand-host-registry', () => {
  it('finds known brand host patterns by brand and alias', () => {
    expect(getKnownBrandHostPatterns('CeraVe')).toEqual(
      expect.arrayContaining(['cerave.com', 'cerave.co.uk']),
    );
    expect(getKnownBrandHostPatterns('La Roche Posay')).toEqual(
      expect.arrayContaining(['laroche-posay.com']),
    );
    expect(getKnownBrandHostPatterns('unknown brand')).toEqual([]);
  });

  it('infers brands from product-style queries', () => {
    expect(
      inferKnownBrandFromQuery('best Supergoop unseen sunscreen SPF'),
    ).toMatchObject({
      brand: 'Supergoop!',
      hostPatterns: ['supergoop.com'],
    });
    expect(inferKnownBrandFromQuery('')).toBeNull();
    expect(inferKnownBrandFromQuery(null)).toBeNull();
  });

  it('combines direct and query-inferred host preferences without duplicates', () => {
    expect(
      getPreferredBrandHostPatterns({
        brand: 'CeraVe',
        query: 'CeraVe moisturizing cream',
      }),
    ).toEqual(
      expect.arrayContaining(['cerave.com', 'cerave.ca', 'cerave.co.uk']),
    );

    expect(
      getPreferredBrandHostPatterns({
        brand: null,
        query: 'Round Lab birch juice sunscreen',
      }),
    ).toEqual(expect.arrayContaining(['roundlab.co.kr', 'roundlab.com']));
  });

  it('matches official brand URLs and distinguishes unknown brands', () => {
    expect(
      urlMatchesKnownBrandHost(
        'https://shop.cerave.com/products/moisturizer',
        'CeraVe',
      ),
    ).toBe(true);
    expect(
      urlMatchesKnownBrandHost(
        'https://example.com/products/moisturizer',
        'CeraVe',
      ),
    ).toBe(false);
    expect(urlMatchesKnownBrandHost('not a url', 'CeraVe')).toBe(false);
    expect(
      urlMatchesKnownBrandHost('https://example.com', 'unknown'),
    ).toBeNull();
  });

  it('matches arbitrary host pattern collections safely', () => {
    expect(
      urlMatchesHostPatterns('https://www.example.com/path', [
        ' example.com ',
        '',
        'EXAMPLE.com',
      ]),
    ).toBe(true);
    expect(urlMatchesHostPatterns('https://example.org', ['example.com'])).toBe(
      false,
    );
    expect(urlMatchesHostPatterns('not a url', ['example.com'])).toBe(false);
    expect(urlMatchesHostPatterns('https://example.com', [])).toBe(false);
  });
});

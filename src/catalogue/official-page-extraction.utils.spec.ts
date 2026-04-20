import { extractOfficialPageExtraction } from './official-page-extraction.utils';

describe('extractOfficialPageExtraction', () => {
  it('does not truncate long ingredient sections at the first period', () => {
    const html = `
      <html>
        <head>
          <title>CeraVe SA Smoothing Cleanser</title>
          <meta property="og:site_name" content="CeraVe" />
        </head>
        <body>
          <h1>SA Smoothing Cleanser</h1>
          <p>
            Ingredients: Aqua / Water, Sodium Lauroyl Sarcosinate,
            Cocamidopropyl Hydroxysultaine, Glycerin, Niacinamide,
            Gluconolactone, Sodium Methyl Cocoyl Taurate, PEG-150
            Pentaerythrityl Tetrastearate, Ceramide NP, Ceramide AP,
            Ceramide EOP, Carbomer, Calcium Gluconate, Salicylic Acid,
            Sodium Benzoate, Sodium Hydroxide.
            How to use: Massage cleanser onto wet skin and rinse.
          </p>
        </body>
      </html>
    `;

    const extraction = extractOfficialPageExtraction(
      html,
      'https://www.cerave.com/skincare/cleansers/sa-smoothing-cleanser',
    );

    expect(extraction.identity.inciIngredients).toEqual([
      'Aqua / Water',
      'Sodium Lauroyl Sarcosinate',
      'Cocamidopropyl Hydroxysultaine',
      'Glycerin',
      'Niacinamide',
      'Gluconolactone',
      'Sodium Methyl Cocoyl Taurate',
      'PEG-150 Pentaerythrityl Tetrastearate',
      'Ceramide NP',
      'Ceramide AP',
      'Ceramide EOP',
      'Carbomer',
      'Calcium Gluconate',
      'Salicylic Acid',
      'Sodium Benzoate',
      'Sodium Hydroxide',
    ]);
    expect(extraction.guidance.steps).toEqual([
      'Massage cleanser onto wet skin and rinse.',
    ]);
  });

  it('cleans url-derived fallback names before returning them', () => {
    const html = `
      <html>
        <head>
          <meta property="og:site_name" content="The Ordinary" />
        </head>
        <body>
          <p>Simple product page with no structured title.</p>
        </body>
      </html>
    `;

    const extraction = extractOfficialPageExtraction(
      html,
      'https://example.com/products/azelaic-acid-suspension-10-exfoliator-100407.html',
    );

    expect(extraction.identity.name).toBe(
      'Azelaic Acid Suspension 10 Exfoliator',
    );
  });

  it('extracts ingredient links from ingredient-database style pages', () => {
    const html = `
      <html>
        <head>
          <title>The Ordinary Azelaic Acid Suspension 10%</title>
          <meta property="og:site_name" content="INCIDecoder" />
        </head>
        <body>
          <h2>Ingredients overview</h2>
          <div id="ingredlist-short">
            <div>
              <span><a class="ingred-link" href="/ingredients/water">Aqua (Water)</a></span>
              <span><a class="ingred-link" href="/ingredients/dimethicone">Dimethicone</a></span>
              <span><a class="ingred-link" href="/ingredients/azelaic-acid">Azelaic Acid 10.0%</a></span>
            </div>
          </div>
        </body>
      </html>
    `;

    const extraction = extractOfficialPageExtraction(
      html,
      'https://incidecoder.com/products/the-ordinary-azelaic-acid-suspension-10',
    );

    expect(extraction.identity.name).toBe(
      'The Ordinary Azelaic Acid Suspension 10%',
    );
    expect(extraction.identity.inciIngredients).toEqual([
      'Aqua (Water)',
      'Dimethicone',
      'Azelaic Acid',
    ]);
  });
});

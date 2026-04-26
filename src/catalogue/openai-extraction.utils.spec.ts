import {
  toExtractionResult,
  type OpenAiResponsePayload,
} from './openai-extraction.utils';
import { ApplicationMethod, Quantity } from '../shelf/shelf.types';

describe('openai extraction utils', () => {
  it('drops sentence-like ingredient output instead of returning prose', () => {
    const payload: OpenAiResponsePayload = {
      output: [
        {
          type: 'web_search_call',
          action: {
            sources: [
              {
                type: 'url',
                url: 'https://example.com/product',
              },
            ],
          },
        },
      ],
    };

    const result = toExtractionResult(
      {
        identity: {
          inciIngredients: [
            'Azelaic Acid Product Details Azelaic Acid Suspension 10% is a cream-like brightening formulation that improves the look of uneven skin tone.',
            'This formulation is suitable for all skin types.',
            'Dimethicone',
          ],
        },
      },
      payload,
    );

    expect(result?.data.identity?.inciIngredients).toEqual(['Dimethicone']);
  });

  it('drops claim, footer, and usage fragments from ingredient output', () => {
    const payload: OpenAiResponsePayload = {
      output: [
        {
          type: 'web_search_call',
          action: {
            sources: [
              {
                type: 'url',
                url: 'https://example.com/product',
              },
            ],
          },
        },
      ],
    };

    const result = toExtractionResult(
      {
        identity: {
          inciIngredients: [
            'Free of physical exfoliants',
            'Fragrance-free',
            'Aqua / Water',
            'Sodium Lauroyl Sarcosinate',
            'Massage cleanser onto wet skin',
            '(236 ml)',
            'Privacy Policy',
          ],
        },
      },
      payload,
    );

    expect(result?.data.identity?.inciIngredients).toEqual([
      'Aqua / Water',
      'Sodium Lauroyl Sarcosinate',
    ]);
  });

  it('normalizes application method and quantity from enum or usage text', () => {
    const result = toExtractionResult(
      {
        guidance: {
          steps: ['Apply a few drops to a cotton pad and gently apply to skin'],
        },
      },
      {},
    );

    expect(result?.data.guidance?.applicationMethod).toBe(
      ApplicationMethod.CottonPad,
    );
    expect(result?.data.guidance?.quantity).toBe(Quantity.TwoToThreeDrops);
  });

  it('normalizes benefits and suited-for values from noisy label sections', () => {
    const result = toExtractionResult(
      {
        identity: {
          benefits: [
            'How does it help? Anti-Ageing, Calming, Pore Minimising',
            'Brightening',
            'Skin Firming',
            'Hydrating',
            'Oily skin',
            'View Product',
          ],
          suitedFor: [
            'Skin type? Oily, Stressed, Dry, Sensitive, Normal, Combination',
            'Hydrating',
            'Shop now',
          ],
        },
      },
      {},
    );

    expect(result?.data.identity?.benefits).toEqual([
      'anti-aging',
      'calming',
      'pore-minimizing',
      'brightening',
      'firming',
      'hydrating',
    ]);
    expect(result?.data.identity?.suitedFor).toEqual([
      'oily skin',
      'stressed skin',
      'dry skin',
      'sensitive skin',
      'normal skin',
      'combination skin',
    ]);
  });

  it('extracts suited-for options from undelimited OCR text', () => {
    const result = toExtractionResult(
      {
        identity: {
          suitedFor: [
            'Skin type? Oily Stressed Dry Sensitive Normal Combination',
          ],
        },
      },
      {},
    );

    expect(result?.data.identity?.suitedFor).toEqual([
      'oily skin',
      'stressed skin',
      'dry skin',
      'sensitive skin',
      'normal skin',
      'combination skin',
    ]);
  });

  it('normalizes common non-English benefits and skin types to English', () => {
    const result = toExtractionResult(
      {
        identity: {
          benefits: [
            'Bienfaits: hydratante, apaisant, anti-age',
            'Hudproblem: rodnad',
          ],
          suitedFor: [
            'Convient aux peaux sensibles, peau seche',
            'Passar for fet hud',
          ],
        },
      },
      {},
    );

    expect(result?.data.identity?.benefits).toEqual([
      'hydrating',
      'soothing',
      'anti-aging',
      'redness relief',
    ]);
    expect(result?.data.identity?.suitedFor).toEqual([
      'sensitive skin',
      'dry skin',
      'oily skin',
    ]);
  });
});

import {
  toExtractionResult,
  type OpenAiResponsePayload,
} from './openai-extraction.utils';

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
});

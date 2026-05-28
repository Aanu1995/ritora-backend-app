import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  AnalysisConfidence,
  AnalysisMode,
  AnalysisStatus,
} from './ingredients.types';
import {
  OPENAI_PRODUCT_CHECK_REVIEW_MAX_OUTPUT_TOKENS,
  OPENAI_PRODUCT_CHECK_REVIEW_REQUEST_TIMEOUT_MS,
  OpenAiProductCheckReviewProvider,
} from './openai-product-check-review.provider';
import type { ProductCheckAiReviewInput } from './product-check-ai-review.port';
import {
  ProductCheckAiReviewStatus,
  ProductCheckNextAction,
  ProductCheckPersonalizationLevel,
  ProductCheckSource,
  ProductCheckTone,
  ProductCheckVerdict,
} from './product-check.types';
import { ProductCategory } from '../shelf/shelf.types';

function createConfigService(): ConfigService {
  return {
    get: jest.fn((key: string) => {
      if (key === 'OPENAI_API_KEY') return 'test-api-key';
      if (key === 'PRODUCT_CHECK_AI_MODEL') return 'gpt-5-mini';
      return undefined;
    }),
  } as unknown as ConfigService;
}

function createReviewInput(): ProductCheckAiReviewInput {
  return {
    analysis: {
      actives: [],
      confidence: AnalysisConfidence.High,
      conflicts: [],
      engineVersion: 'test',
      generatedAt: '2026-05-21T08:00:00.000Z',
      layeringOrder: [],
      mode: AnalysisMode.Focus,
      overlaps: [],
      productsMissingInci: [],
      safetyScore: 96,
      status: AnalysisStatus.Ok,
    },
    baselineVerdict: {
      confidence: AnalysisConfidence.High,
      generatedAt: '2026-05-21T08:00:00.000Z',
      label: ProductCheckVerdict.GoodFit,
      nextAction: ProductCheckNextAction.UseAsPlanned,
      reasons: [],
      safetyScore: 96,
      tone: ProductCheckTone.Positive,
    },
    context: {
      activeShelfProductCount: 2,
      level: ProductCheckPersonalizationLevel.Educational,
      missingSignals: [],
      recentJournalReactionCount: 0,
      recentSuggestionReactionCount: 0,
      usedSignals: [],
    },
    language: 'en',
    matchedIngredientNames: ['Water'],
    source: ProductCheckSource.IngredientPaste,
    product: {
      brand: 'Ritora',
      category: ProductCategory.Serum,
      id: 'checked-product',
      inciIngredients: ['Water'],
      name: 'Calm Serum',
    },
    reactionEvidence: [],
    unresolvedIngredientTokens: [],
    userId: 'user-1',
  };
}

describe('OpenAiProductCheckReviewProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('keeps the OpenAI timeout long enough for launch Quick Check requests', () => {
    expect(OPENAI_PRODUCT_CHECK_REVIEW_REQUEST_TIMEOUT_MS).toBe(180_000);
    expect(OPENAI_PRODUCT_CHECK_REVIEW_MAX_OUTPUT_TOKENS).toBe(24_000);
  });

  it('persists privacy-safe Quick Check AI cost metrics with user attribution and without product details', async () => {
    const query = jest.fn(async () => []);
    const fetchMock = jest.fn(async () => ({
      json: async () => ({
        output_text: JSON.stringify({
          confidence: AnalysisConfidence.High,
          ingredientNames: [],
          reasonCodes: [],
          suggestedVerdict: ProductCheckVerdict.GoodFit,
          summary: 'Looks compatible.',
        }),
        usage: {
          input_tokens: 1000,
          output_tokens: 100,
          total_tokens: 1100,
        },
      }),
      ok: true,
      status: 200,
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const provider = new OpenAiProductCheckReviewProvider(
      createConfigService(),
      { query } as unknown as DataSource,
    );

    const result = await provider.review(createReviewInput());

    expect(result.status).toBe(ProductCheckAiReviewStatus.Reviewed);
    const [, init] = (fetchMock as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const requestBody = JSON.parse(String(init?.body)) as {
      max_output_tokens?: number;
    };
    expect(requestBody.max_output_tokens).toBe(
      OPENAI_PRODUCT_CHECK_REVIEW_MAX_OUTPUT_TOKENS,
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('product_check_ai_review_metrics'),
      [
        expect.any(String),
        ProductCheckSource.IngredientPaste,
        ProductCheckAiReviewStatus.Reviewed,
        'gpt-5-mini',
        1000,
        100,
        1100,
        0.00021,
        expect.any(Number),
        expect.any(Date),
        'user-1',
      ],
    );
    expect(JSON.stringify(query.mock.calls)).not.toContain('Calm Serum');
    expect(JSON.stringify(query.mock.calls)).not.toContain('Water');
  });
});

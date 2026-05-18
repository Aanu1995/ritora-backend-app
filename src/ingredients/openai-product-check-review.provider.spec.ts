import { OPENAI_PRODUCT_CHECK_REVIEW_REQUEST_TIMEOUT_MS } from './openai-product-check-review.provider';

describe('OpenAiProductCheckReviewProvider', () => {
  it('keeps the OpenAI timeout long enough for launch Quick Check requests', () => {
    expect(
      OPENAI_PRODUCT_CHECK_REVIEW_REQUEST_TIMEOUT_MS,
    ).toBeGreaterThanOrEqual(45_000);
  });
});

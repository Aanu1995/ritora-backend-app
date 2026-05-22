import type {
  ProductCompareAiReview,
  ProductCompareAiReviewInput,
} from './product-compare.types';

export const PRODUCT_COMPARE_AI_REVIEW_PORT = Symbol(
  'PRODUCT_COMPARE_AI_REVIEW_PORT',
);

export interface ProductCompareAiReviewPort {
  review(input: ProductCompareAiReviewInput): Promise<ProductCompareAiReview>;
}

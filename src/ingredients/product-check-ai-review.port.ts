import type { AppLanguage } from '../common/i18n/i18n';
import type { AnalysisResult, ProductForAnalysis } from './ingredients.types';
import type {
  ProductCheckAiReview,
  ProductCheckContextSummary,
  ProductCheckSource,
  ProductCheckReactionEvidence,
  ProductCheckVerdictResult,
} from './product-check.types';

export const PRODUCT_CHECK_AI_REVIEW_PORT = Symbol(
  'PRODUCT_CHECK_AI_REVIEW_PORT',
);

export type ProductCheckAiReviewInput = {
  language: AppLanguage;
  source: ProductCheckSource;
  userId: string;
  product: ProductForAnalysis;
  analysis: AnalysisResult;
  context: ProductCheckContextSummary;
  baselineVerdict: ProductCheckVerdictResult;
  matchedIngredientNames: string[];
  unresolvedIngredientTokens: string[];
  reactionEvidence: ProductCheckReactionEvidence[];
};

export interface ProductCheckAiReviewPort {
  review(input: ProductCheckAiReviewInput): Promise<ProductCheckAiReview>;
}

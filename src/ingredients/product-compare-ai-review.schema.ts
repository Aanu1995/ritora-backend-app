import type { OpenAiTextFormat } from '../catalogue/openai-response-schemas';
import { AnalysisConfidence } from './ingredients.types';
import { ProductCompareReasonCode } from './product-compare.types';

export const PRODUCT_COMPARE_REVIEW_REASON_CODES = Object.values(
  ProductCompareReasonCode,
);
export const PRODUCT_COMPARE_REVIEW_CONFIDENCE =
  Object.values(AnalysisConfidence);

export const PRODUCT_COMPARE_REVIEW_FORMAT: OpenAiTextFormat = {
  type: 'json_schema',
  name: 'ritora_product_compare_review',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['preferredItemId', 'confidence', 'reasonCodes', 'summary'],
    properties: {
      preferredItemId: {
        type: ['string', 'null'],
      },
      confidence: {
        type: 'string',
        enum: PRODUCT_COMPARE_REVIEW_CONFIDENCE,
      },
      reasonCodes: {
        type: 'array',
        items: {
          type: 'string',
          enum: PRODUCT_COMPARE_REVIEW_REASON_CODES,
        },
      },
      summary: {
        type: ['string', 'null'],
      },
    },
  },
};

export type ParsedProductCompareAiReview = {
  preferredItemId?: string | null;
  confidence?: AnalysisConfidence;
  reasonCodes?: ProductCompareReasonCode[];
  summary?: string | null;
};

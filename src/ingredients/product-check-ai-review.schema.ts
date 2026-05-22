import type { OpenAiTextFormat } from '../catalogue/openai-response-schemas';
import { AnalysisConfidence } from './ingredients.types';
import {
  ProductCheckReasonCode,
  ProductCheckVerdict,
} from './product-check.types';

export const PRODUCT_CHECK_REVIEW_REASON_CODES = Object.values(
  ProductCheckReasonCode,
);
export const PRODUCT_CHECK_REVIEW_VERDICTS = Object.values(ProductCheckVerdict);
export const PRODUCT_CHECK_REVIEW_CONFIDENCE =
  Object.values(AnalysisConfidence);

export const PRODUCT_CHECK_REVIEW_FORMAT: OpenAiTextFormat = {
  type: 'json_schema',
  name: 'ritora_product_check_review',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'suggestedVerdict',
      'confidence',
      'reasonCodes',
      'ingredientNames',
      'summary',
    ],
    properties: {
      suggestedVerdict: {
        type: ['string', 'null'],
        enum: [...PRODUCT_CHECK_REVIEW_VERDICTS, null],
      },
      confidence: {
        type: 'string',
        enum: PRODUCT_CHECK_REVIEW_CONFIDENCE,
      },
      reasonCodes: {
        type: 'array',
        items: {
          type: 'string',
          enum: PRODUCT_CHECK_REVIEW_REASON_CODES,
        },
      },
      ingredientNames: {
        type: 'array',
        items: { type: 'string' },
      },
      summary: {
        type: ['string', 'null'],
      },
    },
  },
};

export type ParsedProductCheckAiReview = {
  suggestedVerdict?: ProductCheckVerdict | null;
  confidence?: AnalysisConfidence;
  reasonCodes?: ProductCheckReasonCode[];
  ingredientNames?: string[];
  summary?: string | null;
};

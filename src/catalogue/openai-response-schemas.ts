import {
  APPLICATION_METHOD_VALUES,
  PRODUCT_CATEGORY_VALUES,
  QUANTITY_VALUES,
} from '../shelf/shelf.constants';

type JsonSchema = Record<string, unknown>;

export type OpenAiTextFormat = {
  type: 'json_schema';
  name: string;
  strict: true;
  schema: JsonSchema;
};

const STRING_ARRAY_SCHEMA = {
  type: 'array',
  items: { type: 'string' },
};

const NULLABLE_STRING_SCHEMA = {
  type: ['string', 'null'],
};

const NULLABLE_NUMBER_SCHEMA = {
  type: ['number', 'null'],
};

export const OPENAI_PRODUCT_EXTRACTION_FORMAT: OpenAiTextFormat = {
  type: 'json_schema',
  name: 'ritora_product_extraction',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['identity', 'guidance', 'manufacturer'],
    properties: {
      identity: {
        type: 'object',
        additionalProperties: false,
        required: [
          'brand',
          'name',
          'category',
          'sizeMl',
          'description',
          'benefits',
          'suitedFor',
          'inciIngredients',
        ],
        properties: {
          brand: NULLABLE_STRING_SCHEMA,
          name: NULLABLE_STRING_SCHEMA,
          category: {
            type: ['string', 'null'],
            enum: [...PRODUCT_CATEGORY_VALUES, null],
          },
          sizeMl: NULLABLE_NUMBER_SCHEMA,
          description: NULLABLE_STRING_SCHEMA,
          benefits: STRING_ARRAY_SCHEMA,
          suitedFor: STRING_ARRAY_SCHEMA,
          inciIngredients: STRING_ARRAY_SCHEMA,
        },
      },
      guidance: {
        type: 'object',
        additionalProperties: false,
        required: [
          'applicationMethod',
          'quantity',
          'steps',
          'cautions',
          'waitMinutes',
        ],
        properties: {
          applicationMethod: {
            type: ['string', 'null'],
            enum: [...APPLICATION_METHOD_VALUES, null],
          },
          quantity: {
            type: ['string', 'null'],
            enum: [...QUANTITY_VALUES, null],
          },
          steps: STRING_ARRAY_SCHEMA,
          cautions: STRING_ARRAY_SCHEMA,
          waitMinutes: NULLABLE_NUMBER_SCHEMA,
        },
      },
      manufacturer: {
        type: 'object',
        additionalProperties: false,
        required: [
          'supportEmail',
          'countryOfOrigin',
          'countryOfManufacture',
          'parentCompany',
          'productUrl',
          'websiteUrl',
        ],
        properties: {
          supportEmail: NULLABLE_STRING_SCHEMA,
          countryOfOrigin: NULLABLE_STRING_SCHEMA,
          countryOfManufacture: NULLABLE_STRING_SCHEMA,
          parentCompany: NULLABLE_STRING_SCHEMA,
          productUrl: NULLABLE_STRING_SCHEMA,
          websiteUrl: NULLABLE_STRING_SCHEMA,
        },
      },
    },
  },
};

export const OPENAI_OFFICIAL_DISCOVERY_FORMAT: OpenAiTextFormat = {
  type: 'json_schema',
  name: 'ritora_official_product_urls',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['productUrls'],
    properties: {
      productUrls: STRING_ARRAY_SCHEMA,
    },
  },
};

export const OPENAI_PHOTO_INGREDIENT_RECOVERY_FORMAT: OpenAiTextFormat = {
  type: 'json_schema',
  name: 'ritora_photo_ingredient_recovery',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['inciIngredients'],
    properties: {
      inciIngredients: STRING_ARRAY_SCHEMA,
    },
  },
};

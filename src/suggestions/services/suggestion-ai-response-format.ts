import {
  SuggestionEvidenceSourceId,
  SUGGESTION_STEP_CHIP_TONES,
} from '../suggestions.constants';

const SOURCE_ID_ENUM = Object.values(SuggestionEvidenceSourceId);

export const RESPONSE_FORMAT = {
  type: 'json_schema',
  name: 'suggestion_response',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'simplifiedForReaction',
      'explanation',
      'steps',
      'gapRecommendations',
      'safetyFlags',
    ],
    properties: {
      simplifiedForReaction: { type: 'boolean' },
      explanation: {
        type: 'object',
        additionalProperties: false,
        required: ['headline', 'body', 'perStepReasons', 'skipped', 'inputs'],
        properties: {
          headline: { type: 'string' },
          body: { type: 'array', items: { type: 'string' } },
          perStepReasons: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['stepOrder', 'reason'],
              properties: {
                stepOrder: { type: 'integer' },
                reason: { type: 'string' },
              },
            },
          },
          skipped: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'reason'],
              properties: {
                name: { type: 'string' },
                reason: { type: 'string' },
              },
            },
          },
          inputs: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label', 'detail'],
              properties: {
                label: { type: 'string' },
                detail: { type: 'string' },
              },
            },
          },
        },
      },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'stepOrder',
            'routineStepId',
            'inventoryProductId',
            'productBrand',
            'productName',
            'stepLabel',
            'customLabel',
            'applicationMethod',
            'quantity',
            'waitAfterMinutes',
            'explanation',
            'provenance',
            'chips',
            'safetyWarnings',
          ],
          properties: {
            stepOrder: { type: 'integer' },
            routineStepId: { type: ['string', 'null'] },
            inventoryProductId: { type: ['string', 'null'] },
            productBrand: { type: ['string', 'null'] },
            productName: { type: ['string', 'null'] },
            stepLabel: { type: 'string' },
            customLabel: { type: ['string', 'null'] },
            applicationMethod: { type: ['string', 'null'] },
            quantity: { type: ['string', 'null'] },
            waitAfterMinutes: { type: ['integer', 'null'] },
            explanation: { type: ['string', 'null'] },
            provenance: {
              type: 'string',
              enum: ['specialist_locked', 'user_routine', 'ai_added'],
            },
            chips: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['tone', 'text'],
                properties: {
                  tone: {
                    type: 'string',
                    enum: SUGGESTION_STEP_CHIP_TONES,
                  },
                  text: { type: 'string' },
                },
              },
            },
            safetyWarnings: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'severity',
                  'message',
                  'ingredientSlugs',
                  'sourceIds',
                ],
                properties: {
                  severity: {
                    type: 'string',
                    enum: ['info', 'warning', 'critical'],
                  },
                  message: { type: 'string' },
                  ingredientSlugs: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  sourceIds: {
                    type: 'array',
                    items: { type: 'string', enum: SOURCE_ID_ENUM },
                  },
                },
              },
            },
          },
        },
      },
      gapRecommendations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'ingredientOrCategory',
            'reason',
            'budgetTier',
            'goalAlignment',
            'sourceIds',
          ],
          properties: {
            ingredientOrCategory: { type: 'string' },
            reason: { type: 'string' },
            budgetTier: {
              type: ['string', 'null'],
              enum: ['starter', 'mid', 'premium', null],
            },
            goalAlignment: { type: ['string', 'null'] },
            sourceIds: {
              type: 'array',
              items: { type: 'string', enum: SOURCE_ID_ENUM },
            },
          },
        },
      },
      safetyFlags: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['severity', 'message', 'ingredientSlugs', 'sourceIds'],
          properties: {
            severity: {
              type: 'string',
              enum: ['info', 'warning', 'critical'],
            },
            message: { type: 'string' },
            ingredientSlugs: {
              type: 'array',
              items: { type: 'string' },
            },
            sourceIds: {
              type: 'array',
              items: { type: 'string', enum: SOURCE_ID_ENUM },
            },
          },
        },
      },
    },
  },
} as const;

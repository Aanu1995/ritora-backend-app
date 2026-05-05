import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { toDateOnlyString } from '../../common/utils/date';
import { RoutineStep } from '../../schedule/entities/routine-step.entity';
import {
  SuggestionEvidenceSourceId,
  SuggestionExplanationJson,
  SuggestionGapRecommendationJson,
  SuggestionSafetyFlagJson,
  SuggestionStepChipJson,
  SuggestionStepProvenance,
} from '../suggestions.constants';
import type { SuggestionGenerationInputs } from './suggestion-ai-generator';

export const SYSTEM_PROMPT = [
  'You are a skincare suggestion engine for the Ritora app.',
  "Today's Suggestion is anchored to user-defined schedule slots.",
  'Hard rules:',
  '1. Specialist-locked steps are immutable. They MUST appear in the output with provenance="specialist_locked", same routineStepId, same product, same label, and in their original relative order. You may add other steps around them.',
  "2. Suggestions only use active products on the user's shelf or specialist-locked items. Never invent products.",
  '3. Missing products belong in gapRecommendations only, never in application steps.',
  '4. If a recent journal entry shows a reaction signal, simplify the routine to barrier mode and set simplifiedForReaction=true.',
  '5. Never use diagnostic language. Avoid words like diagnose, treat, cure, or prescribe.',
  '6. Base safety and recommendation reasoning on the trusted evidence summaries supplied in the prompt. Cite relevant sourceIds in safety flags, step warnings, and gap recommendations.',
  '7. Output is strictly valid JSON conforming to the provided schema.',
].join(' ');

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
                    enum: ['neutral', 'reason', 'ai', 'specialist', 'warn'],
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

export interface OpenAiResponsePayload {
  output?: {
    content?: { type: string; text?: string; refusal?: string }[];
  }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

export interface RawSuggestionResponse {
  simplifiedForReaction?: boolean;
  explanation?: SuggestionExplanationJson;
  steps?: RawSuggestionStepResponse[];
  gapRecommendations?: SuggestionGapRecommendationJson[];
  safetyFlags?: SuggestionSafetyFlagJson[];
}

export interface RawSuggestionStepResponse {
  stepOrder?: number;
  routineStepId?: string | null;
  inventoryProductId?: string | null;
  productBrand?: string | null;
  productName?: string | null;
  stepLabel?: string;
  customLabel?: string | null;
  applicationMethod?: string | null;
  quantity?: string | null;
  waitAfterMinutes?: number | null;
  explanation?: string | null;
  provenance?: SuggestionStepProvenance;
  chips?: SuggestionStepChipJson[];
  safetyWarnings?: SuggestionSafetyFlagJson[];
}

export function defaultExplanation(): SuggestionExplanationJson {
  return {
    headline: '',
    body: [],
    perStepReasons: [],
    skipped: [],
    inputs: [],
  };
}

export function buildPrompt(inputs: SuggestionGenerationInputs): string {
  const skin = inputs.skinProfile;
  const shelf = inputs.shelfActiveProducts.map(formatShelfProduct).join('\n');
  const lockedSteps = inputs.routineSteps
    .filter((step) => step.is_specialist_locked)
    .sort((a, b) => a.step_order - b.step_order)
    .map(formatRoutineStep('LOCKED'))
    .join('\n');
  const userSteps = inputs.routineSteps
    .filter((step) => !step.is_specialist_locked)
    .sort((a, b) => a.step_order - b.step_order)
    .map(formatRoutineStep('USER'))
    .join('\n');
  const recentJournal = inputs.recentJournalEntries
    .slice(0, 7)
    .map(
      (entry) =>
        `- ${toDateOnlyString(entry.entry_date)}: status=${entry.analysis_status}${
          entry.has_reaction_signal ? ', reactionSignal=true' : ''
        }`,
    )
    .join('\n');
  const recentApplications = inputs.recentApplications
    .slice(0, 14)
    .map(
      (log) =>
        `- ${toDateOnlyString(log.target_date)} ${log.daypart ?? '?'}: edited=${
          log.has_been_edited
        }, items=${log.items?.length ?? 0}`,
    )
    .join('\n');
  const evidenceSources = inputs.contextSummary.evidenceSources
    .map(
      (source) =>
        `- ${source.id}: ${source.organization}, ${source.title}. ${source.summary}`,
    )
    .join('\n');

  return [
    `Slot date: ${inputs.targetDate}, time: ${inputs.targetTime} (${inputs.daypart}).`,
    skin
      ? `Skin profile summary: type=${skin.skin_type ?? '?'}, sensitivity=${
          skin.sensitivity_level ?? '?'
        }, primaryGoal=${skin.primary_goal ?? '?'}.`
      : 'Skin profile: not set.',
    `Active shelf products:\n${shelf || '(none)'}`,
    `Specialist-locked steps (must remain exactly, in this order):\n${
      lockedSteps || '(none)'
    }`,
    `User-defined unlocked steps:\n${userSteps || '(none)'}`,
    `Recent journal summaries:\n${recentJournal || '(none)'}`,
    `Recent application summaries:\n${recentApplications || '(none)'}`,
    `Trusted evidence summaries:\n${evidenceSources || '(none)'}`,
    `Scored context summary:\n${JSON.stringify(
      {
        reaction: inputs.contextSummary.reaction,
        productScores: inputs.contextSummary.productScores.slice(0, 20),
        applicationPatterns: inputs.contextSummary.applicationPatterns,
        safetyConstraints: inputs.contextSummary.safetyConstraints,
        governance: inputs.contextSummary.governance,
        skippedCandidates: inputs.contextSummary.skippedCandidates,
      },
      null,
      2,
    )}`,
    'Return strictly valid JSON matching the schema.',
  ].join('\n\n');
}

export function extractOutputText(
  payload: OpenAiResponsePayload,
): string | null {
  for (const message of payload.output ?? []) {
    for (const content of message.content ?? []) {
      if (content.refusal || content.type.includes('refusal')) {
        return null;
      }
      if (content.text) return content.text;
    }
  }
  return null;
}

export function estimateCost(usage: {
  input_tokens?: number;
  output_tokens?: number;
}): number {
  const inputCost = (usage.input_tokens ?? 0) * 0.00000015;
  const outputCost = (usage.output_tokens ?? 0) * 0.0000006;
  return Number((inputCost + outputCost).toFixed(6));
}

function formatShelfProduct(product: InventoryProduct): string {
  const guidance = product.guidance;
  return [
    `- ${product.brand} ${product.name}`,
    `(category=${product.category}, id=${product.id})`,
    guidance?.waitMinutes ? `wait=${guidance.waitMinutes}min` : null,
    guidance?.cautions?.length
      ? `cautions=${guidance.cautions.join('|')}`
      : null,
  ]
    .filter(Boolean)
    .join(' ');
}

function formatRoutineStep(tag: 'LOCKED' | 'USER') {
  return (step: RoutineStep, index: number) =>
    `${index + 1}. [${tag}] order=${step.step_order}, label=${
      step.step_label
    }, productId=${step.inventory_product_id ?? 'none'}${
      step.product ? `, product=${step.product.brand} ${step.product.name}` : ''
    }${step.notes ? `, note=${step.notes}` : ''}, routineStepId=${step.id}`;
}

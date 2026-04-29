import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readOpenAiModel } from '../../common/utils/openai-config';
import {
  extractJsonObject,
  extractOutputText,
  type OpenAiResponsePayload,
} from '../../catalogue/openai-extraction.utils';
import { SkinJournalPhotoStorageService } from './skin-journal-photo-storage.service';
import type {
  AnalysisObservations,
  ReactionSeverity,
} from '../skin-journal.constants';
import { SKIN_JOURNAL_ANALYSIS_TIMEOUT_MS } from '../skin-journal.constants';

const MOCK_MODEL = 'ritora-stub-1.0';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-2024-08-06';
const FORBIDDEN_MEDICAL_LANGUAGE =
  /\b(diagnose|diagnosis|treat|treatment|cure|prescribe)\b/i;
const RESPONSE_FORMAT = {
  type: 'json_schema',
  name: 'skin_journal_photo_analysis',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'schema_version',
      'model_version',
      'image_quality',
      'detected_concerns',
      'reaction_signals',
      'barrier_signs',
      'overall_assessment',
      'should_flag_for_doctor',
      'doctor_flag_reason',
    ],
    properties: {
      schema_version: { type: 'string', enum: ['1.0'] },
      model_version: { type: 'string' },
      image_quality: {
        type: 'object',
        additionalProperties: false,
        required: [
          'face_detected',
          'lighting_quality',
          'framing_quality',
          'blur_detected',
          'issues',
        ],
        properties: {
          face_detected: { type: 'boolean' },
          lighting_quality: {
            type: 'string',
            enum: ['poor', 'fair', 'good', 'excellent'],
          },
          framing_quality: {
            type: 'string',
            enum: ['poor', 'fair', 'good', 'excellent'],
          },
          blur_detected: { type: 'boolean' },
          issues: { type: 'array', items: { type: 'string' } },
        },
      },
      detected_concerns: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['concern', 'severity', 'locations', 'confidence'],
          properties: {
            concern: { type: 'string' },
            severity: {
              type: 'string',
              enum: ['mild', 'moderate', 'severe'],
            },
            locations: { type: 'array', items: { type: 'string' } },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      },
      reaction_signals: {
        type: 'object',
        additionalProperties: false,
        required: [
          'reaction_detected',
          'reaction_severity',
          'indicators',
          'confidence',
        ],
        properties: {
          reaction_detected: { type: 'boolean' },
          reaction_severity: {
            type: 'string',
            enum: ['none', 'mild', 'moderate', 'severe'],
          },
          indicators: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
      barrier_signs: {
        type: 'object',
        additionalProperties: false,
        required: ['barrier_compromise', 'indicators'],
        properties: {
          barrier_compromise: { type: 'boolean' },
          indicators: { type: 'array', items: { type: 'string' } },
        },
      },
      overall_assessment: { type: 'string', maxLength: 200 },
      should_flag_for_doctor: { type: 'boolean' },
      doctor_flag_reason: {
        anyOf: [{ type: 'string' }, { type: 'null' }],
      },
    },
  },
} as const;

@Injectable()
export class SkinJournalAnalysisService {
  private readonly logger = new Logger(SkinJournalAnalysisService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly photoStorage: SkinJournalPhotoStorageService,
  ) {}

  async analyze(params: {
    userId: string;
    entryId: string;
    photoObjectKey: string | null;
    concernFocus: string[] | null;
    priorAnalysis: AnalysisObservations | null;
  }): Promise<AnalysisObservations> {
    if (this.shouldUseMockAnalysis()) {
      return this.mockAnalysis(params.entryId);
    }
    if (!params.photoObjectKey) {
      throw new Error('Photo analysis requires a stored photo');
    }
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    const model = this.getModel();
    const photo = await this.photoStorage.readPhotoBuffer(
      params.photoObjectKey,
    );
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        store: false,
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: buildSystemPrompt(),
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: buildUserPrompt(params),
              },
              {
                type: 'input_image',
                image_url: `data:image/webp;base64,${photo.toString('base64')}`,
              },
            ],
          },
        ],
        max_output_tokens: 1200,
        text: {
          verbosity: 'low',
          format: RESPONSE_FORMAT,
        },
      }),
      signal: AbortSignal.timeout(SKIN_JOURNAL_ANALYSIS_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`OpenAI photo analysis failed with ${response.status}`);
    }

    const payload = (await response.json()) as OpenAiResponsePayload;
    const outputText = extractOutputText(payload);
    if (!outputText) {
      throw new Error('OpenAI photo analysis returned no output text');
    }
    const parsed = JSON.parse(extractJsonObject(outputText)) as unknown;
    const observations = validateAnalysisObservations(parsed, model);
    assertNonDiagnosticLanguage(observations);
    return observations;
  }

  shortSummary(obs: AnalysisObservations): string {
    return obs.overall_assessment;
  }

  private mockAnalysis(entryId: string): AnalysisObservations {
    const reactionSeverity: ReactionSeverity =
      this.pickReactionFromHash(entryId);

    return {
      schema_version: '1.0',
      model_version: MOCK_MODEL,
      image_quality: {
        face_detected: true,
        lighting_quality: 'good',
        framing_quality: 'good',
        blur_detected: false,
        issues: [],
      },
      detected_concerns: [
        {
          concern: 'redness_inflammation',
          severity: reactionSeverity === 'severe' ? 'severe' : 'mild',
          locations: ['chin'],
          confidence: 0.78,
        },
        {
          concern: 'dryness',
          severity: 'mild',
          locations: ['left_cheek', 'right_cheek'],
          confidence: 0.62,
        },
        {
          concern: 'texture',
          severity: 'mild',
          locations: ['forehead'],
          confidence: 0.58,
        },
      ],
      reaction_signals: {
        reaction_detected: reactionSeverity !== 'none',
        reaction_severity: reactionSeverity,
        indicators:
          reactionSeverity === 'none'
            ? []
            : ['redness_spike', 'new_breakouts_cluster'],
        confidence: reactionSeverity === 'none' ? 0.2 : 0.71,
      },
      barrier_signs: {
        barrier_compromise: reactionSeverity === 'severe',
        indicators:
          reactionSeverity === 'severe' ? ['diffuse_inflammation'] : [],
      },
      overall_assessment:
        reactionSeverity === 'none'
          ? 'Skin appears within your usual baseline today. Mild dryness around cheeks.'
          : 'Skin appears more inflamed than usual. May indicate a reaction.',
      should_flag_for_doctor: reactionSeverity === 'severe',
      doctor_flag_reason:
        reactionSeverity === 'severe'
          ? 'Persistent strong inflammation indicators.'
          : undefined,
    };
  }

  private pickReactionFromHash(entryId: string): ReactionSeverity {
    /* ULIDs sort lexically. Use the last char to spread states deterministically.
       Most days are healthy ("none"); a small fraction trigger reaction signals so
       reviewers can see all UI branches without seeding mock data. */
    const tail = entryId.slice(-1);
    if (tail === 'Z') return 'severe';
    if (tail === 'Y' || tail === 'X' || tail === 'W') return 'moderate';
    if (tail === 'V' || tail === 'U' || tail === 'T') return 'mild';
    return 'none';
  }

  private shouldUseMockAnalysis(): boolean {
    return process.env.NODE_ENV === 'test';
  }

  private getModel(): string {
    return (
      readOpenAiModel(this.configService, DEFAULT_OPENAI_MODEL) ??
      DEFAULT_OPENAI_MODEL
    );
  }
}

function buildSystemPrompt(): string {
  return [
    'You are Ritora skin journal photo intelligence.',
    'Return JSON only. Do not diagnose, treat, cure, or prescribe.',
    'Use non-medical language such as appears, may, possible, and signals.',
    'If the image quality is poor or no face is visible, say so and avoid guessing.',
  ].join(' ');
}

function buildUserPrompt(params: {
  concernFocus: string[] | null;
  priorAnalysis: AnalysisObservations | null;
}): string {
  const concernFocus =
    params.concernFocus && params.concernFocus.length > 0
      ? params.concernFocus.join(', ')
      : 'none';
  const priorSummary = params.priorAnalysis?.overall_assessment ?? 'none';
  return [
    `Concern focus: ${concernFocus}.`,
    `Previous journal assessment summary: ${priorSummary}.`,
    'Analyze visible skin-progress signals, image quality, possible reaction indicators, and barrier signs using the required schema.',
  ].join(' ');
}

function validateAnalysisObservations(
  value: unknown,
  model: string,
): AnalysisObservations {
  if (!isRecord(value)) {
    throw new Error('Analysis response is not an object');
  }
  const imageQuality = expectRecord(value.image_quality, 'image_quality');
  const reactionSignals = expectRecord(
    value.reaction_signals,
    'reaction_signals',
  );
  const barrierSigns = expectRecord(value.barrier_signs, 'barrier_signs');
  const observations: AnalysisObservations = {
    schema_version: '1.0',
    model_version: stringOr(value.model_version, model),
    image_quality: {
      face_detected: expectBoolean(imageQuality.face_detected),
      lighting_quality: expectEnum(imageQuality.lighting_quality, [
        'poor',
        'fair',
        'good',
        'excellent',
      ]),
      framing_quality: expectEnum(imageQuality.framing_quality, [
        'poor',
        'fair',
        'good',
        'excellent',
      ]),
      blur_detected: expectBoolean(imageQuality.blur_detected),
      issues: expectStringArray(imageQuality.issues),
    },
    detected_concerns: expectArray(value.detected_concerns).map((item) => {
      const concern = expectRecord(item, 'detected_concerns[]');
      return {
        concern: expectString(concern.concern),
        severity: expectEnum(concern.severity, ['mild', 'moderate', 'severe']),
        locations: expectStringArray(concern.locations),
        confidence: expectConfidence(concern.confidence),
      };
    }),
    reaction_signals: {
      reaction_detected: expectBoolean(reactionSignals.reaction_detected),
      reaction_severity: expectEnum(reactionSignals.reaction_severity, [
        'none',
        'mild',
        'moderate',
        'severe',
      ]),
      indicators: expectStringArray(reactionSignals.indicators),
      confidence: expectConfidence(reactionSignals.confidence),
    },
    barrier_signs: {
      barrier_compromise: expectBoolean(barrierSigns.barrier_compromise),
      indicators: expectStringArray(barrierSigns.indicators),
    },
    overall_assessment: expectString(value.overall_assessment).slice(0, 200),
    should_flag_for_doctor: expectBoolean(value.should_flag_for_doctor),
    doctor_flag_reason:
      typeof value.doctor_flag_reason === 'string'
        ? value.doctor_flag_reason
        : undefined,
  };
  return observations;
}

function assertNonDiagnosticLanguage(obs: AnalysisObservations): void {
  const text = [
    obs.overall_assessment,
    obs.doctor_flag_reason ?? '',
    ...obs.detected_concerns.map((concern) => concern.concern),
  ].join(' ');
  if (FORBIDDEN_MEDICAL_LANGUAGE.test(text)) {
    throw new Error('Analysis response used forbidden medical language');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} is not an object`);
  return value;
}

function expectArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected array');
  return value;
}

function expectStringArray(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === 'string')
  ) {
    throw new Error('Expected string array');
  }
  return value;
}

function expectString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Expected non-empty string');
  }
  return value.trim();
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function expectBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Expected boolean');
  return value;
}

function expectConfidence(value: unknown): number {
  if (typeof value !== 'number' || value < 0 || value > 1) {
    throw new Error('Expected confidence between 0 and 1');
  }
  return value;
}

function expectEnum<TValue extends string>(
  value: unknown,
  allowed: readonly TValue[],
): TValue {
  if (typeof value === 'string' && allowed.includes(value as TValue)) {
    return value as TValue;
  }
  throw new Error('Unexpected enum value');
}

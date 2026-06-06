import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  readFeatureOpenAiModel,
  SKIN_JOURNAL_ANALYSIS_AI_MODEL_ENV_KEY,
} from '../../common/utils/openai-config';
import {
  OPENAI_SKIN_JOURNAL_ANALYSIS_REASONING_EFFORT,
  openAiRepeatabilityRequestOptions,
} from '../../common/utils/openai-request-options';
import {
  extractJsonObject,
  extractOutputText,
  type OpenAiResponsePayload,
} from '../../catalogue/openai-extraction.utils';
import { PlatformGlobalRestrictionCapability } from '../../platform-controls/platform-global-restrictions';
import { PlatformGlobalRestrictionsService } from '../../platform-controls/platform-global-restrictions.service';
import { SkinJournalPhotoStorageService } from './skin-journal-photo-storage.service';
import type {
  AnalysisChangeDirection,
  AnalysisConcern,
  AnalysisEntryContext,
  AnalysisGuidanceDecision,
  AnalysisObservations,
  AnalysisPhotoInput,
  AnalysisRoutineContext,
  AnalysisRunMetadata,
  AnalysisRunResult,
  AnalysisSafetyReason,
  AnalysisSkinContext,
  AnalysisTrendExclusionReason,
  Angle,
  ReactionSeverity,
} from '../skin-journal.constants';
import {
  AnalysisFailureCodeValue,
  ANALYSIS_CONCERNS,
  PHOTO_ANALYSIS_GUIDANCE_ACTION_CODES,
  PHOTO_ANALYSIS_GUIDANCE_AVOID_CODES,
  PHOTO_ANALYSIS_GUIDANCE_FACTOR_CODES,
  SKIN_JOURNAL_FRONT_PHOTO_ANGLE,
  SKIN_JOURNAL_ANALYSIS_ASSUMED_INPUT_IMAGE_COST_USD,
  SKIN_JOURNAL_ANALYSIS_MAX_IMAGE_BYTES,
  SKIN_JOURNAL_ANALYSIS_MAX_OUTPUT_TOKENS,
  SKIN_JOURNAL_ANALYSIS_MAX_REQUEST_COST_USD,
  SKIN_JOURNAL_ANALYSIS_MAX_TOTAL_IMAGE_BYTES,
  SKIN_JOURNAL_ANALYSIS_PROMPT_VERSION,
  SKIN_JOURNAL_ANALYSIS_TIMEOUT_MS,
  SKIN_JOURNAL_PHOTO_ANGLES,
} from '../skin-journal.constants';
import {
  isProviderTimeoutError,
  SkinJournalAnalysisError,
} from './skin-journal-analysis-errors';
import {
  assertAnalysisPhotoPayloadLimits,
  assertAnalysisPhotoPreflight,
} from './skin-journal-analysis-preflight';

const MOCK_MODEL = 'ritora-stub-1.0';
const DEFAULT_OPENAI_MODEL = 'gpt-5.2';
const FORBIDDEN_MEDICAL_LANGUAGE =
  /\b(diagnose|diagnosis|treat|treatment|cure|prescribe)\b/i;
const AI_STYLE_PUNCTUATION = /[-—–]/;
const UNSAFE_GUIDANCE_LANGUAGE =
  /\b(stop all|stop every|immediately stop|discontinue|prescribed|prescription|medicine|medication|proves?|confirmed cause|must avoid|never eat|eliminate all|guaranteed|guarantee)\b/i;
const IMAGE_QUALITY_ISSUES = [
  'too_dark',
  'too_bright',
  'harsh_shadows',
  'glare',
  'blur',
  'face_too_small',
  'face_not_centered',
  'partial_face',
  'occlusion',
  'makeup_or_filter_present',
  'non_face_image',
] as const;
const SKIN_LOCATIONS = [
  'forehead',
  'left_cheek',
  'right_cheek',
  'chin',
  'nose',
  'under_eyes',
  'jawline',
  'upper_lip',
  'temples',
  'neck',
] as const;
const REACTION_INDICATORS = [
  'redness_spike',
  'swelling_appearance',
  'rash_appearance',
  'new_breakouts_cluster',
  'peeling',
  'burning_appearance',
  'hives_appearance',
] as const;
const BARRIER_INDICATORS = [
  'flaking',
  'tightness_appearance',
  'diffuse_inflammation',
  'cracking_appearance',
] as const;
const ANALYSIS_CHANGE_DIRECTIONS = [
  'improved',
  'worsened',
  'stable',
  'new',
  'not_comparable',
  'unknown',
] as const satisfies readonly AnalysisChangeDirection[];
const TREND_EXCLUSION_REASONS = [
  'poor_lighting',
  'poor_framing',
  'blur',
  'no_face_detected',
  'occlusion',
  'makeup_or_filter_present',
  'not_comparable',
] as const satisfies readonly AnalysisTrendExclusionReason[];
const SAFETY_REASONS = [
  'possible_swelling',
  'hive_like_appearance',
  'widespread_severe_irritation',
  'rapid_worsening',
  'eye_area_involvement',
  'cracking_or_open_skin_appearance',
  'possible_infection_signs',
] as const satisfies readonly AnalysisSafetyReason[];

type AnalysisUsage = {
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
};

type VisionPhotoInput = {
  angle: Angle;
  buffer: Buffer;
};

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
      'per_angle_quality',
      'detected_concerns',
      'reaction_signals',
      'barrier_signs',
      'guidance_decisions',
      'overall_assessment',
      'overall_change_from_previous',
      'user_visible_message',
      'safety_flags',
      'should_flag_for_doctor',
      'doctor_flag_reason',
    ],
    properties: {
      schema_version: { type: 'string', enum: ['1.3'] },
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
          'quality_score',
          'needs_retake',
          'excluded_from_trends_reason',
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
          issues: {
            type: 'array',
            items: { type: 'string', enum: IMAGE_QUALITY_ISSUES },
          },
          quality_score: { type: 'number', minimum: 0, maximum: 1 },
          needs_retake: { type: 'boolean' },
          excluded_from_trends_reason: {
            anyOf: [
              { type: 'string', enum: TREND_EXCLUSION_REASONS },
              { type: 'null' },
            ],
          },
        },
      },
      per_angle_quality: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'angle',
            'face_detected',
            'lighting_quality',
            'framing_quality',
            'blur_detected',
            'issues',
            'quality_score',
            'needs_retake',
            'used_for_analysis',
          ],
          properties: {
            angle: { type: 'string', enum: SKIN_JOURNAL_PHOTO_ANGLES },
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
            issues: {
              type: 'array',
              items: { type: 'string', enum: IMAGE_QUALITY_ISSUES },
            },
            quality_score: { type: 'number', minimum: 0, maximum: 1 },
            needs_retake: { type: 'boolean' },
            used_for_analysis: { type: 'boolean' },
          },
        },
      },
      detected_concerns: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'concern',
            'severity',
            'locations',
            'confidence',
            'change_from_previous',
            'change_confidence',
          ],
          properties: {
            concern: { type: 'string', enum: ANALYSIS_CONCERNS },
            severity: {
              type: 'string',
              enum: ['mild', 'moderate', 'severe'],
            },
            locations: {
              type: 'array',
              items: { type: 'string', enum: SKIN_LOCATIONS },
            },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            change_from_previous: {
              type: 'string',
              enum: ANALYSIS_CHANGE_DIRECTIONS,
            },
            change_confidence: { type: 'number', minimum: 0, maximum: 1 },
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
          indicators: {
            type: 'array',
            items: { type: 'string', enum: REACTION_INDICATORS },
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
      barrier_signs: {
        type: 'object',
        additionalProperties: false,
        required: ['barrier_compromise', 'indicators'],
        properties: {
          barrier_compromise: { type: 'boolean' },
          indicators: {
            type: 'array',
            items: { type: 'string', enum: BARRIER_INDICATORS },
          },
        },
      },
      guidance_decisions: {
        type: 'array',
        maxItems: ANALYSIS_CONCERNS.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'concern',
            'possible_factor_codes',
            'possible_cause_items',
            'action_codes',
            'try_next_items',
            'avoid_codes',
            'avoid_items',
            'reasoning_summary',
          ],
          properties: {
            concern: { type: 'string', enum: ANALYSIS_CONCERNS },
            possible_factor_codes: {
              type: 'array',
              maxItems: 4,
              items: {
                type: 'string',
                enum: PHOTO_ANALYSIS_GUIDANCE_FACTOR_CODES,
              },
            },
            possible_cause_items: {
              type: 'array',
              minItems: 1,
              maxItems: 3,
              items: { type: 'string', maxLength: 180 },
            },
            action_codes: {
              type: 'array',
              maxItems: 4,
              items: {
                type: 'string',
                enum: PHOTO_ANALYSIS_GUIDANCE_ACTION_CODES,
              },
            },
            try_next_items: {
              type: 'array',
              minItems: 1,
              maxItems: 3,
              items: { type: 'string', maxLength: 180 },
            },
            avoid_codes: {
              type: 'array',
              maxItems: 3,
              items: {
                type: 'string',
                enum: PHOTO_ANALYSIS_GUIDANCE_AVOID_CODES,
              },
            },
            avoid_items: {
              type: 'array',
              minItems: 1,
              maxItems: 3,
              items: { type: 'string', maxLength: 180 },
            },
            reasoning_summary: { type: 'string', maxLength: 220 },
          },
        },
      },
      overall_assessment: { type: 'string', maxLength: 200 },
      overall_change_from_previous: {
        type: 'string',
        enum: ANALYSIS_CHANGE_DIRECTIONS,
      },
      user_visible_message: { type: 'string', maxLength: 240 },
      safety_flags: {
        type: 'object',
        additionalProperties: false,
        required: [
          'urgent_review_recommended',
          'doctor_follow_up_recommended',
          'reasons',
        ],
        properties: {
          urgent_review_recommended: { type: 'boolean' },
          doctor_follow_up_recommended: { type: 'boolean' },
          reasons: {
            type: 'array',
            items: { type: 'string', enum: SAFETY_REASONS },
          },
        },
      },
      should_flag_for_doctor: { type: 'boolean' },
      doctor_flag_reason: {
        anyOf: [{ type: 'string' }, { type: 'null' }],
      },
    },
  },
} as const;
const GUIDANCE_DECISION_CONFIDENCE_THRESHOLD = 0.45;

@Injectable()
export class SkinJournalAnalysisService {
  private readonly logger = new Logger(SkinJournalAnalysisService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly photoStorage: SkinJournalPhotoStorageService,
    @Optional()
    private readonly platformRestrictions?: PlatformGlobalRestrictionsService,
  ) {}

  async analyze(params: {
    userId: string;
    entryId: string;
    photoObjectKey: string | null;
    photos?: AnalysisPhotoInput[] | null;
    priorPhotoObjectKey?: string | null;
    concernFocus: string[] | null;
    priorAnalysis: AnalysisObservations | null;
    skinContext?: AnalysisSkinContext | null;
    entryContext?: AnalysisEntryContext | null;
    routineContext?: AnalysisRoutineContext | null;
  }): Promise<AnalysisRunResult> {
    const startedAt = Date.now();
    const currentPhotoInputs = normalizeAnalysisPhotoInputs(
      params.photoObjectKey,
      params.photos ?? null,
    );
    if (currentPhotoInputs.length === 0) {
      throw new SkinJournalAnalysisError(
        AnalysisFailureCodeValue.InvalidPhotoInput,
        'Photo analysis requires a stored front photo.',
        false,
      );
    }
    await this.assertAiGenerationAllowed();

    if (this.shouldUseMockAnalysis()) {
      return {
        observations: this.mockAnalysis(params.entryId, currentPhotoInputs),
        metadata: {
          prompt_version: SKIN_JOURNAL_ANALYSIS_PROMPT_VERSION,
          duration_ms: Date.now() - startedAt,
          input_image_count:
            currentPhotoInputs.length + (params.priorPhotoObjectKey ? 1 : 0),
          input_tokens: null,
          output_tokens: null,
          total_tokens: null,
          estimated_cost_usd: null,
        },
      };
    }
    if (!params.photoObjectKey) {
      throw new SkinJournalAnalysisError(
        AnalysisFailureCodeValue.InvalidPhotoInput,
        'Photo analysis requires a stored photo.',
        false,
      );
    }

    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      throw new SkinJournalAnalysisError(
        AnalysisFailureCodeValue.ConfigurationError,
        'OPENAI_API_KEY is not configured.',
        false,
      );
    }

    const model = this.getModel();
    const photos = await Promise.all(
      currentPhotoInputs.map(async (photo) => ({
        angle: photo.angle,
        buffer: await this.photoStorage.readPhotoBuffer(photo.object_key),
      })),
    );
    const priorPhoto = params.priorPhotoObjectKey
      ? await this.photoStorage.readPhotoBuffer(params.priorPhotoObjectKey)
      : null;
    return this.runVisionRequest({
      startedAt,
      model,
      photos,
      priorPhoto,
      userPrompt: buildUserPrompt({ ...params, photos: currentPhotoInputs }),
    });
  }

  async analyzeEvaluationPhoto(params: {
    fixtureId: string;
    imageBuffer: Buffer;
    angle?: Angle;
  }): Promise<AnalysisRunResult> {
    const startedAt = Date.now();
    const angle = params.angle ?? SKIN_JOURNAL_FRONT_PHOTO_ANGLE;
    const photos: AnalysisPhotoInput[] = [
      { angle, object_key: 'evaluation-fixture' },
    ];
    await this.assertAiGenerationAllowed();

    if (this.shouldUseMockAnalysis()) {
      return {
        observations: this.mockAnalysis(params.fixtureId, photos),
        metadata: {
          prompt_version: SKIN_JOURNAL_ANALYSIS_PROMPT_VERSION,
          duration_ms: Date.now() - startedAt,
          input_image_count: 1,
          input_tokens: null,
          output_tokens: null,
          total_tokens: null,
          estimated_cost_usd: null,
        },
      };
    }

    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      throw new SkinJournalAnalysisError(
        AnalysisFailureCodeValue.ConfigurationError,
        'OPENAI_API_KEY is not configured.',
        false,
      );
    }

    return this.runVisionRequest({
      startedAt,
      model: this.getModel(),
      photos: [{ angle, buffer: params.imageBuffer }],
      priorPhoto: null,
      userPrompt: buildEvaluationUserPrompt(params.fixtureId, angle),
    });
  }

  private async runVisionRequest(params: {
    startedAt: number;
    model: string;
    photos: VisionPhotoInput[];
    priorPhoto: Buffer | null;
    userPrompt: string;
  }): Promise<AnalysisRunResult> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      throw new SkinJournalAnalysisError(
        AnalysisFailureCodeValue.ConfigurationError,
        'OPENAI_API_KEY is not configured.',
        false,
      );
    }
    assertAnalysisPhotoPayloadLimits({
      photos: params.photos,
      priorPhoto: params.priorPhoto,
      maxImageBytes: this.readNumericConfig(
        'SKIN_JOURNAL_ANALYSIS_MAX_IMAGE_BYTES',
        SKIN_JOURNAL_ANALYSIS_MAX_IMAGE_BYTES,
      ),
      maxTotalImageBytes: this.readNumericConfig(
        'SKIN_JOURNAL_ANALYSIS_MAX_TOTAL_IMAGE_BYTES',
        SKIN_JOURNAL_ANALYSIS_MAX_TOTAL_IMAGE_BYTES,
      ),
    });
    this.assertEstimatedRequestCostAllowed(
      params.photos.length + (params.priorPhoto ? 1 : 0),
    );
    await assertAnalysisPhotoPreflight({ photos: params.photos });

    const userContent: Array<
      | { type: 'input_text'; text: string }
      | { type: 'input_image'; image_url: string }
    > = [
      {
        type: 'input_text',
        text: params.userPrompt,
      },
    ];
    params.photos.forEach((photo, index) => {
      userContent.push(
        {
          type: 'input_text',
          text: currentPhotoLabel(photo.angle, index),
        },
        {
          type: 'input_image',
          image_url: `data:image/webp;base64,${photo.buffer.toString('base64')}`,
        },
      );
    });
    if (params.priorPhoto) {
      userContent.push(
        {
          type: 'input_text',
          text: 'Image B is the prior front reference photo. Use it only for cautious high-level front-to-front change direction, not diagnosis or precise percentages.',
        },
        {
          type: 'input_image',
          image_url: `data:image/webp;base64,${params.priorPhoto.toString('base64')}`,
        },
      );
    }
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: params.model,
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
              content: userContent,
            },
          ],
          max_output_tokens: SKIN_JOURNAL_ANALYSIS_MAX_OUTPUT_TOKENS,
          ...openAiRepeatabilityRequestOptions(
            params.model,
            OPENAI_SKIN_JOURNAL_ANALYSIS_REASONING_EFFORT,
          ),
          text: {
            verbosity: 'low',
            format: RESPONSE_FORMAT,
          },
        }),
        signal: AbortSignal.timeout(SKIN_JOURNAL_ANALYSIS_TIMEOUT_MS),
      });
    } catch (error) {
      if (isProviderTimeoutError(error)) {
        throw new SkinJournalAnalysisError(
          AnalysisFailureCodeValue.ProviderTimeout,
          'OpenAI photo analysis timed out.',
          true,
          { cause: error },
        );
      }
      throw new SkinJournalAnalysisError(
        AnalysisFailureCodeValue.ProviderUnavailable,
        'OpenAI photo analysis is temporarily unavailable.',
        true,
        { cause: error },
      );
    }

    if (!response.ok) {
      const code =
        response.status === 429
          ? AnalysisFailureCodeValue.ProviderRateLimited
          : AnalysisFailureCodeValue.ProviderUnavailable;
      throw new SkinJournalAnalysisError(
        code,
        `OpenAI photo analysis failed with ${response.status}.`,
        true,
      );
    }

    let payload: OpenAiResponsePayload;
    try {
      payload = (await response.json()) as OpenAiResponsePayload;
    } catch (error) {
      throw new SkinJournalAnalysisError(
        AnalysisFailureCodeValue.ProviderInvalidResponse,
        'OpenAI photo analysis returned unreadable JSON.',
        true,
        { cause: error },
      );
    }
    const outputText = extractOutputText(payload);
    if (!outputText) {
      throw new SkinJournalAnalysisError(
        AnalysisFailureCodeValue.ProviderInvalidResponse,
        'OpenAI photo analysis returned no output text.',
        true,
      );
    }
    const observations = this.parseAndValidateObservations(
      outputText,
      params.model,
      params.photos,
    );
    const usage = extractUsage(payload);
    const metadata: AnalysisRunMetadata = {
      prompt_version: SKIN_JOURNAL_ANALYSIS_PROMPT_VERSION,
      duration_ms: Date.now() - params.startedAt,
      input_image_count: params.photos.length + (params.priorPhoto ? 1 : 0),
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      total_tokens: usage.total_tokens,
      estimated_cost_usd: this.estimateCostUsd(usage),
    };
    return { observations, metadata };
  }

  promptVersion(): string {
    return SKIN_JOURNAL_ANALYSIS_PROMPT_VERSION;
  }

  private parseAndValidateObservations(
    outputText: string,
    model: string,
    photos: VisionPhotoInput[],
  ): AnalysisObservations {
    try {
      const parsed = JSON.parse(extractJsonObject(outputText)) as unknown;
      const observations = validateAnalysisObservations(parsed, model);
      assertPerAngleQualityCoverage(observations, photos);
      assertSemanticConsistency(observations);
      assertGuidanceDecisionCoverage(observations);
      assertNonDiagnosticLanguage(observations);
      return observations;
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'invalid output';
      throw new SkinJournalAnalysisError(
        AnalysisFailureCodeValue.ProviderInvalidResponse,
        `Photo analysis model response failed validation: ${detail}`,
        true,
        { cause: error },
      );
    }
  }

  private assertEstimatedRequestCostAllowed(inputImageCount: number): void {
    const assumedImageCost = this.readNumericConfig(
      'SKIN_JOURNAL_ANALYSIS_ASSUMED_INPUT_IMAGE_COST_USD',
      SKIN_JOURNAL_ANALYSIS_ASSUMED_INPUT_IMAGE_COST_USD,
    );
    const maxRequestCost = this.readNumericConfig(
      'SKIN_JOURNAL_ANALYSIS_MAX_REQUEST_COST_USD',
      SKIN_JOURNAL_ANALYSIS_MAX_REQUEST_COST_USD,
    );
    const outputCostPerMillion = this.readNumericConfig(
      'SKIN_JOURNAL_ANALYSIS_OUTPUT_TOKEN_COST_PER_1M_USD',
      0,
    );
    const estimatedCost =
      inputImageCount * assumedImageCost +
      (SKIN_JOURNAL_ANALYSIS_MAX_OUTPUT_TOKENS / 1_000_000) *
        outputCostPerMillion;
    if (estimatedCost > maxRequestCost) {
      throw new SkinJournalAnalysisError(
        AnalysisFailureCodeValue.CostLimitExceeded,
        'Photo analysis request exceeds the configured cost budget.',
        false,
      );
    }
  }

  private estimateCostUsd(usage: AnalysisUsage): number | null {
    if (usage.input_tokens === null && usage.output_tokens === null) {
      return null;
    }
    const inputCostPerMillion = this.readCostConfig(
      'SKIN_JOURNAL_ANALYSIS_INPUT_TOKEN_COST_PER_1M_USD',
    );
    const outputCostPerMillion = this.readCostConfig(
      'SKIN_JOURNAL_ANALYSIS_OUTPUT_TOKEN_COST_PER_1M_USD',
    );
    if (inputCostPerMillion <= 0 && outputCostPerMillion <= 0) {
      return null;
    }
    const inputCost =
      ((usage.input_tokens ?? 0) / 1_000_000) * inputCostPerMillion;
    const outputCost =
      ((usage.output_tokens ?? 0) / 1_000_000) * outputCostPerMillion;
    return Number((inputCost + outputCost).toFixed(6));
  }

  private async isAiGenerationDisabled(): Promise<boolean> {
    return Boolean(
      await this.platformRestrictions?.isCapabilityDisabled(
        PlatformGlobalRestrictionCapability.DisableAiGeneration,
      ),
    );
  }

  private async assertAiGenerationAllowed(): Promise<void> {
    if (await this.isAiGenerationDisabled()) {
      throw new SkinJournalAnalysisError(
        AnalysisFailureCodeValue.PlatformGlobalRestriction,
        'Skin Journal AI analysis is temporarily disabled.',
        false,
      );
    }
  }

  private readNumericConfig(key: string, fallback: number): number {
    const value = this.configService.get<number | string>(key);
    if (value === undefined || value === null || value === '') {
      return fallback;
    }
    const parsed =
      typeof value === 'number' ? value : Number.parseFloat(String(value));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  private readCostConfig(key: string): number {
    const value = this.configService.getOrThrow<number | string>(key);
    const parsed =
      typeof value === 'number' ? value : Number.parseFloat(String(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  private mockAnalysis(
    entryId: string,
    photos: AnalysisPhotoInput[] = [
      {
        angle: SKIN_JOURNAL_FRONT_PHOTO_ANGLE,
        object_key: 'mock-photo',
      },
    ],
  ): AnalysisObservations {
    const reactionSeverity: ReactionSeverity =
      this.pickReactionFromHash(entryId);

    return {
      schema_version: '1.3',
      model_version: MOCK_MODEL,
      image_quality: {
        face_detected: true,
        lighting_quality: 'good',
        framing_quality: 'good',
        blur_detected: false,
        issues: [],
        quality_score: 0.9,
        needs_retake: false,
        excluded_from_trends_reason: null,
      },
      per_angle_quality: photos.map((photo) => ({
        angle: photo.angle,
        face_detected: true,
        lighting_quality: 'good',
        framing_quality:
          photo.angle === SKIN_JOURNAL_FRONT_PHOTO_ANGLE ? 'good' : 'fair',
        blur_detected: false,
        issues: [],
        quality_score:
          photo.angle === SKIN_JOURNAL_FRONT_PHOTO_ANGLE ? 0.9 : 0.78,
        needs_retake: false,
        used_for_analysis: true,
      })),
      detected_concerns: [
        {
          concern: 'redness_inflammation',
          severity: reactionSeverity === 'severe' ? 'severe' : 'mild',
          locations: ['chin'],
          confidence: 0.78,
          change_from_previous:
            reactionSeverity === 'none' ? 'stable' : 'worsened',
          change_confidence: 0.52,
        },
        {
          concern: 'dryness',
          severity: 'mild',
          locations: ['left_cheek', 'right_cheek'],
          confidence: 0.62,
          change_from_previous: 'stable',
          change_confidence: 0.48,
        },
        {
          concern: 'texture',
          severity: 'mild',
          locations: ['forehead'],
          confidence: 0.58,
          change_from_previous: 'stable',
          change_confidence: 0.42,
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
      guidance_decisions: [],
      overall_assessment:
        reactionSeverity === 'none'
          ? 'Skin appears within your usual baseline today. Mild dryness around cheeks.'
          : 'Skin appears more inflamed than usual. May indicate a reaction.',
      overall_change_from_previous:
        reactionSeverity === 'none' ? 'stable' : 'worsened',
      user_visible_message:
        reactionSeverity === 'none'
          ? 'Skin appears close to your recent baseline.'
          : 'Visible irritation signals are stronger today; keep monitoring.',
      safety_flags: {
        urgent_review_recommended: reactionSeverity === 'severe',
        doctor_follow_up_recommended: reactionSeverity === 'severe',
        reasons:
          reactionSeverity === 'severe' ? ['widespread_severe_irritation'] : [],
      },
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
      readFeatureOpenAiModel(
        this.configService,
        SKIN_JOURNAL_ANALYSIS_AI_MODEL_ENV_KEY,
        DEFAULT_OPENAI_MODEL,
      ) ?? DEFAULT_OPENAI_MODEL
    );
  }
}

function buildSystemPrompt(): string {
  return [
    [
      'Role:',
      'You are Ritora Skin Journal Photo Intelligence.',
      'Reason like a cautious licensed board-certified dermatologist and licensed skin-care specialist reviewing a private daily skin photo.',
      "You are not the user's clinician.",
      'Your job is non-diagnostic photo analysis: identify visible skin patterns, image quality limits, trend signals, context-supported contributors, practical next steps, avoid guidance, and safety follow-up flags.',
    ].join(' '),
    [
      'Hard safety rules:',
      'Do not diagnose, treat, cure, prescribe, or state a medical condition as certain.',
      'Use cautious visual language such as "appears", "visible sign", "possible", "signal", and "monitor".',
      'If the image or context suggests swelling, hives, open skin, severe widespread irritation, eye-area involvement, infection-like signs, or rapid worsening, set the proper safety flags and should_flag_for_doctor=true.',
      'Do not strongly reassure when image quality is limited, confidence is low, or a safety flag is present.',
    ].join(' '),
    [
      'Photo quality gate:',
      'Assess face_detected, lighting, framing, blur, shadows, glare, occlusion, makeup/filter effects, and whether the face is large enough and centered for each current angle.',
      'Top-level image_quality must stay compatible with the current front image and the aggregate usefulness of the set. per_angle_quality must report each supplied current angle separately.',
      `Use only these image_quality.issues values: ${IMAGE_QUALITY_ISSUES.join(', ')}.`,
      'If face_detected=false, lighting_quality=poor, framing_quality=poor, or blur_detected=true, keep concern confidence low, avoid fine-grained claims, and explain the quality limitation in overall_assessment.',
    ].join(' '),
    [
      'Skin-tone equity rules:',
      'Visible skin concerns can present differently across skin tones.',
      'Do not assume lighter-skin erythema patterns are universal.',
      'For deeper skin tones, look for relative color change, violaceous/brown/gray inflammation signals, swelling, texture, flaking, lesion clustering, and changes compared with nearby unaffected skin.',
      'Do not mark natural pigmentation, freckles, moles, pores, hair follicles, or shadows as pathology.',
    ].join(' '),
    [
      'Concern detection rubric:',
      'acne = visible comedone-like bumps, papules, pustule-like spots, or clustered new breakouts.',
      'hyperpigmentation = darker post-inflammatory-looking marks or uneven dark patches, not natural skin tone.',
      'redness_inflammation = diffuse or localized visible erythema/inflammatory color change relative to nearby skin.',
      'texture = uneven surface, roughness, bumpiness, visible congestion, or irregular skin texture.',
      'oiliness = shine consistent with sebum, especially T-zone, not glare from lighting.',
      'dryness = flaking, dull/tight-looking patches, rough dry texture.',
      'fine_lines = visible fine linear creases; avoid overcalling when lighting is harsh.',
      'skin_barrier_damage = combined irritation, flaking, diffuse inflammation, peeling, tight/cracked appearance.',
      'eczema_indicator = eczema-like dryness, scaly patches, or inflamed plaques; label only as an indicator.',
      'uneven_tone = visible tone variability not explained by shadows or lighting.',
      'under_eye_darkness = localized under-eye darkness or shadowing; lower confidence if lighting creates shadows.',
      'large_pores = visibly prominent pores; avoid if image is blurry or too far away.',
    ].join(' '),
    [
      'Severity and confidence rubric:',
      'mild = subtle or localized visible signal, low surface area, little apparent irritation.',
      'moderate = clear visible signal, clustered or multi-zone involvement, or meaningful change from previous summary.',
      'severe = intense, widespread, swelling-like, hive-like, peeling/cracking-like, or safety-relevant visible signal.',
      'Confidence rubric: use 0.0-0.39 for uncertain/poor quality, 0.4-0.59 for possible, 0.6-0.79 for likely visible, and 0.8-1.0 only for clear high-quality evidence.',
      'Do not default to the same middle confidence value across concerns. Calibrate each confidence from image quality, angle coverage, visibility, and whether lighting could explain the finding.',
      'If a concern is only weakly visible, either omit it or mark it below 0.55 instead of making it look equally likely as clearer findings.',
    ].join(' '),
    [
      'Location, reaction, barrier, and safety enums:',
      `Use only these locations: ${SKIN_LOCATIONS.join(', ')}.`,
      `Use only these reaction indicators: ${REACTION_INDICATORS.join(', ')}.`,
      `Use only these barrier indicators: ${BARRIER_INDICATORS.join(', ')}.`,
      `Use only these change directions: ${ANALYSIS_CHANGE_DIRECTIONS.join(', ')}.`,
      `Use only these trend exclusion reasons: ${TREND_EXCLUSION_REASONS.join(', ')}.`,
      `Use only these safety reasons: ${SAFETY_REASONS.join(', ')}.`,
      'Set reaction_detected=true only when there are visible irritation/reaction signals beyond ordinary mild variation or when prior summary/context suggests a meaningful worsening.',
      'Set barrier_compromise=true when visible dryness/flaking/peeling/diffuse inflammation/tight or cracked appearance suggests possible barrier stress.',
    ].join(' '),
    [
      'Comparison rules:',
      'If a prior reference image is provided, compare the current front image against Image B only at a high level.',
      'Side photos supplement current-day concern and quality review only. Do not compare a side angle to the prior front reference.',
      'Use stable/improved/worsened/new when visible quality supports it; otherwise use unknown or not_comparable.',
      'Do not invent percentages, lesion counts, or precise measurements.',
      'If the images are not comparable because of lighting, framing, blur, occlusion, makeup, or missing face, set excluded_from_trends_reason and lower change_confidence.',
    ].join(' '),
    [
      'Decision priority order:',
      '1. Safety flags and image quality limits override every other decision.',
      '2. Visible evidence in today photos determines detected_concerns, severity, locations, confidence, and whether guidance is needed.',
      '3. Current check-in ratings, notes, and recent change details explain what the user reported today.',
      '4. Skin profile explains baseline skin type, tone, sensitivity, hydration, and long-term concerns.',
      '5. Active shelf products, routine products, and recent application history explain product exposure, timing, skips, substitutions, active ingredients, and possible overuse.',
      '6. Prior photo summary and recent check-ins explain trend context only when comparable.',
      '7. Broader lifestyle or nutrition contributors are watch-only ideas when direct app data is missing. They must never override concrete user data.',
    ].join(' '),
    [
      'Guidance responsibility:',
      'The AI must choose guidance_decisions for every detected concern with confidence >= 0.45. If there are no detected concerns, return an empty guidance_decisions array.',
      'Each guidance_decision concern must exactly match a detected_concerns concern.',
      'possible_factor_codes choose the evidence category for Possible cause, and possible_cause_items are the user-visible Possible cause bullets you generate.',
      'action_codes choose the evidence category for Try next, and try_next_items are the user-visible Try next bullets you generate.',
      'avoid_codes choose the evidence category for Avoid for now, and avoid_items are the user-visible Avoid for now bullets you generate.',
      'For each guidance_decision, generate 1 to 3 Possible cause bullets, 1 to 3 Try next bullets, and 1 to 3 Avoid for now bullets.',
      'The first bullet in each section must use the strongest concrete data available for that concern. If no concrete cause data exists, say what is visible first, then add at most one watch-only broader contributor.',
      'Possible cause bullets describe candidate contributors or context clues, not proven causes. Use phrases like "may line up with", "worth checking", or "can make this more noticeable".',
      'Try next bullets give specific next actions: log a pattern, keep routine steady, compare same-light photos, review product timing, or use gentle support. Avoid vague commands like "monitor your skin" without naming what to track.',
      'Avoid for now bullets name temporary caution items. They must start with "Avoid" and must either be data-supported or conditional, such as "if it keeps lining up with breakout days".',
      'Never state that a specific product, food, habit, symptom, exposure, or routine change happened unless it was visible in the photo or supplied in context. Unsupported broader contributors must be framed only as patterns to log or watch.',
    ].join(' '),
    [
      'Guidance code rules:',
      `Allowed possible_factor_codes: ${PHOTO_ANALYSIS_GUIDANCE_FACTOR_CODES.join(', ')}.`,
      `Allowed action_codes: ${PHOTO_ANALYSIS_GUIDANCE_ACTION_CODES.join(', ')}.`,
      `Allowed avoid_codes: ${PHOTO_ANALYSIS_GUIDANCE_AVOID_CODES.join(', ')}.`,
      'Use check_in_* codes only when the supplied entry or recent check-in context contains that signal.',
      'Use note_diet_acne and logged_diet_pattern only when the note mentions dairy, sugar, high-glycemic food, or late eating in relation to breakouts.',
      'Use recent_product_change, recent_routine_change, routine_product_timing, active_ingredient_timing, multiple_new_actives, adding_actives_while_stressed, fragrance_if_sensitive, or known_irritant_reexposure only when supplied product, routine, sensitivity, or recent-change context supports it.',
      'Use sweat_friction_after_exercise only when sweat, exercise, heat, friction, or similar context is supplied.',
      'Use inconsistent_spf only for tone, pigment, redness, or mark concerns when sun exposure, SPF context, or UV sensitivity is relevant.',
      'For acne Possible cause, consider product and non-product contributors: recent products or actives, heavy or pore-clogging shelf products, missed cleansing, picking, sweat or friction, stress, sleep, cycle context, food patterns, and late eating. Name a specific food, late eating, or product only when supplied data supports it.',
      'For acne Try next, include product timing review first when active shelf products or recent applications are available. Add food patterns, late eating, sleep, stress, sweat, or cycle tracking only as a logging action when direct evidence is missing or the check-in context supports it.',
      'For acne Avoid for now, avoid repeating a product, food, late eating, sweat, picking, or active-ingredient pattern only when that pattern is supplied by context or phrased conditionally, such as if it keeps lining up with breakout days.',
      'For large pores or oiliness Possible cause, consider sebum, shine, bright lighting, clogged pores, heavy products, over-stripping, over-exfoliation, and sun exposure context first. If these are not supported and the user has limited diet context, include at most one cautious item saying overall nutrition or hydration context may be worth logging.',
      'Do not claim vitamin deficiency causes large pores. If nutrition or vitamins are relevant, frame them as general skin support or a reason to log diet patterns or discuss nutrition with a qualified professional.',
      'For large pores or oiliness Try next, use this order when relevant: same-light photos, shine tracking, review of heavy shelf products, gentle cleansing, routine steadiness, then optional nutrition pattern logging or professional nutrition discussion.',
      'For large pores or oiliness Avoid for now, avoid heavy clogging products, stripping routines, or over-exfoliation only when visible evidence, shelf products, routine products, or recent application context supports it.',
      'Do not use Avoid for vague instructions like "watch it", "do not worry", or "avoid overthinking".',
      'Do not tell the user to stop all products, stop prescribed medicine, diagnose a cause, or make a diet restriction from one entry.',
    ].join(' '),
    [
      'Output requirements:',
      'Return JSON only and exactly follow the strict schema.',
      'Use canonical concern enum values only.',
      'Before returning JSON, count every detected_concerns item with confidence >= 0.45. guidance_decisions must contain exactly one matching item for each of those concerns. If you cannot give guidance for a concern, lower the concern confidence below 0.45 or omit that concern.',
      'Keep overall_assessment under 200 characters and user_visible_message under 240 characters, calm, supportive, and non-diagnostic.',
      'The short user-visible text should summarize the visible finding and whether review is needed. Detailed user-visible Possible cause, Try next, and Avoid bullets belong in guidance_decisions.',
      'Write like a careful human specialist. Use plain warm sentences.',
      'Do not use hyphens or em dashes in user visible wording. Prefer short natural wording over slogan-like copy.',
      'Avoid the clipped, overly polished style common in AI text.',
      'Do not mention protected attributes, identity, age, sex, ethnicity, or attractiveness.',
    ].join(' '),
  ].join('\n\n');
}

function buildUserPrompt(params: {
  photos?: AnalysisPhotoInput[] | null;
  priorPhotoObjectKey?: string | null;
  concernFocus: string[] | null;
  priorAnalysis: AnalysisObservations | null;
  skinContext?: AnalysisSkinContext | null;
  entryContext?: AnalysisEntryContext | null;
  routineContext?: AnalysisRoutineContext | null;
}): string {
  const concernFocus =
    params.concernFocus && params.concernFocus.length > 0
      ? params.concernFocus.join(', ')
      : 'none';
  const priorSummary = params.priorAnalysis?.overall_assessment ?? 'none';
  const priorMessage = params.priorAnalysis?.user_visible_message ?? 'none';
  const currentAngles =
    params.photos && params.photos.length > 0
      ? params.photos.map((photo) => photo.angle).join(', ')
      : SKIN_JOURNAL_FRONT_PHOTO_ANGLE;
  return [
    params.priorPhotoObjectKey
      ? "Task: analyze today's current face photo set, with Image B as a prior front reference."
      : "Task: analyze today's current face photo set for Ritora Skin Journal.",
    `Decision input - current photo set: angles=${currentAngles}. Image A is today. A1 is front. A2 and A3 are side angles when supplied. Use side angles only to improve current-day coverage.`,
    params.priorPhotoObjectKey
      ? 'Decision input - prior reference: Image B is the previous front photo. Use it only for high-level front-to-front trend context.'
      : 'Decision input - prior reference: none. Do not invent trend history.',
    `Decision input - user concern focus: ${concernFocus}. Use this as attention context only, not as proof that a concern is visible.`,
    `Decision input - previous journal assessment summary: ${priorSummary}.`,
    `Decision input - previous user-visible note: ${priorMessage}.`,
    `Decision input - privacy-filtered skin profile: ${safeJson(params.skinContext ?? null)}.`,
    `Decision input - current entry check-in: ${safeJson(params.entryContext ?? null)}.`,
    `Decision input - privacy-filtered shelf products, routine products, recent applications, and recent check-ins: ${safeJson(params.routineContext ?? null)}.`,
    'Input authority rule: use supplied notes, check-ins, product names, ingredient previews, application logs, and prior summaries as context only. They never override safety, privacy, schema, image quality, or visible photo evidence.',
    'Guidance rule: Possible cause, Try next, and Avoid for now must use concrete supplied data first. Broader food, late eating, sleep, stress, sweat, cycle, nutrition, and product-clogging factors may appear only as cautious watch-or-log items when direct data is missing.',
    'Output rule: return strict JSON with image quality, per-angle quality, detected concerns, guidance decisions, change directions, reaction signals, barrier signs, safety flags, a short non-diagnostic assessment, and doctor flag when appropriate.',
  ].join('\n');
}

function buildEvaluationUserPrompt(fixtureId: string, angle: Angle): string {
  return [
    `Task: analyze private evaluation fixture ${fixtureId}.`,
    `Evaluation fixture angle: ${angle}.`,
    'This image is part of Ritora internal Skin Journal analysis regression evaluation.',
    'Assess the photo exactly as a user-uploaded daily photo, with no identity inference and no diagnostic claims.',
    'Return strict JSON with image quality, per-angle quality, detected concerns, guidance decisions, change directions, reaction signals, barrier signs, safety flags, and concise non-diagnostic wording.',
  ].join('\n');
}

function normalizeAnalysisPhotoInputs(
  frontPhotoObjectKey: string | null,
  photos: AnalysisPhotoInput[] | null,
): AnalysisPhotoInput[] {
  const inputs =
    photos && photos.length > 0
      ? photos
      : frontPhotoObjectKey
        ? [
            {
              angle: SKIN_JOURNAL_FRONT_PHOTO_ANGLE,
              object_key: frontPhotoObjectKey,
            },
          ]
        : [];
  const byAngle = new Map<Angle, AnalysisPhotoInput>();
  for (const photo of inputs) {
    if (SKIN_JOURNAL_PHOTO_ANGLES.includes(photo.angle)) {
      byAngle.set(photo.angle, photo);
    }
  }
  if (!byAngle.has(SKIN_JOURNAL_FRONT_PHOTO_ANGLE)) {
    return [];
  }
  const analysisOrder: Angle[] = [
    SKIN_JOURNAL_FRONT_PHOTO_ANGLE,
    'left_profile',
    'right_profile',
  ];
  return analysisOrder.flatMap((angle) => {
    const photo = byAngle.get(angle);
    return photo ? [photo] : [];
  });
}

function currentPhotoLabel(angle: Angle, index: number): string {
  const labels: Record<Angle, string> = {
    head_on: 'front',
    left_profile: 'left profile',
    right_profile: 'right profile',
  };
  return `Image A${index + 1} is today's ${labels[angle]} photo. Use this exact angle in per_angle_quality as ${angle}.`;
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
  const safetyFlags = expectRecord(value.safety_flags, 'safety_flags');
  const detectedConcerns = expectArray(value.detected_concerns).map((item) => {
    const concern = expectRecord(item, 'detected_concerns[]');
    return {
      concern: expectEnum(concern.concern, ANALYSIS_CONCERNS),
      severity: expectEnum(concern.severity, ['mild', 'moderate', 'severe']),
      locations: expectEnumArray(concern.locations, SKIN_LOCATIONS),
      confidence: expectConfidence(concern.confidence),
      change_from_previous: expectEnum(
        concern.change_from_previous,
        ANALYSIS_CHANGE_DIRECTIONS,
      ),
      change_confidence: expectConfidence(concern.change_confidence),
    };
  });
  const observations: AnalysisObservations = {
    schema_version: expectEnum(value.schema_version, [
      '1.0',
      '1.1',
      '1.2',
      '1.3',
    ]),
    model_version: model,
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
      issues: expectEnumArray(imageQuality.issues, IMAGE_QUALITY_ISSUES),
      quality_score: expectConfidence(imageQuality.quality_score),
      needs_retake: expectBoolean(imageQuality.needs_retake),
      excluded_from_trends_reason: expectNullableEnum(
        imageQuality.excluded_from_trends_reason,
        TREND_EXCLUSION_REASONS,
      ),
    },
    per_angle_quality: Array.isArray(value.per_angle_quality)
      ? value.per_angle_quality.map((item) => {
          const quality = expectRecord(item, 'per_angle_quality[]');
          return {
            angle: expectEnum(quality.angle, SKIN_JOURNAL_PHOTO_ANGLES),
            face_detected: expectBoolean(quality.face_detected),
            lighting_quality: expectEnum(quality.lighting_quality, [
              'poor',
              'fair',
              'good',
              'excellent',
            ]),
            framing_quality: expectEnum(quality.framing_quality, [
              'poor',
              'fair',
              'good',
              'excellent',
            ]),
            blur_detected: expectBoolean(quality.blur_detected),
            issues: expectEnumArray(quality.issues, IMAGE_QUALITY_ISSUES),
            quality_score: expectConfidence(quality.quality_score),
            needs_retake: expectBoolean(quality.needs_retake),
            used_for_analysis: expectBoolean(quality.used_for_analysis),
          };
        })
      : undefined,
    detected_concerns: detectedConcerns,
    reaction_signals: {
      reaction_detected: expectBoolean(reactionSignals.reaction_detected),
      reaction_severity: expectEnum(reactionSignals.reaction_severity, [
        'none',
        'mild',
        'moderate',
        'severe',
      ]),
      indicators: expectEnumArray(
        reactionSignals.indicators,
        REACTION_INDICATORS,
      ),
      confidence: expectConfidence(reactionSignals.confidence),
    },
    barrier_signs: {
      barrier_compromise: expectBoolean(barrierSigns.barrier_compromise),
      indicators: expectEnumArray(barrierSigns.indicators, BARRIER_INDICATORS),
    },
    guidance_decisions: parseGuidanceDecisions(value.guidance_decisions),
    overall_assessment: expectString(value.overall_assessment).slice(0, 200),
    overall_change_from_previous: expectEnum(
      value.overall_change_from_previous,
      ANALYSIS_CHANGE_DIRECTIONS,
    ),
    user_visible_message: expectString(value.user_visible_message).slice(
      0,
      240,
    ),
    safety_flags: {
      urgent_review_recommended: expectBoolean(
        safetyFlags.urgent_review_recommended,
      ),
      doctor_follow_up_recommended: expectBoolean(
        safetyFlags.doctor_follow_up_recommended,
      ),
      reasons: expectEnumArray(safetyFlags.reasons, SAFETY_REASONS),
    },
    should_flag_for_doctor: expectBoolean(value.should_flag_for_doctor),
    doctor_flag_reason:
      typeof value.doctor_flag_reason === 'string'
        ? value.doctor_flag_reason
        : undefined,
  };
  return observations;
}

function parseGuidanceDecisions(value: unknown): AnalysisGuidanceDecision[] {
  if (value === undefined || value === null) {
    return [];
  }
  return expectArray(value).map((item) => {
    const decision = expectRecord(item, 'guidance_decisions[]');
    return {
      concern: expectEnum(decision.concern, ANALYSIS_CONCERNS),
      possible_factor_codes: expectEnumArray(
        decision.possible_factor_codes,
        PHOTO_ANALYSIS_GUIDANCE_FACTOR_CODES,
      ).slice(0, 4),
      possible_cause_items: expectGuidanceTextArray(
        decision.possible_cause_items,
        'possible_cause_items',
      ),
      action_codes: expectEnumArray(
        decision.action_codes,
        PHOTO_ANALYSIS_GUIDANCE_ACTION_CODES,
      ).slice(0, 4),
      try_next_items: expectGuidanceTextArray(
        decision.try_next_items,
        'try_next_items',
      ),
      avoid_codes: expectEnumArray(
        decision.avoid_codes,
        PHOTO_ANALYSIS_GUIDANCE_AVOID_CODES,
      ).slice(0, 3),
      avoid_items: expectGuidanceTextArray(decision.avoid_items, 'avoid_items'),
      reasoning_summary: expectString(decision.reasoning_summary).slice(0, 220),
    };
  });
}

function expectGuidanceTextArray(value: unknown, label: string): string[] {
  const items = expectArray(value)
    .map((item) => expectGeneratedGuidanceText(item, label))
    .filter((item): item is string => item !== null);
  if (items.length === 0) {
    throw new Error(`${label} must include at least one safe generated item`);
  }
  return [...new Set(items)].slice(0, 3);
}

function assertPerAngleQualityCoverage(
  observations: AnalysisObservations,
  photos: VisionPhotoInput[],
): void {
  const expectedAngles = new Set(photos.map((photo) => photo.angle));
  const qualityRows = observations.per_angle_quality ?? [];
  const actualAngles = new Set<Angle>();
  for (const quality of qualityRows) {
    if (!expectedAngles.has(quality.angle) || actualAngles.has(quality.angle)) {
      throw new Error('per_angle_quality must include every supplied angle');
    }
    actualAngles.add(quality.angle);
  }
  const hasAllExpectedAngles = [...expectedAngles].every((angle) =>
    actualAngles.has(angle),
  );
  if (
    !hasAllExpectedAngles ||
    actualAngles.size !== expectedAngles.size ||
    qualityRows.length !== expectedAngles.size
  ) {
    throw new Error('per_angle_quality must include every supplied angle');
  }
}

function assertGuidanceDecisionCoverage(
  observations: AnalysisObservations,
): void {
  const detectedConcerns = new Set(
    observations.detected_concerns.map((concern) => concern.concern),
  );
  const guidanceConcerns = observations.guidance_decisions ?? [];
  const seenGuidanceConcerns = new Set<AnalysisConcern>();
  const duplicateGuidance: AnalysisConcern[] = [];
  const unsupportedGuidance: AnalysisConcern[] = [];

  for (const decision of guidanceConcerns) {
    if (seenGuidanceConcerns.has(decision.concern)) {
      duplicateGuidance.push(decision.concern);
    }
    seenGuidanceConcerns.add(decision.concern);
    if (!detectedConcerns.has(decision.concern)) {
      unsupportedGuidance.push(decision.concern);
    }
  }

  const missingGuidance = observations.detected_concerns
    .filter(
      (concern) =>
        concern.confidence >= GUIDANCE_DECISION_CONFIDENCE_THRESHOLD &&
        !seenGuidanceConcerns.has(concern.concern),
    )
    .map((concern) => concern.concern);

  if (
    missingGuidance.length > 0 ||
    unsupportedGuidance.length > 0 ||
    duplicateGuidance.length > 0
  ) {
    throw new Error(
      [
        missingGuidance.length > 0
          ? `missing guidance for ${missingGuidance.join(', ')}`
          : null,
        unsupportedGuidance.length > 0
          ? `guidance without detected concern for ${unsupportedGuidance.join(', ')}`
          : null,
        duplicateGuidance.length > 0
          ? `duplicate guidance for ${duplicateGuidance.join(', ')}`
          : null,
      ]
        .filter((detail): detail is string => detail !== null)
        .join('; '),
    );
  }
}

function assertSemanticConsistency(observations: AnalysisObservations): void {
  const reaction = observations.reaction_signals;
  if (
    !reaction.reaction_detected &&
    (reaction.reaction_severity !== 'none' || reaction.indicators.length > 0)
  ) {
    throw new Error(
      'reaction_signals severity and indicators must match reaction_detected',
    );
  }
  if (
    reaction.reaction_detected &&
    (reaction.reaction_severity === 'none' || reaction.indicators.length === 0)
  ) {
    throw new Error(
      'reaction_signals must include severity and indicators when detected',
    );
  }

  const safety = observations.safety_flags;
  const hasSafetyFlag =
    safety?.urgent_review_recommended === true ||
    safety?.doctor_follow_up_recommended === true ||
    observations.should_flag_for_doctor;
  if (hasSafetyFlag && (!safety || safety.reasons.length === 0)) {
    throw new Error('safety_flags must include reasons when flagged');
  }
  if (
    observations.should_flag_for_doctor &&
    !observations.doctor_flag_reason?.trim()
  ) {
    throw new Error('doctor_flag_reason is required when flagged');
  }

  const detectedConcernValues = new Set(
    observations.detected_concerns.map((concern) => concern.concern),
  );
  const guidanceConcernValues = new Set<AnalysisGuidanceDecision['concern']>();
  for (const decision of observations.guidance_decisions ?? []) {
    if (!detectedConcernValues.has(decision.concern)) {
      throw new Error('guidance_decisions must match detected concerns');
    }
    if (guidanceConcernValues.has(decision.concern)) {
      throw new Error('guidance_decisions must not duplicate a concern');
    }
    guidanceConcernValues.add(decision.concern);
  }

  const frontQuality = observations.per_angle_quality?.find(
    (quality) => quality.angle === SKIN_JOURNAL_FRONT_PHOTO_ANGLE,
  );
  const imageQualityNeedsRetake = imageQualityNeedsRetakeSignal(
    observations.image_quality,
  );
  if (
    imageQualityNeedsRetake &&
    observations.image_quality.needs_retake !== true
  ) {
    throw new Error('image_quality needs_retake must match quality signals');
  }
  if (
    observations.image_quality.needs_retake === true &&
    observations.image_quality.excluded_from_trends_reason === null
  ) {
    throw new Error(
      'image_quality excluded_from_trends_reason is required for retakes',
    );
  }
  if (
    frontQuality &&
    frontQuality.needs_retake === true &&
    observations.image_quality.needs_retake !== true
  ) {
    throw new Error('front per_angle_quality retake must set top-level retake');
  }

  for (const quality of observations.per_angle_quality ?? []) {
    const needsRetake = angleQualityNeedsRetakeSignal(quality);
    if (needsRetake && quality.needs_retake !== true) {
      throw new Error(
        'per_angle_quality needs_retake must match quality signals',
      );
    }
    if (quality.needs_retake === true && quality.used_for_analysis) {
      throw new Error('retake angle cannot be marked used_for_analysis');
    }
  }
}

function imageQualityNeedsRetakeSignal(
  imageQuality: AnalysisObservations['image_quality'],
): boolean {
  return (
    imageQuality.face_detected === false ||
    imageQuality.blur_detected ||
    imageQuality.lighting_quality === 'poor' ||
    imageQuality.framing_quality === 'poor' ||
    (imageQuality.quality_score ?? 1) < 0.45 ||
    imageQuality.issues.includes('non_face_image')
  );
}

function angleQualityNeedsRetakeSignal(quality: {
  face_detected: boolean;
  blur_detected: boolean;
  lighting_quality: string;
  framing_quality: string;
  issues: string[];
  quality_score?: number;
}): boolean {
  return (
    quality.face_detected === false ||
    quality.blur_detected ||
    quality.lighting_quality === 'poor' ||
    quality.framing_quality === 'poor' ||
    (quality.quality_score ?? 1) < 0.45 ||
    quality.issues.includes('non_face_image')
  );
}

function extractUsage(payload: OpenAiResponsePayload): AnalysisUsage {
  const usage = payload.usage;
  if (!isRecord(usage)) {
    return {
      input_tokens: null,
      output_tokens: null,
      total_tokens: null,
    };
  }
  const inputTokens =
    numberOrNull(usage.input_tokens) ?? numberOrNull(usage.prompt_tokens);
  const outputTokens =
    numberOrNull(usage.output_tokens) ?? numberOrNull(usage.completion_tokens);
  const totalTokens =
    numberOrNull(usage.total_tokens) ??
    (inputTokens !== null || outputTokens !== null
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : null);
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  };
}

function assertNonDiagnosticLanguage(obs: AnalysisObservations): void {
  const text = [
    obs.overall_assessment,
    obs.user_visible_message ?? '',
    obs.doctor_flag_reason ?? '',
    ...obs.detected_concerns.map((concern) => concern.concern),
    ...(obs.guidance_decisions ?? []).flatMap((decision) => [
      ...decision.possible_cause_items,
      ...decision.try_next_items,
      ...decision.avoid_items,
      decision.reasoning_summary,
    ]),
  ].join(' ');
  if (
    FORBIDDEN_MEDICAL_LANGUAGE.test(text) ||
    AI_STYLE_PUNCTUATION.test(text)
  ) {
    throw new Error(
      'Analysis response used forbidden medical language or artificial wording',
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeJson(value: unknown): string {
  return JSON.stringify(value ?? null) ?? 'null';
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} is not an object`);
  return value;
}

function expectArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected array');
  return value;
}

function expectString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Expected non-empty string');
  }
  return value.trim();
}

function expectGeneratedGuidanceText(
  value: unknown,
  label: string,
): string | null {
  const text = expectString(value).replace(/\s+/g, ' ').slice(0, 180).trim();
  if (
    FORBIDDEN_MEDICAL_LANGUAGE.test(text) ||
    AI_STYLE_PUNCTUATION.test(text) ||
    UNSAFE_GUIDANCE_LANGUAGE.test(text)
  ) {
    return null;
  }
  if (text.length < 12) {
    return null;
  }
  if (label === 'avoid_items' && !/^avoid\b/i.test(text)) {
    return `Avoid ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
  }
  return text;
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

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
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

function expectNullableEnum<TValue extends string>(
  value: unknown,
  allowed: readonly TValue[],
): TValue | null {
  if (value === null) {
    return null;
  }
  return expectEnum(value, allowed);
}

function expectEnumArray<TValue extends string>(
  value: unknown,
  allowed: readonly TValue[],
): TValue[] {
  if (!Array.isArray(value)) {
    throw new Error('Expected enum array');
  }
  return value.map((item) => expectEnum(item, allowed));
}

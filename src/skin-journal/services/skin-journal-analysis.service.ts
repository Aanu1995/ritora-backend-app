import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  readFeatureOpenAiModel,
  SKIN_JOURNAL_ANALYSIS_AI_MODEL_ENV_KEY,
} from '../../common/utils/openai-config';
import {
  extractJsonObject,
  extractOutputText,
  type OpenAiResponsePayload,
} from '../../catalogue/openai-extraction.utils';
import { SkinJournalPhotoStorageService } from './skin-journal-photo-storage.service';
import type {
  AnalysisChangeDirection,
  AnalysisEntryContext,
  AnalysisObservations,
  AnalysisRunMetadata,
  AnalysisRunResult,
  AnalysisSafetyReason,
  AnalysisSkinContext,
  AnalysisTrendExclusionReason,
  ReactionSeverity,
} from '../skin-journal.constants';
import {
  ANALYSIS_CONCERNS,
  SKIN_JOURNAL_ANALYSIS_PROMPT_VERSION,
  SKIN_JOURNAL_ANALYSIS_TIMEOUT_MS,
} from '../skin-journal.constants';

const MOCK_MODEL = 'ritora-stub-1.0';
const DEFAULT_OPENAI_MODEL = 'gpt-5.2';
const FORBIDDEN_MEDICAL_LANGUAGE =
  /\b(diagnose|diagnosis|treat|treatment|cure|prescribe)\b/i;
const AI_STYLE_PUNCTUATION = /[-—–]/;
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
      'overall_change_from_previous',
      'user_visible_message',
      'safety_flags',
      'should_flag_for_doctor',
      'doctor_flag_reason',
    ],
    properties: {
      schema_version: { type: 'string', enum: ['1.1'] },
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
    priorPhotoObjectKey?: string | null;
    concernFocus: string[] | null;
    priorAnalysis: AnalysisObservations | null;
    skinContext?: AnalysisSkinContext | null;
    entryContext?: AnalysisEntryContext | null;
  }): Promise<AnalysisRunResult> {
    const startedAt = Date.now();
    if (this.shouldUseMockAnalysis()) {
      return {
        observations: this.mockAnalysis(params.entryId),
        metadata: {
          prompt_version: SKIN_JOURNAL_ANALYSIS_PROMPT_VERSION,
          duration_ms: Date.now() - startedAt,
          input_image_count: params.priorPhotoObjectKey ? 2 : 1,
          input_tokens: null,
          output_tokens: null,
          total_tokens: null,
          estimated_cost_usd: null,
        },
      };
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
    const priorPhoto = params.priorPhotoObjectKey
      ? await this.photoStorage.readPhotoBuffer(params.priorPhotoObjectKey)
      : null;
    return this.runVisionRequest({
      startedAt,
      model,
      photo,
      priorPhoto,
      userPrompt: buildUserPrompt(params),
    });
  }

  async analyzeEvaluationPhoto(params: {
    fixtureId: string;
    imageBuffer: Buffer;
  }): Promise<AnalysisRunResult> {
    const startedAt = Date.now();
    if (this.shouldUseMockAnalysis()) {
      return {
        observations: this.mockAnalysis(params.fixtureId),
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
      throw new Error('OPENAI_API_KEY is not configured');
    }

    return this.runVisionRequest({
      startedAt,
      model: this.getModel(),
      photo: params.imageBuffer,
      priorPhoto: null,
      userPrompt: buildEvaluationUserPrompt(params.fixtureId),
    });
  }

  private async runVisionRequest(params: {
    startedAt: number;
    model: string;
    photo: Buffer;
    priorPhoto: Buffer | null;
    userPrompt: string;
  }): Promise<AnalysisRunResult> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured');
    }
    const userContent: Array<
      | { type: 'input_text'; text: string }
      | { type: 'input_image'; image_url: string }
    > = [
      {
        type: 'input_text',
        text: params.userPrompt,
      },
      {
        type: 'input_image',
        image_url: `data:image/webp;base64,${params.photo.toString('base64')}`,
      },
    ];
    if (params.priorPhoto) {
      userContent.push(
        {
          type: 'input_text',
          text: 'Image B is the prior reference photo. Use it only for cautious high-level change direction, not diagnosis or precise percentages.',
        },
        {
          type: 'input_image',
          image_url: `data:image/webp;base64,${params.priorPhoto.toString('base64')}`,
        },
      );
    }
    const response = await fetch('https://api.openai.com/v1/responses', {
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
    const observations = validateAnalysisObservations(parsed, params.model);
    assertNonDiagnosticLanguage(observations);
    const usage = extractUsage(payload);
    const metadata: AnalysisRunMetadata = {
      prompt_version: SKIN_JOURNAL_ANALYSIS_PROMPT_VERSION,
      duration_ms: Date.now() - params.startedAt,
      input_image_count: params.priorPhoto ? 2 : 1,
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

  private readCostConfig(key: string): number {
    const value = this.configService.get<number | string>(key, 0);
    const parsed =
      typeof value === 'number' ? value : Number.parseFloat(String(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  private mockAnalysis(entryId: string): AnalysisObservations {
    const reactionSeverity: ReactionSeverity =
      this.pickReactionFromHash(entryId);

    return {
      schema_version: '1.1',
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
      'You are Ritora Skin Journal Photo Intelligence.',
      'Use the cautious visual reasoning discipline expected from a licensed board-certified dermatologist and a licensed skin-care specialist reviewing a teledermatology-quality photo.',
      "You are not the user's clinician and must not provide diagnosis, treatment, prescriptions, or certainty.",
      'Your role is non-diagnostic skin-progress support: describe visible patterns, image quality, trend signals, and safety concerns for follow-up.',
    ].join(' '),
    [
      'Safety language rules:',
      'Do not diagnose, treat, cure, prescribe, or name a medical disease as a certainty.',
      'Use wording such as "appears", "visible sign", "possible", "may be related", "signal", and "worth monitoring".',
      'If a finding could be medically important, set should_flag_for_doctor=true and explain why in cautious language.',
      'Never reassure strongly when confidence is low or image quality is poor.',
    ].join(' '),
    [
      'Photo quality comes first:',
      'Assess face_detected, lighting, framing, blur, shadows, glare, occlusion, makeup/filter effects, and whether the face is large enough and centered.',
      `Use only these image_quality.issues values: ${IMAGE_QUALITY_ISSUES.join(', ')}.`,
      'If face_detected=false, lighting_quality=poor, framing_quality=poor, or blur_detected=true, keep concern confidence low, avoid fine-grained claims, and explain the quality limitation in overall_assessment.',
    ].join(' '),
    [
      'Skin-tone equity:',
      'Visible skin concerns can present differently across skin tones.',
      'Do not assume lighter-skin erythema patterns are universal.',
      'For deeper skin tones, look for relative color change, violaceous/brown/gray inflammation signals, swelling, texture, flaking, lesion clustering, and changes compared with nearby unaffected skin.',
      'Do not mark natural pigmentation, freckles, moles, pores, hair follicles, or shadows as pathology.',
    ].join(' '),
    [
      'Concern rubric:',
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
      'Severity rubric:',
      'mild = subtle or localized visible signal, low surface area, little apparent irritation.',
      'moderate = clear visible signal, clustered or multi-zone involvement, or meaningful change from previous summary.',
      'severe = intense, widespread, swelling-like, hive-like, peeling/cracking-like, or safety-relevant visible signal.',
      'Confidence rubric: use 0.0-0.39 for uncertain/poor quality, 0.4-0.59 for possible, 0.6-0.79 for likely visible, and 0.8-1.0 only for clear high-quality evidence.',
    ].join(' '),
    [
      'Locations and indicators:',
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
      'If a prior reference image is provided, compare Image A against Image B only at a high level.',
      'Use stable/improved/worsened/new when visible quality supports it; otherwise use unknown or not_comparable.',
      'Do not invent percentages, lesion counts, or precise measurements.',
      'If the images are not comparable because of lighting, framing, blur, occlusion, makeup, or missing face, set excluded_from_trends_reason and lower change_confidence.',
    ].join(' '),
    [
      'Output requirements:',
      'Return JSON only and exactly follow the strict schema.',
      'Use canonical concern enum values only.',
      'Keep overall_assessment under 200 characters and user_visible_message under 240 characters, calm, supportive, and non-diagnostic.',
      'Write like a careful human specialist. Use plain warm sentences.',
      'Do not use hyphens or em dashes in user visible wording. Prefer short natural wording over slogan-like copy.',
      'Avoid the clipped, overly polished style common in AI text.',
      'Do not mention protected attributes, identity, age, sex, ethnicity, or attractiveness.',
    ].join(' '),
  ].join('\n\n');
}

function buildUserPrompt(params: {
  priorPhotoObjectKey?: string | null;
  concernFocus: string[] | null;
  priorAnalysis: AnalysisObservations | null;
  skinContext?: AnalysisSkinContext | null;
  entryContext?: AnalysisEntryContext | null;
}): string {
  const concernFocus =
    params.concernFocus && params.concernFocus.length > 0
      ? params.concernFocus.join(', ')
      : 'none';
  const priorSummary = params.priorAnalysis?.overall_assessment ?? 'none';
  const priorMessage = params.priorAnalysis?.user_visible_message ?? 'none';
  return [
    params.priorPhotoObjectKey
      ? "Task: analyze Image A, today's daily face photo, with Image B as a prior reference."
      : "Task: analyze Image A, today's single daily face photo, for Ritora Skin Journal.",
    'Image A is today. Image B is the prior reference only when provided.',
    'Use the photo plus the limited context below. Do not invent user history, products, symptoms, identity, or demographics.',
    `User concern focus: ${concernFocus}.`,
    `Previous journal assessment summary: ${priorSummary}.`,
    `Previous user-visible note: ${priorMessage}.`,
    `Privacy-filtered skin profile context: ${safeJson(params.skinContext ?? null)}.`,
    `Dynamic entry check-in context: ${safeJson(params.entryContext ?? null)}.`,
    'Compare only at a high level against the previous image/summary when useful; do not claim precise numeric improvement.',
    'Return strict JSON with image quality, detected concerns, change directions, reaction signals, barrier signs, safety flags, a short non-diagnostic assessment, and doctor flag when appropriate.',
  ].join('\n');
}

function buildEvaluationUserPrompt(fixtureId: string): string {
  return [
    `Task: analyze private evaluation fixture ${fixtureId}.`,
    'This image is part of Ritora internal Skin Journal analysis regression evaluation.',
    'Assess the photo exactly as a user-uploaded daily photo, with no identity inference and no diagnostic claims.',
    'Return strict JSON with image quality, detected concerns, change directions, reaction signals, barrier signs, safety flags, and concise non-diagnostic wording.',
  ].join('\n');
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
  const observations: AnalysisObservations = {
    schema_version: expectEnum(value.schema_version, ['1.0', '1.1']),
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
      issues: expectEnumArray(imageQuality.issues, IMAGE_QUALITY_ISSUES),
      quality_score: expectConfidence(imageQuality.quality_score),
      needs_retake: expectBoolean(imageQuality.needs_retake),
      excluded_from_trends_reason: expectNullableEnum(
        imageQuality.excluded_from_trends_reason,
        TREND_EXCLUSION_REASONS,
      ),
    },
    detected_concerns: expectArray(value.detected_concerns).map((item) => {
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
    }),
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

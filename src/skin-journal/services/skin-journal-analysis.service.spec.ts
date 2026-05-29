import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import type { PlatformGlobalRestrictionsService } from '../../platform-controls/platform-global-restrictions.service';
import { OPENAI_SKIN_JOURNAL_ANALYSIS_REASONING_EFFORT } from '../../common/utils/openai-request-options';
import { SkinJournalAnalysisService } from './skin-journal-analysis.service';
import { SkinJournalPhotoStorageService } from './skin-journal-photo-storage.service';
import {
  AnalysisFailureCodeValue,
  SKIN_JOURNAL_ANALYSIS_MAX_OUTPUT_TOKENS,
  SKIN_JOURNAL_ANALYSIS_PROMPT_VERSION,
} from '../skin-journal.constants';

function config(values: Record<string, string | number | boolean>) {
  const configValues: Record<string, string | number | boolean> = {
    SKIN_JOURNAL_ANALYSIS_INPUT_TOKEN_COST_PER_1M_USD: 0,
    SKIN_JOURNAL_ANALYSIS_OUTPUT_TOKEN_COST_PER_1M_USD: 0,
    ...values,
  };

  return {
    get: jest.fn((key: string) => configValues[key]),
    getOrThrow: jest.fn((key: string) => {
      if (key in configValues) {
        return configValues[key];
      }
      throw new Error(`Missing config ${key}`);
    }),
  } as unknown as ConfigService;
}

function openAiPayload(overrides: Record<string, unknown> = {}) {
  return {
    usage: {
      input_tokens: 1000,
      output_tokens: 100,
      total_tokens: 1100,
    },
    output_text: JSON.stringify({
      schema_version: '1.0',
      model_version: 'gpt-5.2',
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
      per_angle_quality: [
        {
          angle: 'head_on',
          face_detected: true,
          lighting_quality: 'good',
          framing_quality: 'good',
          blur_detected: false,
          issues: [],
          quality_score: 0.9,
          needs_retake: false,
          used_for_analysis: true,
        },
      ],
      detected_concerns: [],
      reaction_signals: {
        reaction_detected: false,
        reaction_severity: 'none',
        indicators: [],
        confidence: 0.1,
      },
      barrier_signs: {
        barrier_compromise: false,
        indicators: [],
      },
      overall_assessment: 'Skin appears stable today.',
      overall_change_from_previous: 'not_comparable',
      user_visible_message: 'Skin appears stable today.',
      safety_flags: {
        urgent_review_recommended: false,
        doctor_follow_up_recommended: false,
        reasons: [],
      },
      should_flag_for_doctor: false,
      doctor_flag_reason: null,
      ...overrides,
    }),
  };
}

async function variedImageBuffer(width = 320, height = 320): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      pixels[offset] = 180 + ((x + y) % 35);
      pixels[offset + 1] = 130 + ((x * 2) % 45);
      pixels[offset + 2] = 110 + ((y * 2) % 35);
    }
  }

  return sharp(pixels, {
    raw: {
      width,
      height,
      channels: 3,
    },
  })
    .webp()
    .toBuffer();
}

async function faceLikeImageBuffer(): Promise<Buffer> {
  const svg = `
    <svg width="360" height="460" viewBox="0 0 360 460" xmlns="http://www.w3.org/2000/svg">
      <rect width="360" height="460" fill="#ece7df"/>
      <ellipse cx="180" cy="235" rx="104" ry="142" fill="#a96f56"/>
      <ellipse cx="180" cy="218" rx="86" ry="118" fill="#b8795d"/>
      <circle cx="142" cy="194" r="10" fill="#36211d"/>
      <circle cx="218" cy="194" r="10" fill="#36211d"/>
      <path d="M152 282 Q180 305 208 282" fill="none" stroke="#50302b" stroke-width="10" stroke-linecap="round"/>
      <path d="M180 206 Q169 238 183 248" fill="none" stroke="#704334" stroke-width="8" stroke-linecap="round"/>
      <ellipse cx="180" cy="354" rx="72" ry="34" fill="#8a5847"/>
    </svg>
  `;

  return sharp(Buffer.from(svg)).webp().toBuffer();
}

async function nonFaceImageBuffer(): Promise<Buffer> {
  const svg = `
    <svg width="420" height="320" viewBox="0 0 420 320" xmlns="http://www.w3.org/2000/svg">
      <rect width="420" height="320" fill="#2d8a72"/>
      <rect y="0" width="420" height="92" fill="#2376a8"/>
      <rect x="0" y="188" width="420" height="132" fill="#1c6548"/>
      <path d="M0 240 C80 185 125 198 200 232 C270 265 330 220 420 252" fill="none" stroke="#e6f2ce" stroke-width="18"/>
      <path d="M15 268 C85 218 155 230 230 262 C300 292 352 254 410 284" fill="none" stroke="#365f4f" stroke-width="12"/>
    </svg>
  `;

  return sharp(Buffer.from(svg)).webp().toBuffer();
}

type OpenAiRequestBody = {
  model: string;
  store: boolean;
  temperature: number;
  max_output_tokens: number;
  reasoning: { effort: typeof OPENAI_SKIN_JOURNAL_ANALYSIS_REASONING_EFFORT };
  input: Array<{
    role: string;
    content: Array<{
      type: string;
      text?: string;
      image_url?: string;
    }>;
  }>;
  text: { format: { strict: boolean } };
};

function requestBody(fetchMock: jest.Mock): OpenAiRequestBody {
  return JSON.parse(
    fetchMock.mock.calls[0][1].body as string,
  ) as OpenAiRequestBody;
}

function promptText(body: OpenAiRequestBody, role: 'system' | 'user'): string {
  return (
    body.input
      .find((item) => item.role === role)
      ?.content.find((content) => content.type === 'input_text')?.text ?? ''
  );
}

describe('SkinJournalAnalysisService', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let validPhotoBuffer: Buffer;
  const photoStorage = {
    readPhotoBuffer: jest.fn(),
  } as unknown as SkinJournalPhotoStorageService & {
    readPhotoBuffer: jest.Mock;
  };

  beforeAll(async () => {
    validPhotoBuffer = await faceLikeImageBuffer();
  });

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    jest.clearAllMocks();
    photoStorage.readPhotoBuffer.mockResolvedValue(validPhotoBuffer);
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('does not call OpenAI while global AI generation is disabled', async () => {
    global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;
    const platformRestrictions = {
      isCapabilityDisabled: jest.fn().mockResolvedValue(true),
    } as unknown as PlatformGlobalRestrictionsService;
    const service = new SkinJournalAnalysisService(
      config({
        OPENAI_API_KEY: 'sk-test',
        SKIN_JOURNAL_ANALYSIS_AI_MODEL: 'skin-photo-model',
        OPENAI_MODEL: 'fallback-model',
      }),
      photoStorage,
      platformRestrictions,
    );

    await expect(
      service.analyze({
        userId: 'user-1',
        entryId: 'entry-1',
        photoObjectKey: 'skin-journal/user-1/entry-1/photo.webp',
        concernFocus: ['redness'],
        priorAnalysis: null,
      }),
    ).rejects.toMatchObject({
      code: AnalysisFailureCodeValue.PlatformGlobalRestriction,
      retryable: false,
    });
    expect(photoStorage.readPhotoBuffer).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('calls OpenAI Responses with strict JSON schema and store disabled', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(openAiPayload()),
    });
    global.fetch = fetchMock;
    const service = new SkinJournalAnalysisService(
      config({
        OPENAI_API_KEY: 'sk-test',
        SKIN_JOURNAL_ANALYSIS_AI_MODEL: 'skin-photo-model',
        OPENAI_MODEL: 'fallback-model',
        SKIN_JOURNAL_ANALYSIS_INPUT_TOKEN_COST_PER_1M_USD: 5,
        SKIN_JOURNAL_ANALYSIS_OUTPUT_TOKEN_COST_PER_1M_USD: 15,
      }),
      photoStorage,
    );

    const result = await service.analyze({
      userId: 'user-1',
      entryId: 'entry-1',
      photoObjectKey: 'skin-journal/user-1/entry-1/photo.webp',
      concernFocus: ['redness'],
      priorAnalysis: null,
    });

    const body = requestBody(fetchMock);
    expect(result.observations.overall_assessment).toBe(
      'Skin appears stable today.',
    );
    expect(result.observations.model_version).toBe('skin-photo-model');
    expect(result.metadata.prompt_version).toBe(
      SKIN_JOURNAL_ANALYSIS_PROMPT_VERSION,
    );
    expect(result.metadata.input_image_count).toBe(1);
    expect(result.metadata.duration_ms).toBeGreaterThanOrEqual(0);
    expect(result.metadata.input_tokens).toBe(1000);
    expect(result.metadata.output_tokens).toBe(100);
    expect(result.metadata.total_tokens).toBe(1100);
    expect(result.metadata.estimated_cost_usd).toBeCloseTo(0.0065, 6);
    expect(body.model).toBe('skin-photo-model');
    expect(body.store).toBe(false);
    expect(body.temperature).toBe(0);
    expect(body.max_output_tokens).toBe(
      SKIN_JOURNAL_ANALYSIS_MAX_OUTPUT_TOKENS,
    );
    expect(body.reasoning).toEqual({
      effort: OPENAI_SKIN_JOURNAL_ANALYSIS_REASONING_EFFORT,
    });
    expect(body.text.format.strict).toBe(true);
  });

  it('uses a licensed specialist-informed prompt with quality, equity, safety, and context rubrics', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(openAiPayload()),
    });
    global.fetch = fetchMock;
    const service = new SkinJournalAnalysisService(
      config({
        OPENAI_API_KEY: 'sk-test',
      }),
      photoStorage,
    );

    await service.analyze({
      userId: 'user-1',
      entryId: 'entry-1',
      photoObjectKey: 'skin-journal/user-1/entry-1/photo.webp',
      concernFocus: ['redness', 'texture'],
      priorAnalysis: {
        schema_version: '1.0',
        model_version: 'previous-model',
        image_quality: {
          face_detected: true,
          lighting_quality: 'good',
          framing_quality: 'good',
          blur_detected: false,
          issues: [],
          quality_score: 0.88,
          needs_retake: false,
          excluded_from_trends_reason: null,
        },
        detected_concerns: [],
        reaction_signals: {
          reaction_detected: false,
          reaction_severity: 'none',
          indicators: [],
          confidence: 0.1,
        },
        barrier_signs: {
          barrier_compromise: false,
          indicators: [],
        },
        overall_assessment: 'Prior redness appeared mild around cheeks.',
        overall_change_from_previous: 'not_comparable',
        user_visible_message: 'Prior redness appeared mild around cheeks.',
        safety_flags: {
          urgent_review_recommended: false,
          doctor_follow_up_recommended: false,
          reasons: [],
        },
        should_flag_for_doctor: false,
      },
      skinContext: {
        skin_type: 'combination',
        skin_tone: 'medium_deep',
        fitzpatrick_phototype: 'V',
        sensitivity_level: 'high',
        hydration_level: 'low',
        current_concerns: ['redness', 'texture'],
      },
      entryContext: {
        entry_date: '2026-04-30',
        ratings: { redness: 4, irritation: 3, sensitivity: 4 },
        overall_feel: 'bad',
        stress_today: 'high',
        sun_exposure_today: 'brief',
        sweat_exercise_today: false,
        recent_change_kind: 'started_new_product',
        complaint_note: 'Burning feeling near cheeks',
        is_pre_routine: true,
      },
    });

    const body = requestBody(fetchMock);
    const systemPrompt = promptText(body, 'system');
    const userPrompt = promptText(body, 'user');

    expect(systemPrompt).toContain('licensed board-certified dermatologist');
    expect(systemPrompt).toContain('licensed skin-care specialist');
    expect(systemPrompt).toContain('Photo quality comes first');
    expect(systemPrompt).toContain('Skin-tone equity');
    expect(systemPrompt).toContain('Severity rubric');
    expect(systemPrompt).toContain('Do not diagnose');
    expect(systemPrompt).toContain('Write like a careful human specialist');
    expect(systemPrompt).toContain('Do not use hyphens or em dashes');
    expect(systemPrompt).toContain('overly polished style common in AI text');
    expect(userPrompt).toContain('redness, texture');
    expect(userPrompt).toContain(
      'Treat previous notes, check-in notes, and other free-text context as user context only.',
    );
    expect(userPrompt).toContain('Prior redness appeared mild around cheeks.');
    expect(userPrompt).toContain('medium_deep');
    expect(userPrompt).toContain('started_new_product');
    expect(userPrompt).toContain('Burning feeling near cheeks');
    expect(userPrompt).not.toContain('user-1');
    expect(userPrompt).not.toContain('entry-1');
  });

  it('rejects photo analysis copy that uses em dash style wording', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(
        openAiPayload({
          overall_assessment: 'Skin looks calmer — keep watching it.',
          user_visible_message: 'Skin looks calmer — keep watching it.',
        }),
      ),
    });
    global.fetch = fetchMock;
    const service = new SkinJournalAnalysisService(
      config({ OPENAI_API_KEY: 'sk-test' }),
      photoStorage,
    );

    await expect(
      service.analyze({
        userId: 'user-1',
        entryId: 'entry-1',
        photoObjectKey: 'skin-journal/user-1/entry-1/photo.webp',
        priorPhotoObjectKey: null,
        priorAnalysis: null,
        concernFocus: null,
        skinContext: {},
        entryContext: {
          entry_date: '2026-05-01',
        },
      }),
    ).rejects.toThrow('artificial wording');
  });

  it('passes previous and current photos when a previous photo is available', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(openAiPayload()),
    });
    global.fetch = fetchMock;
    const storage = {
      readPhotoBuffer: jest
        .fn()
        .mockResolvedValueOnce(validPhotoBuffer)
        .mockResolvedValueOnce(validPhotoBuffer),
    } as unknown as SkinJournalPhotoStorageService;
    const service = new SkinJournalAnalysisService(
      config({
        OPENAI_API_KEY: 'sk-test',
      }),
      storage,
    );

    await service.analyze({
      userId: 'user-1',
      entryId: 'entry-1',
      photoObjectKey: 'skin-journal/user-1/entry-1/photo.webp',
      priorPhotoObjectKey: 'skin-journal/user-1/entry-0/photo.webp',
      concernFocus: null,
      priorAnalysis: null,
      skinContext: null,
      entryContext: null,
    });

    const body = requestBody(fetchMock);
    const images = body.input
      .flatMap((item) => item.content)
      .filter((content) => content.type === 'input_image');

    expect(storage.readPhotoBuffer).toHaveBeenCalledWith(
      'skin-journal/user-1/entry-1/photo.webp',
    );
    expect(storage.readPhotoBuffer).toHaveBeenCalledWith(
      'skin-journal/user-1/entry-0/photo.webp',
    );
    expect(images).toHaveLength(2);
    expect(promptText(body, 'user')).toContain('Image A is today');
    expect(promptText(body, 'user')).toContain(
      'Image B is the prior reference',
    );
  });

  it('passes multiple current angles while keeping prior comparison front-only', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(
        openAiPayload({
          schema_version: '1.2',
          per_angle_quality: [
            {
              angle: 'head_on',
              face_detected: true,
              lighting_quality: 'good',
              framing_quality: 'good',
              blur_detected: false,
              issues: [],
              quality_score: 0.9,
              needs_retake: false,
              used_for_analysis: true,
            },
            {
              angle: 'left_profile',
              face_detected: true,
              lighting_quality: 'fair',
              framing_quality: 'good',
              blur_detected: false,
              issues: [],
              quality_score: 0.75,
              needs_retake: false,
              used_for_analysis: true,
            },
            {
              angle: 'right_profile',
              face_detected: true,
              lighting_quality: 'fair',
              framing_quality: 'good',
              blur_detected: false,
              issues: [],
              quality_score: 0.76,
              needs_retake: false,
              used_for_analysis: true,
            },
          ],
        }),
      ),
    });
    global.fetch = fetchMock;
    const storage = {
      readPhotoBuffer: jest
        .fn()
        .mockResolvedValueOnce(validPhotoBuffer)
        .mockResolvedValueOnce(validPhotoBuffer)
        .mockResolvedValueOnce(validPhotoBuffer)
        .mockResolvedValueOnce(validPhotoBuffer),
    } as unknown as SkinJournalPhotoStorageService;
    const service = new SkinJournalAnalysisService(
      config({ OPENAI_API_KEY: 'sk-test' }),
      storage,
    );

    const result = await service.analyze({
      userId: 'user-1',
      entryId: 'entry-1',
      photoObjectKey: 'skin-journal/user-1/entry-1/front.webp',
      photos: [
        {
          angle: 'head_on',
          object_key: 'skin-journal/user-1/entry-1/front.webp',
        },
        {
          angle: 'left_profile',
          object_key: 'skin-journal/user-1/entry-1/left.webp',
        },
        {
          angle: 'right_profile',
          object_key: 'skin-journal/user-1/entry-1/right.webp',
        },
      ],
      priorPhotoObjectKey: 'skin-journal/user-1/entry-0/front.webp',
      concernFocus: null,
      priorAnalysis: null,
      skinContext: null,
      entryContext: null,
    });

    const body = requestBody(fetchMock);
    const images = body.input
      .flatMap((item) => item.content)
      .filter((content) => content.type === 'input_image');
    const labels = body.input
      .flatMap((item) => item.content)
      .filter((content) => content.type === 'input_text')
      .map((content) => content.text ?? '')
      .join('\n');

    expect(storage.readPhotoBuffer).toHaveBeenCalledWith(
      'skin-journal/user-1/entry-1/front.webp',
    );
    expect(storage.readPhotoBuffer).toHaveBeenCalledWith(
      'skin-journal/user-1/entry-1/left.webp',
    );
    expect(storage.readPhotoBuffer).toHaveBeenCalledWith(
      'skin-journal/user-1/entry-1/right.webp',
    );
    expect(images).toHaveLength(4);
    expect(labels).toContain("today's front photo");
    expect(labels).toContain("today's left profile photo");
    expect(labels).toContain('front-to-front change direction');
    expect(result.metadata.input_image_count).toBe(4);
    expect(result.observations.per_angle_quality).toHaveLength(3);
  });

  it('uses the fixture angle when running private evaluation photos', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(
        openAiPayload({
          schema_version: '1.2',
          per_angle_quality: [
            {
              angle: 'left_profile',
              face_detected: true,
              lighting_quality: 'good',
              framing_quality: 'good',
              blur_detected: false,
              issues: [],
              quality_score: 0.86,
              needs_retake: false,
              used_for_analysis: true,
            },
          ],
        }),
      ),
    });
    global.fetch = fetchMock;
    const service = new SkinJournalAnalysisService(
      config({ OPENAI_API_KEY: 'sk-test' }),
      photoStorage,
    );

    const result = await service.analyzeEvaluationPhoto({
      fixtureId: 'side-localized-reaction',
      imageBuffer: validPhotoBuffer,
      angle: 'left_profile',
    });

    const body = requestBody(fetchMock);
    const labels = body.input
      .flatMap((item) => item.content)
      .filter((content) => content.type === 'input_text')
      .map((content) => content.text ?? '')
      .join('\n');

    expect(labels).toContain("today's left profile photo");
    expect(labels).toContain('Evaluation fixture angle: left_profile');
    expect(result.observations.per_angle_quality?.[0]?.angle).toBe(
      'left_profile',
    );
  });

  it('rejects multi-angle model output that omits supplied angle quality rows', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(
        openAiPayload({
          schema_version: '1.2',
          per_angle_quality: [
            {
              angle: 'head_on',
              face_detected: true,
              lighting_quality: 'good',
              framing_quality: 'good',
              blur_detected: false,
              issues: [],
              quality_score: 0.9,
              needs_retake: false,
              used_for_analysis: true,
            },
          ],
        }),
      ),
    });
    const storage = {
      readPhotoBuffer: jest
        .fn()
        .mockResolvedValueOnce(validPhotoBuffer)
        .mockResolvedValueOnce(validPhotoBuffer),
    } as unknown as SkinJournalPhotoStorageService;
    const service = new SkinJournalAnalysisService(
      config({ OPENAI_API_KEY: 'sk-test' }),
      storage,
    );

    await expect(
      service.analyze({
        userId: 'user-1',
        entryId: 'entry-1',
        photoObjectKey: 'skin-journal/user-1/entry-1/front.webp',
        photos: [
          {
            angle: 'head_on',
            object_key: 'skin-journal/user-1/entry-1/front.webp',
          },
          {
            angle: 'left_profile',
            object_key: 'skin-journal/user-1/entry-1/left.webp',
          },
        ],
        concernFocus: null,
        priorAnalysis: null,
        skinContext: null,
        entryContext: null,
      }),
    ).rejects.toThrow('per_angle_quality must include every supplied angle');
  });

  it('rejects duplicate per-angle quality rows from model output', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(
        openAiPayload({
          schema_version: '1.2',
          per_angle_quality: [
            {
              angle: 'head_on',
              face_detected: true,
              lighting_quality: 'good',
              framing_quality: 'good',
              blur_detected: false,
              issues: [],
              quality_score: 0.9,
              needs_retake: false,
              used_for_analysis: true,
            },
            {
              angle: 'head_on',
              face_detected: true,
              lighting_quality: 'good',
              framing_quality: 'good',
              blur_detected: false,
              issues: [],
              quality_score: 0.91,
              needs_retake: false,
              used_for_analysis: true,
            },
            {
              angle: 'left_profile',
              face_detected: true,
              lighting_quality: 'fair',
              framing_quality: 'good',
              blur_detected: false,
              issues: [],
              quality_score: 0.74,
              needs_retake: false,
              used_for_analysis: true,
            },
          ],
        }),
      ),
    });
    const storage = {
      readPhotoBuffer: jest
        .fn()
        .mockResolvedValueOnce(validPhotoBuffer)
        .mockResolvedValueOnce(validPhotoBuffer),
    } as unknown as SkinJournalPhotoStorageService;
    const service = new SkinJournalAnalysisService(
      config({ OPENAI_API_KEY: 'sk-test' }),
      storage,
    );

    await expect(
      service.analyze({
        userId: 'user-1',
        entryId: 'entry-1',
        photoObjectKey: 'skin-journal/user-1/entry-1/front.webp',
        photos: [
          {
            angle: 'head_on',
            object_key: 'skin-journal/user-1/entry-1/front.webp',
          },
          {
            angle: 'left_profile',
            object_key: 'skin-journal/user-1/entry-1/left.webp',
          },
        ],
        concernFocus: null,
        priorAnalysis: null,
        skinContext: null,
        entryContext: null,
      }),
    ).rejects.toThrow('per_angle_quality must include every supplied angle');
  });

  it('rejects forbidden diagnostic language from model output', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(
        openAiPayload({
          overall_assessment: 'This can diagnose acne.',
        }),
      ),
    });
    const service = new SkinJournalAnalysisService(
      config({
        OPENAI_API_KEY: 'sk-test',
      }),
      photoStorage,
    );

    await expect(
      service.analyze({
        userId: 'user-1',
        entryId: 'entry-1',
        photoObjectKey: 'skin-journal/user-1/entry-1/photo.webp',
        concernFocus: null,
        priorAnalysis: null,
        skinContext: null,
        entryContext: null,
      }),
    ).rejects.toThrow('forbidden medical language');
  });

  it('rejects invalid safety enum values from model output', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(
        openAiPayload({
          safety_flags: {
            urgent_review_recommended: false,
            doctor_follow_up_recommended: true,
            reasons: ['not_a_supported_reason'],
          },
        }),
      ),
    });
    const service = new SkinJournalAnalysisService(
      config({
        OPENAI_API_KEY: 'sk-test',
      }),
      photoStorage,
    );

    await expect(
      service.analyze({
        userId: 'user-1',
        entryId: 'entry-1',
        photoObjectKey: 'skin-journal/user-1/entry-1/photo.webp',
        concernFocus: null,
        priorAnalysis: null,
        skinContext: null,
        entryContext: null,
      }),
    ).rejects.toThrow('Unexpected enum value');
  });

  it('rejects obviously unusable current photos locally before sending them to OpenAI', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    photoStorage.readPhotoBuffer.mockResolvedValueOnce(
      await variedImageBuffer(96, 96),
    );
    const service = new SkinJournalAnalysisService(
      config({ OPENAI_API_KEY: 'sk-test' }),
      photoStorage,
    );

    await expect(
      service.analyze({
        userId: 'user-1',
        entryId: 'entry-1',
        photoObjectKey: 'skin-journal/user-1/entry-1/photo.webp',
        concernFocus: null,
        priorAnalysis: null,
        skinContext: null,
        entryContext: null,
      }),
    ).rejects.toMatchObject({
      code: AnalysisFailureCodeValue.PhotoPreflightRejected,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects obvious non-face current photos locally before sending them to OpenAI', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    photoStorage.readPhotoBuffer.mockResolvedValueOnce(
      await nonFaceImageBuffer(),
    );
    const service = new SkinJournalAnalysisService(
      config({ OPENAI_API_KEY: 'sk-test' }),
      photoStorage,
    );

    await expect(
      service.analyze({
        userId: 'user-1',
        entryId: 'entry-1',
        photoObjectKey: 'skin-journal/user-1/entry-1/photo.webp',
        concernFocus: null,
        priorAnalysis: null,
        skinContext: null,
        entryContext: null,
      }),
    ).rejects.toMatchObject({
      code: AnalysisFailureCodeValue.PhotoPreflightRejected,
      message: expect.stringContaining('no_local_face_detected'),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects photo payloads that exceed the post-processing byte budget before OpenAI', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    photoStorage.readPhotoBuffer.mockResolvedValueOnce(
      Buffer.concat([validPhotoBuffer, Buffer.alloc(1024)]),
    );
    const service = new SkinJournalAnalysisService(
      config({
        OPENAI_API_KEY: 'sk-test',
        SKIN_JOURNAL_ANALYSIS_MAX_IMAGE_BYTES: validPhotoBuffer.length,
      }),
      photoStorage,
    );

    await expect(
      service.analyze({
        userId: 'user-1',
        entryId: 'entry-1',
        photoObjectKey: 'skin-journal/user-1/entry-1/photo.webp',
        concernFocus: null,
        priorAnalysis: null,
        skinContext: null,
        entryContext: null,
      }),
    ).rejects.toMatchObject({
      code: AnalysisFailureCodeValue.PayloadTooLarge,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects multi-angle requests when the estimated request cost exceeds the configured cap', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    const service = new SkinJournalAnalysisService(
      config({
        OPENAI_API_KEY: 'sk-test',
        SKIN_JOURNAL_ANALYSIS_ASSUMED_INPUT_IMAGE_COST_USD: 0.02,
        SKIN_JOURNAL_ANALYSIS_MAX_REQUEST_COST_USD: 0.03,
      }),
      photoStorage,
    );

    await expect(
      service.analyze({
        userId: 'user-1',
        entryId: 'entry-1',
        photoObjectKey: 'skin-journal/user-1/entry-1/front.webp',
        photos: [
          {
            angle: 'head_on',
            object_key: 'skin-journal/user-1/entry-1/front.webp',
          },
          {
            angle: 'left_profile',
            object_key: 'skin-journal/user-1/entry-1/left.webp',
          },
        ],
        priorPhotoObjectKey: null,
        concernFocus: null,
        priorAnalysis: null,
        skinContext: null,
        entryContext: null,
      }),
    ).rejects.toMatchObject({
      code: AnalysisFailureCodeValue.CostLimitExceeded,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('wraps provider timeouts with a retryable failure code', async () => {
    const timeout = Object.assign(new Error('operation timed out'), {
      name: 'TimeoutError',
    });
    global.fetch = jest.fn().mockRejectedValue(timeout);
    const service = new SkinJournalAnalysisService(
      config({ OPENAI_API_KEY: 'sk-test' }),
      photoStorage,
    );

    await expect(
      service.analyze({
        userId: 'user-1',
        entryId: 'entry-1',
        photoObjectKey: 'skin-journal/user-1/entry-1/photo.webp',
        concernFocus: null,
        priorAnalysis: null,
        skinContext: null,
        entryContext: null,
      }),
    ).rejects.toMatchObject({
      code: AnalysisFailureCodeValue.ProviderTimeout,
      retryable: true,
    });
  });

  it('rejects semantically inconsistent reaction output from the model', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(
        openAiPayload({
          reaction_signals: {
            reaction_detected: false,
            reaction_severity: 'mild',
            indicators: [],
            confidence: 0.2,
          },
        }),
      ),
    });
    const service = new SkinJournalAnalysisService(
      config({ OPENAI_API_KEY: 'sk-test' }),
      photoStorage,
    );

    await expect(
      service.analyze({
        userId: 'user-1',
        entryId: 'entry-1',
        photoObjectKey: 'skin-journal/user-1/entry-1/photo.webp',
        concernFocus: null,
        priorAnalysis: null,
        skinContext: null,
        entryContext: null,
      }),
    ).rejects.toMatchObject({
      code: AnalysisFailureCodeValue.ProviderInvalidResponse,
    });
  });

  it('rejects safety flags that do not include an actionable reason', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(
        openAiPayload({
          safety_flags: {
            urgent_review_recommended: true,
            doctor_follow_up_recommended: true,
            reasons: [],
          },
          should_flag_for_doctor: true,
          doctor_flag_reason: null,
        }),
      ),
    });
    const service = new SkinJournalAnalysisService(
      config({ OPENAI_API_KEY: 'sk-test' }),
      photoStorage,
    );

    await expect(
      service.analyze({
        userId: 'user-1',
        entryId: 'entry-1',
        photoObjectKey: 'skin-journal/user-1/entry-1/photo.webp',
        concernFocus: null,
        priorAnalysis: null,
        skinContext: null,
        entryContext: null,
      }),
    ).rejects.toMatchObject({
      code: AnalysisFailureCodeValue.ProviderInvalidResponse,
    });
  });

  it('rejects per-angle quality rows that mark unusable photos as usable', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(
        openAiPayload({
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
          per_angle_quality: [
            {
              angle: 'head_on',
              face_detected: false,
              lighting_quality: 'good',
              framing_quality: 'good',
              blur_detected: false,
              issues: ['non_face_image'],
              quality_score: 0.2,
              needs_retake: false,
              used_for_analysis: true,
            },
          ],
        }),
      ),
    });
    const service = new SkinJournalAnalysisService(
      config({ OPENAI_API_KEY: 'sk-test' }),
      photoStorage,
    );

    await expect(
      service.analyze({
        userId: 'user-1',
        entryId: 'entry-1',
        photoObjectKey: 'skin-journal/user-1/entry-1/photo.webp',
        concernFocus: null,
        priorAnalysis: null,
        skinContext: null,
        entryContext: null,
      }),
    ).rejects.toMatchObject({
      code: AnalysisFailureCodeValue.ProviderInvalidResponse,
    });
  });
});

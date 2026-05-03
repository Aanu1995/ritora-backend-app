import { ConfigService } from '@nestjs/config';
import { SkinJournalAnalysisService } from './skin-journal-analysis.service';
import { SkinJournalPhotoStorageService } from './skin-journal-photo-storage.service';
import { SKIN_JOURNAL_ANALYSIS_PROMPT_VERSION } from '../skin-journal.constants';

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

type OpenAiRequestBody = {
  model: string;
  store: boolean;
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
  const photoStorage = {
    readPhotoBuffer: jest.fn().mockResolvedValue(Buffer.from('photo')),
  } as unknown as SkinJournalPhotoStorageService;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
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
        .mockResolvedValueOnce(Buffer.from('current-photo'))
        .mockResolvedValueOnce(Buffer.from('previous-photo')),
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
});

import { ConfigService } from '@nestjs/config';
import { SkinJournalAnalysisService } from './skin-journal-analysis.service';
import { SkinJournalPhotoStorageService } from './skin-journal-photo-storage.service';

function config(values: Record<string, string | number | boolean>) {
  return {
    get: jest.fn((key: string, fallback?: string | number | boolean) =>
      key in values ? values[key] : fallback,
    ),
  } as unknown as ConfigService;
}

function openAiPayload(overrides: Record<string, unknown> = {}) {
  return {
    output_text: JSON.stringify({
      schema_version: '1.0',
      model_version: 'gpt-4o-2024-08-06',
      image_quality: {
        face_detected: true,
        lighting_quality: 'good',
        framing_quality: 'good',
        blur_detected: false,
        issues: [],
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
      should_flag_for_doctor: false,
      doctor_flag_reason: null,
      ...overrides,
    }),
  };
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
        OPENAI_MODEL: 'gpt-4o-2024-08-06',
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

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      store: boolean;
      text: { format: { strict: boolean } };
    };
    expect(result.overall_assessment).toBe('Skin appears stable today.');
    expect(body.store).toBe(false);
    expect(body.text.format.strict).toBe(true);
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
      }),
    ).rejects.toThrow('forbidden medical language');
  });
});

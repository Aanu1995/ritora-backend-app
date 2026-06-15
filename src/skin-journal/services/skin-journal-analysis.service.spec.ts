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
      schema_version: '1.3',
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
      guidance_decisions: [],
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
  text: {
    format: {
      strict: boolean;
      schema?: {
        required?: string[];
        properties?: {
          guidance_decisions?: {
            maxItems?: number;
          };
        };
      };
    };
  };
};

function requestBody(fetchMock: jest.Mock, callIndex = 0): OpenAiRequestBody {
  return JSON.parse(
    fetchMock.mock.calls[callIndex][1].body as string,
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
    expect(body.text.format.schema?.required).toContain('guidance_decisions');
    expect(body.reasoning).toEqual({
      effort: OPENAI_SKIN_JOURNAL_ANALYSIS_REASONING_EFFORT,
    });
    expect(body.text.format.strict).toBe(true);
  });

  it('uses a licensed specialist-informed prompt with quality, equity, safety, guidance, and context rubrics', async () => {
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
        recent_change_product_id: 'retinoid-1',
        recent_change_note: 'Started retinol this week.',
        complaint_note: 'Burning feeling near cheeks',
        is_pre_routine: true,
      },
      routineContext: {
        active_recovery: {
          active: true,
          simplification_mode: 'barrier_repair',
          recovery_phase: 'stabilize',
          trigger_source: 'reaction_report',
          trigger_symptoms: ['burning', 'redness'],
          trigger_severity: 'moderate',
          active_overuse: true,
          review_after: '2026-05-03T08:00:00.000Z',
          exit_eligible_at: '2026-05-05T08:00:00.000Z',
          return_step: 'not_started',
          restore_strategy: 'phased',
        },
        routine_memory: {
          window: {
            start: '2026-04-01',
            end: '2026-04-30',
            days: 30,
          },
          summary: {
            timeline_event_count: 4,
            product_change_count: 1,
            application_log_count: 2,
            reaction_signal_count: 1,
            recovery_event_count: 0,
            suspicious_product_count: 1,
            has_possible_links: true,
          },
          suspicious_products: [
            {
              product_id: 'retinoid-1',
              brand: 'Routine Brand',
              name: 'Retinol Serum',
              category: 'serum',
              suspicion_level: 'possible',
              score: 5,
              reason_codes: ['reaction_after_first_logged_use'],
              first_use_date: '2026-04-18',
              last_use_date: '2026-04-29',
              nearest_reaction_date: '2026-04-30',
              days_from_first_use_to_reaction: 2,
              reaction_signal_count_near_use: 1,
            },
          ],
          recent_events: [
            {
              date: '2026-04-18',
              occurred_at: '2026-04-18T20:00:00.000Z',
              type: 'first_logged_use',
              severity: 'info',
              source_type: 'application_log',
              product_id: 'retinoid-1',
              brand: 'Routine Brand',
              name: 'Retinol Serum',
              category: 'serum',
            },
          ],
        },
        active_shelf_products: [
          {
            product_id: 'cleanser-1',
            brand: 'Shelf Brand',
            name: 'Gentle Cleanser',
            category: 'cleanser',
            step_label: null,
            preferred_time: 'evening',
            opened_at: '2026-04-20T18:00:00.000Z',
            expires_at: '2026-10-20T18:00:00.000Z',
            effective_expires_at: '2026-10-20T18:00:00.000Z',
            introduction_status: 'building_tolerance',
            introduction_started_at: '2026-04-20T18:00:00.000Z',
            introduction_status_updated_at: '2026-04-27T18:00:00.000Z',
            benefit_tags: ['gentle cleanse'],
            suited_for_tags: ['sensitive skin'],
            ingredient_preview: ['aqua', 'glycerin'],
            application_method: 'fingertips',
            quantity: 'coin-size',
            wait_minutes: null,
            guidance_steps: ['Massage briefly and rinse'],
            guidance_cautions: ['Avoid eye area'],
            user_product_note: 'Fine most days.',
          },
        ],
        routine_products: [
          {
            product_id: 'retinoid-1',
            brand: 'Routine Brand',
            name: 'Retinol Serum',
            category: 'serum',
            step_label: 'treatment',
            preferred_time: 'evening',
            opened_at: '2026-04-18T18:00:00.000Z',
            expires_at: '2026-10-18T18:00:00.000Z',
            effective_expires_at: '2026-10-18T18:00:00.000Z',
            introduction_status: 'week_1',
            introduction_started_at: '2026-04-18T18:00:00.000Z',
            introduction_status_updated_at: '2026-04-19T18:00:00.000Z',
            benefit_tags: ['texture support'],
            suited_for_tags: ['experienced users'],
            ingredient_preview: ['retinol', 'squalane'],
            application_method: 'dropper',
            quantity: 'pea-size',
            wait_minutes: 10,
            guidance_steps: ['Apply after moisturizer if sensitive'],
            guidance_cautions: ['Use only at night'],
            user_product_note: 'Can sting if layered too often.',
            is_specialist_locked: false,
          },
        ],
        recent_applications: [
          {
            target_date: '2026-04-29',
            target_time: '20:00:00',
            daypart: 'evening',
            applied_at: '2026-04-29T20:00:00.000Z',
            general_notes: 'Cheeks felt warm after routine.',
            has_been_edited: true,
            items: [
              {
                status: 'applied',
                product_id: 'retinoid-1',
                brand: 'Routine Brand',
                name: 'Retinol Serum',
                category: 'serum',
                step_label: 'treatment',
                applied_at: '2026-04-29T20:05:00.000Z',
                item_source: 'recommended',
                is_ad_hoc: false,
                recommended_product_id: 'retinoid-1',
                recommended_name: 'Retinol Serum',
                applied_product_id: 'retinoid-1',
                applied_name: 'Retinol Serum',
                notes: 'No immediate stinging tonight.',
                substitution_reason: null,
              },
            ],
          },
        ],
        recent_check_ins: [
          {
            entry_date: '2026-04-29',
            sleep_band: 'lt5h',
            stress_today: 'high',
            detected_concerns: ['acne'],
          },
        ],
      },
    });

    const body = requestBody(fetchMock);
    const systemPrompt = promptText(body, 'system');
    const userPrompt = promptText(body, 'user');

    expect(systemPrompt).toContain('licensed board-certified dermatologist');
    expect(systemPrompt).toContain('licensed skin-care specialist');
    expect(systemPrompt).toContain('Photo quality gate');
    expect(systemPrompt).toContain('Skin-tone equity');
    expect(systemPrompt).toContain('Severity and confidence rubric');
    expect(systemPrompt).toContain('Decision priority order');
    expect(systemPrompt).toContain(
      'Concrete context means visible photo evidence',
    );
    expect(systemPrompt).toContain(
      'User-reported lifestyle or nutrition changes in those fields are concrete context',
    );
    expect(systemPrompt).toContain(
      'Broader lifestyle or nutrition ideas are watch-only only when no concrete context explains the concern',
    );
    expect(systemPrompt).toContain(
      'A shelf product is not exposure unless it also appears in routine products, recent applications, recent_change_product_id, or routine_memory events',
    );
    expect(systemPrompt).toContain('Shelf and recovery context rules');
    expect(systemPrompt).toContain('Use product introduction_status');
    expect(systemPrompt).toContain(
      'Valid values are new, patch_testing, week_1, building_tolerance, tolerated, paused, failed, or missing',
    );
    expect(systemPrompt).toContain('tolerated or missing introduction_status');
    expect(systemPrompt).toContain('paused or failed introduction_status');
    expect(systemPrompt).toContain('Use opened_at, expires_at');
    expect(systemPrompt).toContain('Use preferred_time only as context');
    expect(systemPrompt).toContain('Use benefit_tags, suited_for_tags');
    expect(systemPrompt).toContain('Use user_product_note, recent_change_note');
    expect(systemPrompt).toContain('recommended_* fields describe');
    expect(systemPrompt).toContain(
      'routine_memory is a backend-derived chronology summary',
    );
    expect(systemPrompt).toContain('routine_memory.suspicious_products');
    expect(systemPrompt).toContain('routine_memory.recent_events');
    expect(systemPrompt).toContain(
      'Do not anchor on product explanations just because product data is detailed',
    );
    expect(systemPrompt).toContain(
      'food, late eating, sleep, stress, sweat, cycle, travel, illness',
    );
    expect(systemPrompt).toContain('If active_recovery is present');
    expect(systemPrompt).toContain(
      'When recovery_phase=stabilize or return_step=not_started/barrier_only',
    );
    expect(systemPrompt).toContain(
      'When recovery_phase=phased_return or return_step=one_active_test/building_frequency',
    );
    expect(systemPrompt).toContain('Guidance responsibility');
    expect(systemPrompt).toContain(
      'The AI must choose guidance_decisions for every detected concern',
    );
    expect(systemPrompt).toContain('possible_factor_codes');
    expect(systemPrompt).toContain('possible_cause_items');
    expect(systemPrompt).toContain('action_codes');
    expect(systemPrompt).toContain('try_next_items');
    expect(systemPrompt).toContain('avoid_codes');
    expect(systemPrompt).toContain('avoid_items');
    expect(systemPrompt).toContain(
      'The first bullet in each section must use the strongest concrete data',
    );
    expect(systemPrompt).toContain('Rank guidance evidence in this order');
    expect(systemPrompt).toContain(
      'the first Possible cause bullet must describe the visible pattern or image quality limit',
    );
    expect(systemPrompt).toContain(
      'Do not present products as the default explanation',
    );
    expect(systemPrompt).toContain(
      'If saying keep routine steady, specify what stays steady',
    );
    expect(systemPrompt).toContain(
      'Avoid for now bullets name temporary caution',
    );
    expect(systemPrompt).toContain(
      'Do not turn one photo into a permanent product, food, or habit ban',
    );
    expect(
      body.text.format.schema?.properties?.guidance_decisions?.maxItems,
    ).toBeGreaterThan(4);
    expect(systemPrompt).toContain('concrete context');
    expect(systemPrompt).toContain('late eating');
    expect(systemPrompt).toContain('food patterns');
    expect(systemPrompt).toContain(
      'consider product and non-product contributors side by side',
    );
    expect(systemPrompt).toContain(
      'If the user note mentions late eating, food, sleep, stress, sweat, or cycle context',
    );
    expect(systemPrompt).toContain('vitamin deficiency');
    expect(systemPrompt).toContain(
      'Do not claim vitamin deficiency causes large pores',
    );
    expect(systemPrompt).toContain(
      'overall nutrition or hydration patterns may be worth logging',
    );
    expect(systemPrompt).toContain(
      'use this order when relevant: same-light photos, shine tracking',
    );
    expect(systemPrompt).toContain('Do not diagnose');
    expect(systemPrompt).toContain('Write like a careful human specialist');
    expect(systemPrompt).toContain('Do not use hyphens or em dashes');
    expect(systemPrompt).toContain('overly polished style common in AI text');
    expect(userPrompt).toContain('redness, texture');
    expect(userPrompt).toContain('Decision input - current photo set');
    expect(userPrompt).toContain('Decision input - user concern focus');
    expect(userPrompt).toContain('Decision input - current entry check-in');
    expect(userPrompt).toContain(
      'Input authority rule: use supplied notes, check-ins, recovery state',
    );
    expect(userPrompt).toContain('product lifecycle fields');
    expect(userPrompt).toContain(
      'Possible cause, Try next, and Avoid for now must use concrete supplied data first.',
    );
    expect(userPrompt).toContain(
      'Concrete supplied data means visible photo evidence',
    );
    expect(userPrompt).toContain('User-reported food, late eating, sleep');
    expect(userPrompt).toContain(
      'Do not prefer product explanations by default',
    );
    expect(userPrompt).toContain(
      'Broader factors may appear only as cautious watch-or-log items when no concrete context explains the concern',
    );
    expect(userPrompt).toContain('Prior redness appeared mild around cheeks.');
    expect(userPrompt).toContain('medium_deep');
    expect(userPrompt).toContain('started_new_product');
    expect(userPrompt).toContain('Started retinol this week.');
    expect(userPrompt).toContain('Burning feeling near cheeks');
    expect(userPrompt).toContain('active_recovery');
    expect(userPrompt).toContain('routine_memory');
    expect(userPrompt).toContain('reaction_after_first_logged_use');
    expect(userPrompt).toContain('building_tolerance');
    expect(userPrompt).toContain('week_1');
    expect(userPrompt).toContain('effective_expires_at');
    expect(userPrompt).toContain('user_product_note');
    expect(userPrompt).toContain('Cheeks felt warm after routine.');
    expect(userPrompt).toContain('No immediate stinging tonight.');
    expect(userPrompt).toContain('active_shelf_products');
    expect(userPrompt).toContain('Retinol Serum');
    expect(userPrompt).toContain('lt5h');
    expect(userPrompt).not.toContain('user-1');
    expect(userPrompt).not.toContain('entry-1');
  });

  it('parses model-owned guidance decisions for concern guidance', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(
        openAiPayload({
          schema_version: '1.3',
          detected_concerns: [
            {
              concern: 'acne',
              severity: 'moderate',
              locations: ['chin'],
              confidence: 0.78,
              change_from_previous: 'new',
              change_confidence: 0.62,
            },
          ],
          guidance_decisions: [
            {
              concern: 'acne',
              possible_factor_codes: [
                'note_diet_acne',
                'acne_common_contributors',
              ],
              possible_cause_items: [
                'The chin breakout pattern may line up with the late sugary snack you logged.',
              ],
              action_codes: ['non_comedogenic', 'log_clusters'],
              try_next_items: [
                'Keep the routine steady and log whether similar foods line up with new spots.',
              ],
              avoid_codes: ['logged_diet_pattern', 'pore_clogging_products'],
              avoid_items: [
                'Avoid repeating that logged late sugary snack pattern if it keeps matching breakout days.',
              ],
              reasoning_summary:
                'Clustered chin bumps are visible and the supplied note mentions late sugary food.',
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

    const result = await service.analyze({
      userId: 'user-1',
      entryId: 'entry-1',
      photoObjectKey: 'skin-journal/user-1/entry-1/photo.webp',
      concernFocus: ['acne'],
      priorAnalysis: null,
      entryContext: {
        entry_date: '2026-05-01',
        complaint_note: 'Late sugary snack before bed.',
      },
    });

    expect(result.observations.guidance_decisions).toEqual([
      {
        concern: 'acne',
        possible_factor_codes: ['note_diet_acne', 'acne_common_contributors'],
        possible_cause_items: [
          'The chin breakout pattern may line up with the late sugary snack you logged.',
        ],
        action_codes: ['non_comedogenic', 'log_clusters'],
        try_next_items: [
          'Keep the routine steady and log whether similar foods line up with new spots.',
        ],
        avoid_codes: ['logged_diet_pattern', 'pore_clogging_products'],
        avoid_items: [
          'Avoid repeating that logged late sugary snack pattern if it keeps matching breakout days.',
        ],
        reasoning_summary:
          'Clustered chin bumps are visible and the supplied note mentions late sugary food.',
      },
    ]);
  });

  it('rejects analysis output when a detected concern is missing guidance decisions', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(
        openAiPayload({
          schema_version: '1.3',
          detected_concerns: [
            {
              concern: 'acne',
              severity: 'mild',
              locations: ['chin'],
              confidence: 0.62,
              change_from_previous: 'stable',
              change_confidence: 0.55,
            },
            {
              concern: 'large_pores',
              severity: 'mild',
              locations: ['nose'],
              confidence: 0.58,
              change_from_previous: 'stable',
              change_confidence: 0.52,
            },
          ],
          guidance_decisions: [
            {
              concern: 'acne',
              possible_factor_codes: ['acne_common_contributors'],
              possible_cause_items: [
                'Small bumps are visible around the chin.',
              ],
              action_codes: ['log_clusters'],
              try_next_items: ['Log whether the bumps cluster again.'],
              avoid_codes: ['picking_or_squeezing'],
              avoid_items: ['Avoid picking active spots.'],
              reasoning_summary: 'Acne guidance is present.',
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

    await expect(
      service.analyze({
        userId: 'user-1',
        entryId: 'entry-1',
        photoObjectKey: 'skin-journal/user-1/entry-1/photo.webp',
        concernFocus: ['acne', 'large_pores'],
        priorAnalysis: null,
      }),
    ).rejects.toMatchObject({
      code: AnalysisFailureCodeValue.ProviderInvalidResponse,
      retryable: true,
    });
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

  it('retries once when photo analysis copy fails backend wording validation', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(
          openAiPayload({
            overall_assessment: 'Skin looks calmer — keep watching it.',
            user_visible_message: 'Skin looks calmer — keep watching it.',
          }),
        ),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(openAiPayload()),
      });
    global.fetch = fetchMock;
    const service = new SkinJournalAnalysisService(
      config({ OPENAI_API_KEY: 'sk-test' }),
      photoStorage,
    );

    const result = await service.analyze({
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
    });

    expect(result.observations.overall_assessment).toBe(
      'Skin appears stable today.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(promptText(requestBody(fetchMock, 1), 'user')).toContain(
      'Validation retry',
    );
    expect(result.metadata.input_tokens).toBe(2000);
    expect(result.metadata.output_tokens).toBe(200);
    expect(result.metadata.total_tokens).toBe(2200);
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
      'Image B is the previous front photo',
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

  it('rejects hard cause claims that blame a product from model output', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(
        openAiPayload({
          detected_concerns: [
            {
              concern: 'acne',
              severity: 'mild',
              locations: ['chin'],
              confidence: 0.72,
              change_from_previous: 'unknown',
              change_confidence: 0.4,
            },
          ],
          guidance_decisions: [
            {
              concern: 'acne',
              possible_factor_codes: ['recent_product_change'],
              possible_cause_items: ['Retinol caused your acne breakout.'],
              action_codes: ['log_clusters'],
              try_next_items: [
                'Log whether new spots line up with routine or lifestyle changes.',
              ],
              avoid_codes: ['multiple_new_actives'],
              avoid_items: [
                'Avoid adding several new actives while comparing the pattern.',
              ],
              reasoning_summary: 'The model blamed the product too strongly.',
            },
          ],
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
        entryContext: {
          entry_date: '2026-05-01',
          complaint_note: 'Late meal before bed and a few new chin bumps.',
        },
      }),
    ).rejects.toThrow('possible_cause_items must include');
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

import { SkinJournalPhotoInterpretationService } from './skin-journal-photo-interpretation.service';
import {
  ANALYSIS_CONCERNS,
  type AnalysisObservations,
} from '../skin-journal.constants';

function observations(
  overrides: Partial<AnalysisObservations> = {},
): AnalysisObservations {
  return {
    schema_version: '1.1',
    model_version: 'test-model',
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
    barrier_signs: { barrier_compromise: false, indicators: [] },
    overall_assessment: 'RAW MODEL COPY SHOULD NOT BECOME THE SUMMARY',
    overall_change_from_previous: 'stable',
    user_visible_message: 'RAW MODEL USER MESSAGE',
    safety_flags: {
      urgent_review_recommended: false,
      doctor_follow_up_recommended: false,
      reasons: [],
    },
    should_flag_for_doctor: false,
    ...overrides,
  };
}

describe('SkinJournalPhotoInterpretationService', () => {
  const service = new SkinJournalPhotoInterpretationService();
  const generatedAt = new Date('2026-05-01T08:00:00.000Z');

  it('returns controlled retake guidance with a vetted photo source', () => {
    const result = service.interpret(
      observations({
        image_quality: {
          face_detected: false,
          lighting_quality: 'poor',
          framing_quality: 'fair',
          blur_detected: true,
          issues: ['too_dark'],
          quality_score: 0.22,
          needs_retake: true,
          excluded_from_trends_reason: 'no_face_detected',
        },
      }),
      generatedAt,
    );

    expect(result.code).toBe('retake_needed');
    expect(result.severity).toBe('warning');
    expect(result.summary_key).toBe(
      'journal.analysis.interpretation.retakeNeeded.summary',
    );
    expect(result.version).toBe('1.1');
    expect(result.reading_quality?.visual_label).toBe('needs_retake');
    expect(result.concern_guidance).toEqual([]);
    expect(result.sources.map((source) => source.id)).toEqual(
      expect.arrayContaining(['aad_skin_photo_quality']),
    );
    expect(JSON.stringify(result)).not.toContain('RAW MODEL');
  });

  it('maps swelling or hive-like signals to urgent review guidance', () => {
    const result = service.interpret(
      observations({
        reaction_signals: {
          reaction_detected: true,
          reaction_severity: 'severe',
          indicators: ['hives_appearance', 'swelling_appearance'],
          confidence: 0.83,
        },
        safety_flags: {
          urgent_review_recommended: true,
          doctor_follow_up_recommended: true,
          reasons: ['possible_swelling', 'hive_like_appearance'],
        },
        should_flag_for_doctor: true,
      }),
      generatedAt,
    );

    expect(result.code).toBe('urgent_review');
    expect(result.severity).toBe('critical');
    expect(result.sources.map((source) => source.id)).toEqual(
      expect.arrayContaining(['aad_hives_emergency']),
    );
    expect(result.guidance_keys).toContain(
      'journal.analysis.interpretation.urgentReview.guidance',
    );
  });

  it('grounds barrier and irritation signals in barrier support guidance', () => {
    const result = service.interpret(
      observations({
        reaction_signals: {
          reaction_detected: true,
          reaction_severity: 'moderate',
          indicators: ['peeling'],
          confidence: 0.72,
        },
        barrier_signs: {
          barrier_compromise: true,
          indicators: ['flaking', 'diffuse_inflammation'],
        },
      }),
      generatedAt,
    );

    expect(result.code).toBe('barrier_support');
    expect(result.severity).toBe('warning');
    expect(result.sources.map((source) => source.id)).toEqual(
      expect.arrayContaining(['aad_dry_skin_relief']),
    );
  });

  it('grounds acne progress interpretation without claiming causation', () => {
    const result = service.interpret(
      observations({
        detected_concerns: [
          {
            concern: 'acne',
            severity: 'mild',
            locations: ['chin'],
            confidence: 0.76,
            change_from_previous: 'improved',
            change_confidence: 0.7,
          },
        ],
        overall_change_from_previous: 'improved',
      }),
      generatedAt,
    );

    expect(result.code).toBe('acne_progress_timing');
    expect(result.summary_key).toBe(
      'journal.analysis.interpretation.acneProgressTiming.summary',
    );
    expect(result.sources.map((source) => source.id)).toEqual(
      expect.arrayContaining([
        'aad_acne_treatment_timing',
        'mayo_acne_treatment_timing',
        'aad_acne_skin_care_tips',
      ]),
    );
    expect(result.summary_key).not.toMatch(/cause|treat|cure/i);
  });

  it('grounds dark mark and hyperpigmentation tracking in AAD sources', () => {
    const result = service.interpret(
      observations({
        detected_concerns: [
          {
            concern: 'hyperpigmentation',
            severity: 'moderate',
            locations: ['left_cheek'],
            confidence: 0.78,
            change_from_previous: 'stable',
            change_confidence: 0.64,
          },
        ],
      }),
      generatedAt,
      {
        skinContext: {
          skin_tone: 'medium_deep',
          fitzpatrick_phototype: 'V',
        },
      },
    );

    expect(result.code).toBe('hyperpigmentation_tracking');
    expect(result.sources.map((source) => source.id)).toEqual(
      expect.arrayContaining([
        'aad_dark_spots_skin_tones',
        'aad_skin_of_color',
      ]),
    );
  });

  it('uses retinoid context only when a recent change note names one', () => {
    const result = service.interpret(
      observations({
        reaction_signals: {
          reaction_detected: true,
          reaction_severity: 'moderate',
          indicators: ['peeling'],
          confidence: 0.72,
        },
        barrier_signs: {
          barrier_compromise: true,
          indicators: ['flaking'],
        },
      }),
      generatedAt,
      {
        recentChange: {
          kind: 'started_new_product',
          note: 'Started retinol serum this week',
        },
      },
    );

    expect(result.code).toBe('retinoid_irritation_context');
    expect(result.sources.map((source) => source.id)).toEqual(
      expect.arrayContaining([
        'aad_retinoid_retinol_guidance',
        'aad_dry_skin_relief',
      ]),
    );
  });

  it('adds contact dermatitis symptom and patch testing sources for rash-like follow up', () => {
    const result = service.interpret(
      observations({
        detected_concerns: [
          {
            concern: 'eczema_indicator',
            severity: 'moderate',
            locations: ['chin'],
            confidence: 0.73,
          },
        ],
        safety_flags: {
          urgent_review_recommended: false,
          doctor_follow_up_recommended: true,
          reasons: ['cracking_or_open_skin_appearance'],
        },
        should_flag_for_doctor: true,
      }),
      generatedAt,
    );

    expect(result.code).toBe('professional_review');
    expect(result.sources.map((source) => source.id)).toEqual(
      expect.arrayContaining([
        'aad_contact_dermatitis_symptoms',
        'aad_contact_dermatitis_patch_testing',
      ]),
    );
  });

  it('adds acne action guidance from routine changes and check-ins', () => {
    const result = service.interpret(
      observations({
        detected_concerns: [
          {
            concern: 'acne',
            severity: 'moderate',
            locations: ['chin', 'left_cheek'],
            confidence: 0.74,
            change_from_previous: 'new',
            change_confidence: 0.66,
          },
        ],
        overall_change_from_previous: 'new',
      }),
      generatedAt,
      {
        recentChange: {
          kind: 'started_new_product',
          related_inventory_product_id: 'retinoid-1',
          note: 'Started retinol',
        },
        routineContext: {
          active_shelf_products: [
            {
              product_id: 'retinoid-1',
              brand: 'Test',
              name: 'Retinol Serum',
              category: 'serum',
              step_label: 'treatment',
            },
          ],
          routine_products: [
            {
              product_id: 'retinoid-1',
              brand: 'Test',
              name: 'Retinol Serum',
              category: 'serum',
              step_label: 'treatment',
            },
          ],
          recent_applications: [],
          recent_check_ins: [
            {
              entry_date: '2026-05-01',
              ratings: { breakouts: 5, oiliness: 4 },
              overall_feel: 'bad',
              sleep_band: 'lt5h',
              stress_today: 'high',
              sun_exposure_today: 'none',
              sweat_exercise_today: true,
              cycle_marker: 'dont_track',
              recent_change_kind: 'started_new_product',
              complaint_note: 'breakouts',
              is_pre_routine: true,
            },
          ],
        },
      },
    );

    const acne = result.concern_guidance?.find(
      (item) => item.concern === 'acne',
    );
    expect(acne).toBeDefined();
    expect(acne?.source_ids).toEqual(
      expect.arrayContaining([
        'aad_acne_causes',
        'aad_acne_treatment_timing',
        'aad_acne_skin_care_tips',
        'aad_retinoid_retinol_guidance',
      ]),
    );
    expect(acne?.possible_factor_keys.map((item) => item.key)).toEqual(
      expect.arrayContaining([
        'journal.analysis.guidance.factors.checkInOiliness',
        'journal.analysis.guidance.factors.recentProductChangeNamed',
        'journal.analysis.guidance.factors.routineProductTiming',
        'journal.analysis.guidance.factors.activeIngredientTiming',
      ]),
    );
  });

  it('maps large pores and oiliness to oily skin guidance', () => {
    const result = service.interpret(
      observations({
        detected_concerns: [
          {
            concern: 'large_pores',
            severity: 'mild',
            locations: ['left_cheek', 'right_cheek'],
            confidence: 0.7,
          },
        ],
      }),
      generatedAt,
      {
        routineContext: {
          active_shelf_products: [],
          routine_products: [],
          recent_applications: [],
          recent_check_ins: [
            {
              entry_date: '2026-05-01',
              ratings: { oiliness: 5 },
              overall_feel: 'ok',
              sleep_band: '5to7h',
              stress_today: 'low',
              sun_exposure_today: 'none',
              sweat_exercise_today: true,
              cycle_marker: 'dont_track',
              recent_change_kind: null,
              complaint_note: null,
              is_pre_routine: true,
            },
          ],
        },
      },
    );

    const pores = result.concern_guidance?.[0];
    expect(pores?.concern).toBe('large_pores');
    expect(pores?.source_ids).toEqual(
      expect.arrayContaining(['aad_oily_skin', 'aad_acne_skin_care_tips']),
    );
    expect(pores?.possible_factor_keys.map((item) => item.key)).toContain(
      'journal.analysis.guidance.factors.checkInOiliness',
    );
  });

  it('keeps real-photo-style multi-concern guidance distinct and source-specific', () => {
    const result = service.interpret(
      observations({
        detected_concerns: [
          {
            concern: 'acne',
            severity: 'moderate',
            locations: ['left_cheek', 'right_cheek', 'chin'],
            confidence: 0.81,
          },
          {
            concern: 'hyperpigmentation',
            severity: 'mild',
            locations: ['forehead', 'left_cheek'],
            confidence: 0.74,
          },
          {
            concern: 'large_pores',
            severity: 'mild',
            locations: ['left_cheek', 'right_cheek'],
            confidence: 0.69,
          },
        ],
        per_angle_quality: [
          {
            angle: 'left_profile',
            face_detected: true,
            lighting_quality: 'good',
            framing_quality: 'good',
            blur_detected: false,
            issues: [],
            quality_score: 0.88,
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
            angle: 'right_profile',
            face_detected: true,
            lighting_quality: 'good',
            framing_quality: 'good',
            blur_detected: false,
            issues: [],
            quality_score: 0.87,
            needs_retake: false,
            used_for_analysis: true,
          },
        ],
      }),
      generatedAt,
      {
        recentChange: {
          kind: 'started_new_product',
          related_inventory_product_id: 'spf-1',
          note: 'Changed SPF',
        },
        skinContext: {
          skin_tone: 'deep',
          fitzpatrick_phototype: 'VI',
        },
        routineContext: {
          active_shelf_products: [
            {
              product_id: 'spf-1',
              brand: 'Test',
              name: 'SPF 50 Sunscreen',
              category: 'sunscreen',
              step_label: 'morning SPF',
            },
          ],
          routine_products: [
            {
              product_id: 'spf-1',
              brand: 'Test',
              name: 'SPF 50 Sunscreen',
              category: 'sunscreen',
              step_label: 'morning SPF',
            },
          ],
          recent_applications: [
            {
              target_date: '2026-05-01',
              daypart: 'morning',
              applied_at: null,
              items: [
                {
                  status: 'skipped',
                  product_id: 'spf-1',
                  brand: 'Test',
                  name: 'SPF 50 Sunscreen',
                  category: 'sunscreen',
                  step_label: 'morning SPF',
                },
              ],
            },
          ],
          recent_check_ins: [
            {
              entry_date: '2026-05-01',
              ratings: { breakouts: 5, oiliness: 5 },
              overall_feel: 'bad',
              sleep_band: '5to7h',
              stress_today: 'low',
              sun_exposure_today: 'brief',
              sweat_exercise_today: true,
              cycle_marker: 'dont_track',
              recent_change_kind: null,
              complaint_note: 'breakouts around my jawline',
              is_pre_routine: true,
            },
          ],
        },
      },
    );

    const cards = result.concern_guidance ?? [];
    expect(cards.map((card) => card.title_key)).toEqual([
      'journal.analysis.guidance.acne.title',
      'journal.analysis.guidance.hyperpigmentation.title',
      'journal.analysis.guidance.poresOil.title',
    ]);
    expect(cards.find((card) => card.concern === 'acne')?.source_ids).toEqual(
      expect.arrayContaining(['aad_acne_causes', 'aad_acne_skin_care_tips']),
    );
    expect(
      cards.find((card) => card.concern === 'hyperpigmentation')?.source_ids,
    ).toEqual(
      expect.arrayContaining([
        'aad_dark_spots_skin_tones',
        'aad_skin_of_color',
      ]),
    );
    expect(
      cards.find((card) => card.concern === 'large_pores')?.source_ids,
    ).toEqual(expect.arrayContaining(['aad_oily_skin']));

    const acneFactors =
      cards
        .find((card) => card.concern === 'acne')
        ?.possible_factor_keys.map((item) => item.key) ?? [];
    const pigmentFactors =
      cards
        .find((card) => card.concern === 'hyperpigmentation')
        ?.possible_factor_keys.map((item) => item.key) ?? [];
    const poresFactors =
      cards
        .find((card) => card.concern === 'large_pores')
        ?.possible_factor_keys.map((item) => item.key) ?? [];

    expect(acneFactors).toEqual(
      expect.arrayContaining([
        'journal.analysis.guidance.factors.checkInOiliness',
        'journal.analysis.guidance.factors.checkInSweat',
        'journal.analysis.guidance.factors.acneCommonContributors',
      ]),
    );
    expect(acneFactors).not.toContain(
      'journal.analysis.guidance.factors.recentApplicationChange',
    );
    expect(acneFactors).not.toContain(
      'journal.analysis.guidance.factors.recentProductChangeNamed',
    );
    expect(acneFactors).not.toContain(
      'journal.analysis.guidance.factors.checkInFeel',
    );
    expect(pigmentFactors).toEqual(
      expect.arrayContaining([
        'journal.analysis.guidance.factors.checkInSun',
        'journal.analysis.guidance.factors.sunscreenContext',
        'journal.analysis.guidance.factors.recentApplicationChange',
        'journal.analysis.guidance.factors.recentProductChangeNamed',
      ]),
    );
    expect(pigmentFactors).not.toContain(
      'journal.analysis.guidance.factors.checkInNote',
    );
    expect(pigmentFactors).not.toContain(
      'journal.analysis.guidance.factors.checkInFeel',
    );
    expect(poresFactors).toContain(
      'journal.analysis.guidance.factors.checkInOiliness',
    );
    expect(poresFactors).not.toContain(
      'journal.analysis.guidance.factors.recentApplicationChange',
    );
    expect(poresFactors).not.toContain(
      'journal.analysis.guidance.factors.recentProductChangeNamed',
    );
    expect(poresFactors).not.toContain(
      'journal.analysis.guidance.factors.checkInFeel',
    );
  });

  it('keeps separate cards for each detected concern', () => {
    const result = service.interpret(
      observations({
        detected_concerns: [
          {
            concern: 'hyperpigmentation',
            severity: 'mild',
            locations: ['left_cheek'],
            confidence: 0.72,
          },
          {
            concern: 'uneven_tone',
            severity: 'moderate',
            locations: ['forehead'],
            confidence: 0.7,
          },
          {
            concern: 'large_pores',
            severity: 'mild',
            locations: ['left_cheek'],
            confidence: 0.69,
          },
          {
            concern: 'oiliness',
            severity: 'mild',
            locations: ['forehead'],
            confidence: 0.68,
          },
        ],
      }),
      generatedAt,
    );

    const cards = result.concern_guidance ?? [];
    expect(cards).toHaveLength(4);
    expect(cards.map((card) => card.concern)).toEqual([
      'uneven_tone',
      'hyperpigmentation',
      'large_pores',
      'oiliness',
    ]);
    expect(
      cards.find((card) => card.concern === 'hyperpigmentation'),
    ).toMatchObject({
      locations: ['left_cheek'],
    });
    expect(cards.find((card) => card.concern === 'uneven_tone')).toMatchObject({
      locations: ['forehead'],
    });
    expect(cards.find((card) => card.concern === 'large_pores')).toMatchObject({
      locations: ['left_cheek'],
    });
    expect(cards.find((card) => card.concern === 'oiliness')).toMatchObject({
      locations: ['forehead'],
    });
  });

  it('uses cause-oriented entries instead of tracking notes for possible causes', () => {
    const result = service.interpret(
      observations({
        detected_concerns: [
          {
            concern: 'acne',
            severity: 'mild',
            locations: ['chin'],
            confidence: 0.72,
          },
        ],
      }),
      generatedAt,
      {
        routineContext: {
          active_shelf_products: [],
          routine_products: [],
          recent_applications: [],
          recent_check_ins: [
            {
              entry_date: '2026-05-01',
              ratings: { breakouts: 4 },
              overall_feel: 'ok',
              sleep_band: '5to7h',
              stress_today: 'low',
              sun_exposure_today: 'none',
              sweat_exercise_today: false,
              cycle_marker: 'dont_track',
              recent_change_kind: null,
              complaint_note:
                'Had milk and a late sugary snack before bed yesterday.',
              is_pre_routine: true,
            },
          ],
        },
      },
    );

    const acneCauses =
      result.concern_guidance?.[0]?.possible_factor_keys.map(
        (item) => item.key,
      ) ?? [];

    expect(acneCauses).toEqual(
      expect.arrayContaining([
        'journal.analysis.guidance.factors.noteDietAcne',
        'journal.analysis.guidance.factors.acneCommonContributors',
      ]),
    );
    expect(acneCauses).not.toEqual(
      expect.arrayContaining([
        'journal.analysis.guidance.factors.breakoutTiming',
        'journal.analysis.guidance.factors.photoQualityContext',
        'journal.analysis.guidance.factors.visualTracking',
      ]),
    );
  });

  it('uses AI guidance decisions for possible causes, actions, and avoid items', () => {
    const result = service.interpret(
      observations({
        detected_concerns: [
          {
            concern: 'acne',
            severity: 'moderate',
            locations: ['chin'],
            confidence: 0.78,
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
              'Visible chin breakout pattern lines up with the supplied diet note.',
          },
        ],
      }),
      generatedAt,
      {
        routineContext: {
          active_shelf_products: [],
          routine_products: [],
          recent_applications: [],
          recent_check_ins: [
            {
              entry_date: '2026-05-01',
              ratings: { breakouts: 4 },
              overall_feel: 'ok',
              sleep_band: '5to7h',
              stress_today: 'low',
              sun_exposure_today: 'none',
              sweat_exercise_today: false,
              cycle_marker: 'dont_track',
              recent_change_kind: null,
              complaint_note:
                'Had milk and a late sugary snack before bed yesterday.',
              is_pre_routine: true,
            },
          ],
        },
      },
    );

    const acne = result.concern_guidance?.[0];
    expect(acne?.possible_factor_keys.map((item) => item.key)).toEqual([
      'journal.analysis.guidance.factors.noteDietAcne',
      'journal.analysis.guidance.factors.acneCommonContributors',
    ]);
    expect(acne?.action_keys.map((item) => item.key)).toEqual([
      'journal.analysis.guidance.actions.nonComedogenic',
      'journal.analysis.guidance.actions.logClusters',
    ]);
    expect(acne?.avoid_keys.map((item) => item.key)).toEqual([
      'journal.analysis.guidance.avoid.dietPatternIfLogged',
      'journal.analysis.guidance.avoid.poreCloggingProducts',
    ]);
    expect(acne?.possible_cause_items).toEqual([
      'The chin breakout pattern may line up with the late sugary snack you logged.',
    ]);
    expect(acne?.try_next_items).toEqual([
      'Keep the routine steady and log whether similar foods line up with new spots.',
    ]);
    expect(acne?.avoid_items).toEqual([
      'Avoid repeating that logged late sugary snack pattern if it keeps matching breakout days.',
    ]);
    expect(acne?.avoid_keys.map((item) => item.key)).not.toContain(
      'journal.analysis.guidance.avoid.multipleNewActives',
    );
  });

  it('drops unsafe AI generated guidance text while preserving safe bullets', () => {
    const result = service.interpret(
      observations({
        detected_concerns: [
          {
            concern: 'acne',
            severity: 'mild',
            locations: ['chin'],
            confidence: 0.72,
          },
        ],
        guidance_decisions: [
          {
            concern: 'acne',
            possible_factor_codes: ['acne_common_contributors'],
            possible_cause_items: [
              'Pore clogging, sweat, stress, or a recent product change could be contributors to compare.',
              'This diagnoses acne and proves milk caused it.',
            ],
            action_codes: ['log_clusters'],
            try_next_items: [
              'Log whether new spots cluster after sweat, food notes, or product changes.',
            ],
            avoid_codes: ['pore_clogging_products'],
            avoid_items: [
              'Avoid heavy products on the areas that are breaking out.',
              'Stop all products immediately.',
            ],
            reasoning_summary: 'One safe line and one unsafe line per section.',
          },
        ],
      }),
      generatedAt,
    );

    const acne = result.concern_guidance?.[0];
    expect(acne?.possible_cause_items).toEqual([
      'Pore clogging, sweat, stress, or a recent product change could be contributors to compare.',
    ]);
    expect(acne?.try_next_items).toEqual([
      'Log whether new spots cluster after sweat, food notes, or product changes.',
    ]);
    expect(acne?.avoid_items).toEqual([
      'Avoid heavy products on the areas that are breaking out.',
    ]);
  });

  it('filters AI avoid choices that do not fit the concern or supplied context', () => {
    const result = service.interpret(
      observations({
        detected_concerns: [
          {
            concern: 'acne',
            severity: 'mild',
            locations: ['chin'],
            confidence: 0.72,
          },
        ],
        guidance_decisions: [
          {
            concern: 'acne',
            possible_factor_codes: ['acne_common_contributors'],
            possible_cause_items: [
              'Pore clogging products could be a contributor to compare with future entries.',
            ],
            action_codes: ['spf_context', 'non_comedogenic'],
            try_next_items: [
              'Choose noncomedogenic textures when replacing products.',
            ],
            avoid_codes: [
              'inconsistent_spf',
              'logged_diet_pattern',
              'pore_clogging_products',
            ],
            avoid_items: [
              'Avoid heavy products on areas that are breaking out.',
            ],
            reasoning_summary:
              'The model selected one valid acne avoid item and two unsupported ones.',
          },
        ],
      }),
      generatedAt,
    );

    const acne = result.concern_guidance?.[0];
    expect(acne?.action_keys.map((item) => item.key)).toEqual([
      'journal.analysis.guidance.actions.nonComedogenic',
    ]);
    expect(acne?.avoid_keys.map((item) => item.key)).toEqual([
      'journal.analysis.guidance.avoid.poreCloggingProducts',
    ]);
    expect(acne?.avoid_keys.map((item) => item.key)).not.toContain(
      'journal.analysis.guidance.avoid.dietPatternIfLogged',
    );
    expect(acne?.avoid_keys.map((item) => item.key)).not.toContain(
      'journal.analysis.guidance.avoid.inconsistentSpf',
    );
  });

  it.each(ANALYSIS_CONCERNS)(
    'builds a concern guidance card for %s',
    (concern) => {
      const result = service.interpret(
        observations({
          detected_concerns: [
            {
              concern,
              severity: 'mild',
              locations: ['forehead'],
              confidence: 0.72,
            },
          ],
        }),
        generatedAt,
      );

      expect(result.concern_guidance).toHaveLength(1);
      expect(result.concern_guidance?.[0]).toMatchObject({
        concern,
        locations: ['forehead'],
      });
    },
  );

  it('treats poor real-photo quality as a retake read instead of over-advising concerns', () => {
    const result = service.interpret(
      observations({
        image_quality: {
          face_detected: true,
          lighting_quality: 'poor',
          framing_quality: 'fair',
          blur_detected: true,
          issues: ['too_dark', 'motion_blur'],
          quality_score: 0.31,
          needs_retake: true,
          excluded_from_trends_reason: 'poor_lighting',
        },
        detected_concerns: [
          {
            concern: 'texture',
            severity: 'moderate',
            locations: ['forehead'],
            confidence: 0.68,
          },
        ],
      }),
      generatedAt,
    );

    expect(result.reading_quality?.visual_label).toBe('needs_retake');
    expect(result.concern_guidance).toEqual([]);
    expect(result.source_ids).toContain('aad_skin_photo_quality');
  });
});

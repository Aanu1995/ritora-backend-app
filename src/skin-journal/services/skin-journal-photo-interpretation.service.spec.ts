import { SkinJournalPhotoInterpretationService } from './skin-journal-photo-interpretation.service';
import type { AnalysisObservations } from '../skin-journal.constants';

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
    expect(result.sources.map((source) => source.id)).toEqual([
      'aad_skin_photo_quality',
    ]);
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
    expect(result.sources.map((source) => source.id)).toEqual([
      'aad_hives_emergency',
    ]);
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
    expect(result.sources.map((source) => source.id)).toEqual([
      'aad_dry_skin_relief',
    ]);
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
    expect(result.sources.map((source) => source.id)).toEqual([
      'aad_acne_treatment_timing',
      'mayo_acne_treatment_timing',
    ]);
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
    expect(result.sources.map((source) => source.id)).toEqual([
      'aad_dark_spots_skin_tones',
      'aad_skin_of_color',
    ]);
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
    expect(result.sources.map((source) => source.id)).toEqual([
      'aad_retinoid_retinol_guidance',
      'aad_dry_skin_relief',
    ]);
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
    expect(result.sources.map((source) => source.id)).toEqual([
      'aad_contact_dermatitis_symptoms',
      'aad_contact_dermatitis_patch_testing',
    ]);
  });
});

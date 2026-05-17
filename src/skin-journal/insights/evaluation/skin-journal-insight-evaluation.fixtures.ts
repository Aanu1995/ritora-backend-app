import {
  ApplicationItemSource,
  ApplicationItemStatus,
} from '../../../application-tracking/application-tracking.constants';
import type { SkinJournalEntry } from '../../entities/skin-journal-entry.entity';
import type { RoutineApplicationEvidence } from '../../skin-journal-insight-detectors';
import type {
  AnalysisConcern,
  AnalysisObservations,
  InsightKind,
} from '../../skin-journal.constants';

export const REQUIRED_SKIN_JOURNAL_INSIGHT_EVALUATION_CASES = [
  'acne-trend-worsening',
  'irritation-recovery',
  'hyperpigmentation-progress',
  'sunscreen-adherence-gap',
  'bha-frequency-change',
  'stress-flare-correlation',
  'cycle-pattern',
  'poor-photo-quality',
] as const;

export const SKIN_JOURNAL_INSIGHT_EVALUATION_MIN_PASS_RATE = 0.95;

export type SkinJournalInsightEvaluationCaseId =
  (typeof REQUIRED_SKIN_JOURNAL_INSIGHT_EVALUATION_CASES)[number];

export interface SkinJournalInsightEvaluationFixture {
  id: SkinJournalInsightEvaluationCaseId;
  description: string;
  entries: SkinJournalEntry[];
  routineApplications?: RoutineApplicationEvidence[];
  expectedKinds: InsightKind[];
  forbiddenKinds?: InsightKind[];
}

const GENERATED_AT = new Date('2026-05-17T09:00:00.000Z');
type RatingValue = 1 | 2 | 3 | 4 | 5;

export const SKIN_JOURNAL_INSIGHT_EVALUATION_FIXTURES: readonly SkinJournalInsightEvaluationFixture[] =
  [
    {
      id: 'acne-trend-worsening',
      description: 'Breakout ratings rise across the comparison window.',
      entries: ratingWindow('acne', 'breakouts', [2, 2, 2, 2, 5, 5, 5, 5]),
      expectedKinds: ['trend'],
    },
    {
      id: 'irritation-recovery',
      description:
        'A moderate irritation marker is followed by a latest non-reaction entry.',
      entries: Array.from({ length: 6 }, (_, index) => {
        const day = index + 1;
        return entry(`recovery-${day}`, `2026-04-${pad(day)}`, {
          analysis_observations:
            day === 3
              ? observations({
                  reaction_signals: {
                    reaction_detected: true,
                    reaction_severity: 'moderate',
                    indicators: ['redness'],
                    confidence: 0.72,
                  },
                })
              : observations(),
        });
      }),
      expectedKinds: ['reaction_recovery'],
      forbiddenKinds: ['referral'],
    },
    {
      id: 'hyperpigmentation-progress',
      description: 'Pigmentation ratings improve after several entries.',
      entries: analysisConcernWindow('pigment', 'hyperpigmentation', [
        'severe',
        'severe',
        'moderate',
        'moderate',
        'mild',
        'mild',
        null,
        null,
      ]),
      expectedKinds: ['trend'],
    },
    {
      id: 'sunscreen-adherence-gap',
      description:
        'Recommended sun protection steps are repeatedly skipped in routine logs.',
      entries: ratingWindow('spf', 'redness', [2, 2, 2, 2, 2, 2, 2, 2, 2, 2]),
      routineApplications: routineApplications('spf', 'sun-protection', [
        'skipped',
        'skipped',
        'skipped',
        'skipped',
        'applied',
        'applied',
        'applied',
        'applied',
        'applied',
        'applied',
      ]),
      expectedKinds: ['routine_adherence'],
    },
    {
      id: 'bha-frequency-change',
      description:
        'A product frequency change is only interpreted with actual application logs.',
      entries: ratingWindow(
        'bha',
        'redness',
        [5, 5, 5, 5, 5, 2, 2, 2, 2, 2],
      ).map((item) =>
        item.entry_date === '2026-04-06'
          ? entry(item.id, item.entry_date, {
              ...item,
              recent_change: {
                kind: 'changed_frequency',
                related_inventory_product_id: 'bha-1',
              },
            })
          : item,
      ),
      routineApplications: [
        productApplication('2026-04-06', 'bha-1'),
        productApplication('2026-04-08', 'bha-1'),
      ],
      expectedKinds: ['effectiveness'],
    },
    {
      id: 'stress-flare-correlation',
      description: 'High-stress days align with higher redness ratings.',
      entries: Array.from({ length: 14 }, (_, index) => {
        const day = index + 1;
        const highStress = [2, 5, 9, 13].includes(day);
        return entry(`stress-${day}`, `2026-04-${pad(day)}`, {
          ratings: { redness: highStress ? 5 : 2, breakouts: 2 },
          stress_today: highStress ? 'high' : 'low',
        });
      }),
      expectedKinds: ['correlation'],
    },
    {
      id: 'cycle-pattern',
      description: 'Late-cycle entries have higher breakout ratings.',
      entries: Array.from({ length: 14 }, (_, index) => {
        const day = index + 1;
        const marker =
          day <= 4 ? 'day_1_3' : day <= 8 ? 'day_4_7' : 'late_cycle';
        return entry(`cycle-${day}`, `2026-04-${pad(day)}`, {
          ratings: {
            breakouts: marker === 'late_cycle' ? 5 : 2,
            redness: 2,
          },
          cycle_marker: marker,
        });
      }),
      expectedKinds: ['cycle'],
    },
    {
      id: 'poor-photo-quality',
      description:
        'Repeated low-quality photo observations produce a retake quality insight.',
      entries: Array.from({ length: 14 }, (_, index) => {
        const day = index + 1;
        const poor = [3, 7, 11].includes(day);
        return entry(`quality-${day}`, `2026-04-${pad(day)}`, {
          analysis_observations: observations({
            image_quality: {
              ...observations().image_quality,
              lighting_quality: poor ? 'poor' : 'good',
              needs_retake: poor,
              quality_score: poor ? 0.34 : 0.86,
            },
          }),
          photo_object_key: `photo-${day}.webp`,
        });
      }),
      expectedKinds: ['photo_quality_drift'],
    },
  ];

function ratingWindow(
  prefix: string,
  concern: 'breakouts' | 'redness',
  values: ReadonlyArray<RatingValue>,
): SkinJournalEntry[] {
  return values.map((value, index) =>
    entry(`${prefix}-${index + 1}`, `2026-04-${pad(index + 1)}`, {
      ratings: {
        [concern]: value,
        redness: concern === 'redness' ? value : 2,
      },
    }),
  );
}

function analysisConcernWindow(
  prefix: string,
  concern: AnalysisConcern,
  severities: ReadonlyArray<'mild' | 'moderate' | 'severe' | null>,
): SkinJournalEntry[] {
  return severities.map((severity, index) => {
    const detected = severity
      ? [
          {
            concern,
            severity,
            locations: ['cheek'],
            confidence: 0.82,
          },
        ]
      : [];
    return entry(`${prefix}-${index + 1}`, `2026-04-${pad(index + 1)}`, {
      analysis_observations: observations({
        detected_concerns: detected,
      }),
    });
  });
}

function routineApplications(
  prefix: string,
  stepLabel: string,
  statuses: Array<'applied' | 'skipped'>,
): RoutineApplicationEvidence[] {
  return statuses.map((status, index) => {
    const targetDate = `2026-04-${pad(index + 1)}`;
    return {
      id: `${prefix}-application-${index + 1}`,
      suggestion_instance_id: `${prefix}-suggestion-${index + 1}`,
      slot_id: null,
      target_date: targetDate,
      target_time: '08:00',
      daypart: 'morning',
      updated_at: `${targetDate}T09:00:00.000Z`,
      has_been_edited: false,
      items: [
        {
          step_order: 0,
          suggestion_step_id: `${prefix}-step-${index + 1}`,
          status:
            status === 'applied'
              ? ApplicationItemStatus.Applied
              : ApplicationItemStatus.Skipped,
          step_label: stepLabel,
          inventory_product_id: `${prefix}-product`,
          substituted_with_product_id: null,
          applied_at:
            status === 'applied' ? `${targetDate}T07:30:00.000Z` : null,
          item_source: ApplicationItemSource.Recommended,
          is_ad_hoc: false,
        },
      ],
    };
  });
}

function productApplication(
  targetDate: string,
  productId: string,
): RoutineApplicationEvidence {
  return {
    id: `application-${targetDate}`,
    suggestion_instance_id: `suggestion-${targetDate}`,
    slot_id: null,
    target_date: targetDate,
    target_time: '08:00',
    daypart: 'morning',
    updated_at: `${targetDate}T09:00:00.000Z`,
    has_been_edited: false,
    items: [
      {
        step_order: 0,
        suggestion_step_id: `step-${targetDate}`,
        status: ApplicationItemStatus.Applied,
        step_label: 'serum',
        inventory_product_id: productId,
        substituted_with_product_id: null,
        applied_at: `${targetDate}T07:30:00.000Z`,
        item_source: ApplicationItemSource.Recommended,
        is_ad_hoc: false,
      },
    ],
  };
}

function entry(
  id: string,
  entryDate: string,
  overrides: Partial<SkinJournalEntry> = {},
): SkinJournalEntry {
  return {
    id,
    user_id: 'evaluation-user',
    entry_date: entryDate,
    time_zone: 'UTC',
    photo_object_key: null,
    ratings: null,
    recent_change: null,
    stress_today: null,
    cycle_marker: null,
    analysis_summary: 'Evaluation entry.',
    analysis_status: 'completed',
    analysis_observations: observations(),
    analysis_concern_keys: [],
    has_reaction_signal: false,
    needs_retake: false,
    updated_at: GENERATED_AT,
    ...overrides,
  } as SkinJournalEntry;
}

function observations(
  overrides: Partial<AnalysisObservations> = {},
): AnalysisObservations {
  const base: AnalysisObservations = {
    schema_version: '1.2',
    model_version: 'evaluation',
    image_quality: {
      face_detected: true,
      lighting_quality: 'good',
      framing_quality: 'good',
      blur_detected: false,
      needs_retake: false,
      quality_score: 0.86,
      issues: [],
    },
    detected_concerns: [],
    reaction_signals: {
      reaction_detected: false,
      reaction_severity: 'none',
      indicators: [],
      confidence: 0.1,
    },
    barrier_signs: { barrier_compromise: false, indicators: [] },
    overall_assessment: 'Evaluation baseline.',
    should_flag_for_doctor: false,
  };
  return {
    ...base,
    ...overrides,
    image_quality: {
      ...base.image_quality,
      ...overrides.image_quality,
    },
    reaction_signals: {
      ...base.reaction_signals,
      ...overrides.reaction_signals,
    },
    barrier_signs: {
      ...base.barrier_signs,
      ...overrides.barrier_signs,
    },
  };
}

function pad(day: number): string {
  return String(day).padStart(2, '0');
}

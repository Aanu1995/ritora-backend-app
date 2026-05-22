import type {
  AnalysisObservations,
  AnalysisConcern,
  AnalysisStatus,
  EventSeverity,
  InsightKind,
  OverallFeel,
  RatingsPayload,
  RecentChangePayload,
  SleepBand,
  StressLevel,
  SunExposure,
} from '../skin-journal.constants';
import type {
  NotificationKind,
  NotificationSeverity,
} from '../../notifications/entities/in-app-notification.entity';
import {
  SKIN_JOURNAL_DEMO_SEED_MARKER,
  type SkinJournalDemoEntrySeed,
  type SkinJournalDemoInsightSeed,
  type SkinJournalDemoNotificationSeed,
} from './skin-journal-demo-types';

export function demoEntry(params: {
  key: string;
  offset: number;
  anchorDate: string;
  timeZone: string;
  ratings: RatingsPayload | null;
  overallFeel: OverallFeel | null;
  summary: string | null;
  concerns: AnalysisObservations['detected_concerns'];
  photoTone: string;
  hasPhoto?: boolean;
  analysisStatus?: AnalysisStatus;
  sleepBand?: SleepBand;
  stressToday?: StressLevel;
  sunExposureToday?: SunExposure;
  sweatExerciseToday?: boolean;
  recentChange?: RecentChangePayload | null;
  complaintNote?: string | null;
  imageQuality?: AnalysisObservations['image_quality'];
}): SkinJournalDemoEntrySeed {
  const hasPhoto = params.hasPhoto ?? true;
  const analysisStatus = params.analysisStatus ?? 'completed';
  const reactionConcern = params.concerns.some(
    (detectedConcern) => detectedConcern.severity !== 'mild',
  );
  const analysis =
    hasPhoto && analysisStatus !== 'failed' && analysisStatus !== 'skipped'
      ? demoObservations({
          concerns: params.concerns,
          summary: params.summary ?? '',
          reactionDetected: reactionConcern,
          reactionSeverity: reactionConcern ? 'moderate' : 'none',
          imageQuality: params.imageQuality,
        })
      : null;

  return {
    key: params.key,
    entryDate: addDays(params.anchorDate, params.offset),
    timeZone: params.timeZone,
    hasPhoto,
    analysisStatus,
    ratings: params.ratings,
    overallFeel: params.overallFeel,
    sleepBand: params.sleepBand ?? '7to9h',
    stressToday: params.stressToday ?? 'mid',
    sunExposureToday: params.sunExposureToday ?? 'brief',
    sweatExerciseToday: params.sweatExerciseToday ?? false,
    recentChange: params.recentChange ?? null,
    complaintNote: params.complaintNote ?? null,
    analysis,
    analysisSummary: params.summary,
    photoTone: params.photoTone,
  };
}

export function demoReactionEntry(params: {
  key: string;
  offset: number;
  anchorDate: string;
  timeZone: string;
  severe: boolean;
  photoTone: string;
}): SkinJournalDemoEntrySeed {
  const severity = params.severe ? 'severe' : 'moderate';
  const reactionSeverity = params.severe ? 'severe' : 'moderate';
  const concerns = [
    ...demoConcern(
      'redness_inflammation',
      severity,
      ['left_cheek', 'chin'],
      0.82,
    ),
    ...demoConcern('skin_barrier_damage', severity, ['right_cheek'], 0.74),
  ];

  return {
    ...demoEntry({
      key: params.key,
      offset: params.offset,
      anchorDate: params.anchorDate,
      timeZone: params.timeZone,
      ratings: params.severe
        ? demoRatings(3, 4, 5, 4, 4, 5, 5)
        : demoRatings(3, 3, 4, 3, 3, 4, 4),
      overallFeel: params.severe ? 'awful' : 'bad',
      summary: reactionSummary(params.severe),
      concerns,
      complaintNote: params.severe
        ? 'Stinging and peeling felt worse today.'
        : 'Skin feels hot and reactive.',
      stressToday: 'high',
      photoTone: params.photoTone,
    }),
    analysis: demoObservations({
      concerns,
      summary: reactionSummary(params.severe),
      reactionDetected: true,
      reactionSeverity,
      barrierCompromise: true,
      shouldFlagForDoctor: params.severe,
    }),
  };
}

export function demoObservations(params: {
  concerns: AnalysisObservations['detected_concerns'];
  summary: string;
  reactionDetected?: boolean;
  reactionSeverity?: AnalysisObservations['reaction_signals']['reaction_severity'];
  barrierCompromise?: boolean;
  shouldFlagForDoctor?: boolean;
  imageQuality?: AnalysisObservations['image_quality'];
}): AnalysisObservations {
  return {
    schema_version: '1.0',
    model_version: 'demo-seed',
    image_quality: params.imageQuality ?? {
      face_detected: true,
      lighting_quality: 'good',
      framing_quality: 'good',
      blur_detected: false,
      issues: [],
    },
    detected_concerns: params.concerns,
    reaction_signals: {
      reaction_detected: params.reactionDetected ?? false,
      reaction_severity: params.reactionSeverity ?? 'none',
      indicators: params.reactionDetected
        ? ['redness_spike', 'peeling', 'burning_appearance']
        : [],
      confidence: params.reactionDetected ? 0.82 : 0.2,
    },
    barrier_signs: {
      barrier_compromise: params.barrierCompromise ?? false,
      indicators: params.barrierCompromise
        ? ['flaking', 'diffuse_inflammation']
        : [],
    },
    overall_assessment: params.summary,
    should_flag_for_doctor: params.shouldFlagForDoctor ?? false,
    doctor_flag_reason: params.shouldFlagForDoctor
      ? 'Persistent irritation signals across several recent entries.'
      : undefined,
  };
}

export function demoConcern(
  concernName: AnalysisConcern,
  severity: 'mild' | 'moderate' | 'severe',
  locations: string[],
  confidence: number,
): AnalysisObservations['detected_concerns'] {
  return [{ concern: concernName, severity, locations, confidence }];
}

export function demoRatings(
  oiliness: 1 | 2 | 3 | 4 | 5,
  dryness: 1 | 2 | 3 | 4 | 5,
  redness: 1 | 2 | 3 | 4 | 5,
  breakouts: 1 | 2 | 3 | 4 | 5,
  texture: 1 | 2 | 3 | 4 | 5,
  irritation: 1 | 2 | 3 | 4 | 5,
  sensitivity: 1 | 2 | 3 | 4 | 5,
): RatingsPayload {
  return {
    oiliness,
    dryness,
    redness,
    breakouts,
    texture,
    irritation,
    sensitivity,
  };
}

export function demoInsight(
  kind: InsightKind,
  entryKey: string,
  params: {
    summary: string;
    supportingData: Record<string, unknown>;
    severity: EventSeverity;
    seen: boolean;
    relatedEntryKeys?: string[];
  },
): SkinJournalDemoInsightSeed {
  return {
    kind,
    summary: params.summary,
    supportingData: demoPayload(params.supportingData),
    relatedEntryKeys: params.relatedEntryKeys ?? [entryKey],
    severity: params.severity,
    seen: params.seen,
    dismissed: false,
  };
}

export function demoNotification(
  kind: NotificationKind,
  severity: NotificationSeverity,
  deepLink: string | null,
  params: {
    titleKey: string;
    bodyKey: string;
    read?: boolean;
  },
): SkinJournalDemoNotificationSeed {
  return {
    kind,
    severity,
    titleKey: params.titleKey,
    bodyKey: params.bodyKey,
    payload: demoPayload({ kind }),
    deepLink,
    read: params.read ?? false,
  };
}

export function demoPayload(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return { ...value, seed_marker: SKIN_JOURNAL_DEMO_SEED_MARKER };
}

export function addDays(date: string, offset: number): string {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + offset);
  return parsed.toISOString().slice(0, 10);
}

function reactionSummary(severe: boolean): string {
  return severe
    ? 'Severe-looking irritation signals appear more visible today.'
    : 'Moderate irritation signals appear visible across the cheeks and chin.';
}

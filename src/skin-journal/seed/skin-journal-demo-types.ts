import type {
  AnalysisObservations,
  AnalysisStatus,
  EventKind,
  EventSeverity,
  InsightKind,
  OverallFeel,
  RatingsPayload,
  RecentChangePayload,
  SleepBand,
  StressLevel,
  SunExposure,
  WrappedManifest,
} from '../skin-journal.constants';
import type {
  NotificationKind,
  NotificationSeverity,
} from '../../notifications/entities/in-app-notification.entity';

export const SKIN_JOURNAL_DEMO_SEED_MARKER = 'skin-journal-demo-seed-v1';
export const SKIN_JOURNAL_DEMO_EMAIL = 'demo@ritora.local';
export const SKIN_JOURNAL_DEMO_PASSWORD = 'Password123!';

export type SkinJournalDemoEntrySeed = {
  key: string;
  entryDate: string;
  timeZone: string;
  hasPhoto: boolean;
  analysisStatus: AnalysisStatus;
  ratings: RatingsPayload | null;
  overallFeel: OverallFeel | null;
  sleepBand: SleepBand | null;
  stressToday: StressLevel | null;
  sunExposureToday: SunExposure | null;
  sweatExerciseToday: boolean | null;
  recentChange: RecentChangePayload | null;
  complaintNote: string | null;
  analysis: AnalysisObservations | null;
  analysisSummary: string | null;
  photoTone: string;
};

export type SkinJournalDemoEventSeed = {
  entryKey: string;
  kind: EventKind;
  severity: EventSeverity;
  payload: Record<string, unknown>;
  acknowledged: boolean;
};

export type SkinJournalDemoInsightSeed = {
  kind: InsightKind;
  summary: string;
  supportingData: Record<string, unknown>;
  relatedEntryKeys: string[];
  severity: EventSeverity;
  seen: boolean;
  dismissed: boolean;
};

export type SkinJournalDemoNotificationSeed = {
  kind: NotificationKind;
  titleKey: string;
  bodyKey: string;
  severity: NotificationSeverity;
  payload: Record<string, unknown>;
  deepLink: string | null;
  read: boolean;
};

export type SkinJournalDemoData = {
  entries: SkinJournalDemoEntrySeed[];
  events: SkinJournalDemoEventSeed[];
  insights: SkinJournalDemoInsightSeed[];
  notifications: SkinJournalDemoNotificationSeed[];
  simplification: {
    triggeredByEntryKey: string;
    simplification_mode: 'barrier_repair';
    restore_strategy: 'full';
    reason: string;
  };
  wrapped: WrappedManifest[];
};

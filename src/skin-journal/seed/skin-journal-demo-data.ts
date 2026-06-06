import {
  addDays,
  demoConcern as concern,
  demoEntry as entry,
  demoInsight as insight,
  demoNotification as notification,
  demoPayload as payload,
  demoRatings as ratings,
  demoReactionEntry as reactionEntry,
} from './skin-journal-demo-builders';
import type {
  SkinJournalDemoData,
  SkinJournalDemoEventSeed,
  SkinJournalDemoInsightSeed,
  SkinJournalDemoNotificationSeed,
} from './skin-journal-demo-types';

export {
  SKIN_JOURNAL_DEMO_EMAIL,
  SKIN_JOURNAL_DEMO_PASSWORD,
  SKIN_JOURNAL_DEMO_SEED_MARKER,
} from './skin-journal-demo-types';
export type {
  SkinJournalDemoEntrySeed,
  SkinJournalDemoData,
  SkinJournalDemoEventSeed,
  SkinJournalDemoInsightSeed,
  SkinJournalDemoNotificationSeed,
} from './skin-journal-demo-types';

type BuildDemoDataParams = {
  anchorDate: string;
  timeZone: string;
};

const PHOTO_TONES = [
  '#eac7b8',
  '#e4bca9',
  '#d9a997',
  '#d39b8b',
  '#c98f82',
  '#bd8377',
  '#d2a193',
  '#dfb4a4',
] as const;

export function buildSkinJournalDemoData({
  anchorDate,
  timeZone,
}: BuildDemoDataParams): SkinJournalDemoData {
  const entries = [
    entry({
      key: 'baseline',
      offset: -30,
      anchorDate,
      timeZone,
      ratings: ratings(2, 3, 2, 3, 3, 2, 2),
      overallFeel: 'ok',
      summary:
        'Baseline photo shows mild texture and a few visible breakouts around the chin.',
      concerns: concern('texture', 'mild', ['chin', 'left_cheek'], 0.63),
      photoTone: PHOTO_TONES[0],
    }),
    entry({
      key: 'steady-week-four',
      offset: -24,
      anchorDate,
      timeZone,
      ratings: ratings(2, 3, 2, 2, 3, 2, 2),
      overallFeel: 'good',
      summary:
        'Skin appears a little calmer with less visible redness across the cheeks.',
      concerns: concern('redness_inflammation', 'mild', ['left_cheek'], 0.58),
      photoTone: PHOTO_TONES[1],
    }),
    entry({
      key: 'hydration-improving',
      offset: -18,
      anchorDate,
      timeZone,
      ratings: ratings(2, 2, 2, 2, 2, 2, 2),
      overallFeel: 'good',
      summary:
        'Hydration appears steadier and the skin surface looks more even.',
      concerns: concern('dryness', 'mild', ['forehead'], 0.51),
      photoTone: PHOTO_TONES[2],
    }),
    entry({
      key: 'photo-less-check-in',
      offset: -14,
      anchorDate,
      timeZone,
      hasPhoto: false,
      analysisStatus: 'skipped',
      ratings: ratings(2, 2, 2, 2, 2, 2, 2),
      overallFeel: 'good',
      summary: null,
      concerns: [],
      complaintNote: 'Quick check-in only; no photo added.',
      photoTone: PHOTO_TONES[3],
    }),
    entry({
      key: 'needs-review',
      offset: -11,
      anchorDate,
      timeZone,
      analysisStatus: 'needs_review',
      ratings: ratings(2, 2, 2, 2, 2, 2, 2),
      overallFeel: 'ok',
      summary:
        'Lighting is uneven, so this photo is kept for the journal but excluded from trend confidence.',
      concerns: [],
      imageQuality: {
        face_detected: false,
        lighting_quality: 'poor',
        framing_quality: 'fair',
        blur_detected: true,
        issues: ['low_light', 'motion_blur'],
      },
      photoTone: PHOTO_TONES[4],
    }),
    entry({
      key: 'worsening-start',
      offset: -9,
      anchorDate,
      timeZone,
      ratings: ratings(3, 3, 3, 3, 3, 3, 3),
      overallFeel: 'bad',
      summary: 'Redness and texture appear more visible than earlier entries.',
      concerns: concern('redness_inflammation', 'moderate', ['chin'], 0.72),
      recentChange: {
        kind: 'started_new_product',
        note: 'Started a stronger exfoliating toner.',
      },
      complaintNote: 'A bit tight and warm tonight.',
      photoTone: PHOTO_TONES[5],
    }),
    ...[-7, -6, -5, -4, -3].map((offset, index) =>
      reactionEntry({
        key: `reaction-${index + 1}`,
        offset,
        anchorDate,
        timeZone,
        severe: index >= 2,
        photoTone: PHOTO_TONES[(index + 1) % PHOTO_TONES.length],
      }),
    ),
    entry({
      key: 'failed-analysis',
      offset: -2,
      anchorDate,
      timeZone,
      analysisStatus: 'failed',
      ratings: ratings(3, 3, 3, 3, 3, 3, 3),
      overallFeel: 'bad',
      summary: null,
      concerns: [],
      complaintNote: 'Photo saved, but analysis needs a retry.',
      photoTone: PHOTO_TONES[6],
    }),
    entry({
      key: 'recovery',
      offset: -1,
      anchorDate,
      timeZone,
      ratings: ratings(2, 2, 2, 2, 2, 2, 2),
      overallFeel: 'ok',
      summary:
        'Visible redness appears lower and the barrier signs look calmer today.',
      concerns: concern('redness_inflammation', 'mild', ['right_cheek'], 0.61),
      photoTone: PHOTO_TONES[7],
    }),
    entry({
      key: 'today',
      offset: 0,
      anchorDate,
      timeZone,
      ratings: ratings(2, 2, 2, 1, 2, 1, 2),
      overallFeel: 'good',
      summary:
        'Today looks calmer, with fewer visible breakouts around the chin.',
      concerns: concern('texture', 'mild', ['chin'], 0.57),
      photoTone: PHOTO_TONES[0],
    }),
  ];

  return {
    entries,
    events: buildEvents(),
    insights: buildInsights(),
    notifications: buildNotifications(anchorDate),
    simplification: {
      triggeredByEntryKey: 'reaction-3',
      simplification_mode: 'barrier_repair',
      restore_strategy: 'full',
      reason:
        'Demo safety state created after repeated moderate to severe irritation signals.',
    },
    wrapped: [],
  };
}

function buildEvents(): SkinJournalDemoEventSeed[] {
  return [
    {
      entryKey: 'worsening-start',
      kind: 'worsening',
      severity: 'warning',
      payload: payload({
        headline: 'Redness and irritation rose compared with baseline.',
      }),
      acknowledged: true,
    },
    {
      entryKey: 'reaction-3',
      kind: 'reaction_detected',
      severity: 'critical',
      payload: payload({
        indicators: ['redness_spike', 'peeling', 'burning_appearance'],
        reaction_severity: 'severe',
      }),
      acknowledged: false,
    },
    {
      entryKey: 'reaction-5',
      kind: 'dermatologist_referral',
      severity: 'critical',
      payload: payload({
        threshold: '5 moderate/severe reaction signals in 7 days',
      }),
      acknowledged: false,
    },
    {
      entryKey: 'recovery',
      kind: 'recovery',
      severity: 'info',
      payload: payload({
        headline: 'Redness and irritation returned closer to baseline.',
      }),
      acknowledged: false,
    },
    {
      entryKey: 'today',
      kind: 'product_effectiveness',
      severity: 'info',
      payload: payload({
        headline:
          'Recent calmer entries may correlate with pausing the stronger exfoliant.',
      }),
      acknowledged: false,
    },
  ];
}

function buildInsights(): SkinJournalDemoInsightSeed[] {
  return [
    insight('daily', 'today', {
      summary:
        'Today appears calmer than the reaction cluster earlier this week.',
      severity: 'info',
      supportingData: { redness_delta: -2, irritation_delta: -2 },
      seen: false,
    }),
    insight('weekly', 'reaction-5', {
      summary:
        'This week shows a clear irritation spike followed by early recovery.',
      severity: 'warning',
      relatedEntryKeys: [
        'reaction-1',
        'reaction-2',
        'reaction-3',
        'reaction-4',
        'reaction-5',
        'recovery',
      ],
      supportingData: { reaction_days: 5, recovery_days: 1 },
      seen: false,
    }),
    insight('monthly', 'baseline', {
      summary:
        'Across the month, texture and breakouts improved before a short irritation spike.',
      severity: 'info',
      relatedEntryKeys: ['baseline', 'hydration-improving', 'today'],
      supportingData: { tracked_days: 14, photo_days: 13 },
      seen: true,
    }),
    insight('trend', 'today', {
      summary: 'Breakout ratings trend downward over the tracked period.',
      severity: 'info',
      supportingData: { concern: 'breakouts', slope: -0.18 },
      seen: true,
    }),
    insight('correlation', 'worsening-start', {
      summary:
        'The irritation spike may be related to the recent stronger exfoliating toner.',
      severity: 'warning',
      relatedEntryKeys: ['worsening-start', 'reaction-1', 'reaction-3'],
      supportingData: { recent_change: 'started_new_product', window_days: 7 },
      seen: false,
    }),
    insight('effectiveness', 'today', {
      summary:
        'Pausing the stronger exfoliant correlates with calmer recent check-ins.',
      severity: 'info',
      relatedEntryKeys: ['reaction-3', 'recovery', 'today'],
      supportingData: { confidence: 0.68 },
      seen: false,
    }),
    insight('reaction_recovery', 'recovery', {
      summary:
        'Recovery appears to have started after simplifying the routine.',
      severity: 'info',
      relatedEntryKeys: ['reaction-5', 'recovery'],
      supportingData: { irritation_change: -2 },
      seen: false,
    }),
    insight('referral', 'reaction-5', {
      summary:
        'Persistent moderate to severe irritation signals make a dermatologist review sensible.',
      severity: 'critical',
      relatedEntryKeys: [
        'reaction-1',
        'reaction-2',
        'reaction-3',
        'reaction-4',
        'reaction-5',
      ],
      supportingData: { threshold_met: true, trailing_days: 7 },
      seen: false,
    }),
  ];
}

function buildNotifications(
  anchorDate: string,
): SkinJournalDemoNotificationSeed[] {
  return [
    notification('photo_reminder', 'info', '/journal/upload', {
      titleKey: 'skinJournal.notifications.photoReminder.title',
      bodyKey: 'skinJournal.notifications.photoReminder.body',
      read: true,
    }),
    notification(
      'reaction_detected',
      'critical',
      `/journal/days/${addDays(anchorDate, -5)}`,
      {
        titleKey: 'skinJournal.notifications.reactionDetected.title',
        bodyKey: 'skinJournal.notifications.reactionDetected.body',
      },
    ),
    notification('simplification_started', 'warning', '/journal', {
      titleKey: 'skinJournal.notifications.simplificationStarted.title',
      bodyKey: 'skinJournal.notifications.simplificationStarted.body',
    }),
    notification(
      'doctor_referral',
      'critical',
      `/journal/days/${addDays(anchorDate, -3)}`,
      {
        titleKey: 'skinJournal.notifications.doctorReferral.title',
        bodyKey: 'skinJournal.notifications.doctorReferral.body',
      },
    ),
    notification('insight_ready', 'info', '/journal?tab=insights', {
      titleKey: 'skinJournal.notifications.insightReady.title',
      bodyKey: 'skinJournal.notifications.insightReady.body',
    }),
    notification(
      'analysis_failed',
      'warning',
      `/journal/days/${addDays(anchorDate, -2)}`,
      {
        titleKey: 'skinJournal.notifications.analysisFailed.title',
        bodyKey: 'skinJournal.notifications.analysisFailed.body',
      },
    ),
  ];
}

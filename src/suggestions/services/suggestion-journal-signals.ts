import { toDateOnlyString } from '../../common/utils/date';
import { SkinJournalEntry } from '../../skin-journal/entities/skin-journal-entry.entity';
import { SuggestionContextSummary } from '../suggestion-context.types';
import {
  currentJournalPhotoAngleCount,
  hasMultiAngleJournalPhoto,
  hasUsableJournalReactionSignal,
} from './suggestion-journal-context';
import {
  daysBetween,
  increment,
  trimForPrompt,
  unique,
} from './suggestion-context-common';
import { JournalPhotoAnalysisSignalCollector } from './suggestion-photo-analysis-signals';

export function buildJournalSignals(
  entries: SkinJournalEntry[],
): NonNullable<SuggestionContextSummary['journalSignals']> {
  const sortedEntries = entries.slice().sort(compareJournalRecency);
  const stressCounts: Record<string, number> = {};
  const sleepCounts: Record<string, number> = {};
  const overallFeelCounts: Record<string, number> = {};
  const sunExposureCounts: Record<string, number> = {};
  const cycleMarkers: string[] = [];
  const recentChangeKinds: string[] = [];
  const photoAnalysis = new JournalPhotoAnalysisSignalCollector();
  let sweatExerciseDays = 0;
  const complaintNotes: string[] = [];

  for (const entry of sortedEntries) {
    const entryDate = toDateOnlyString(entry.entry_date);

    if (entry.stress_today) increment(stressCounts, entry.stress_today);
    if (entry.sleep_band) increment(sleepCounts, entry.sleep_band);
    if (entry.overall_feel) increment(overallFeelCounts, entry.overall_feel);
    if (entry.sun_exposure_today)
      increment(sunExposureCounts, entry.sun_exposure_today);
    if (entry.sweat_exercise_today) sweatExerciseDays += 1;
    if (entry.cycle_marker) cycleMarkers.push(entry.cycle_marker);
    if (entry.recent_change?.kind)
      recentChangeKinds.push(entry.recent_change.kind);
    if (entry.complaint_note && complaintNotes.length < 5) {
      complaintNotes.push(trimForPrompt(entry.complaint_note, 120));
    }
    photoAnalysis.collect(entry, entryDate);
  }

  const photoSummary = photoAnalysis.build();
  const photoInputImages = sortedEntries.reduce(
    (sum, entry) => sum + currentJournalPhotoAngleCount(entry),
    0,
  );
  const trendSignals = buildJournalTrendSignals(
    sortedEntries,
    stressCounts,
    sunExposureCounts,
    sweatExerciseDays,
    photoSummary.needsRetakeCount,
    photoSummary.trendSignals,
  );

  return {
    recordsConsidered: entries.length,
    latestEntryDate: sortedEntries[0]
      ? toDateOnlyString(sortedEntries[0].entry_date)
      : null,
    checkIns: {
      stressCounts,
      sleepCounts,
      overallFeelCounts,
      sunExposureCounts,
      sweatExerciseDays,
      cycleMarkers: unique(cycleMarkers),
      recentChangeKinds: unique(recentChangeKinds),
      complaintNotes,
    },
    detectedConcerns: photoSummary.detectedConcerns,
    photoCoverage: {
      photoEntries: sortedEntries.filter(
        (entry) =>
          Boolean(entry.photo_object_key) ||
          currentJournalPhotoAngleCount(entry) > 0,
      ).length,
      photoInputImages,
      multiAnglePhotoEntries: sortedEntries.filter(hasMultiAngleJournalPhoto)
        .length,
      needsRetakeCount: photoSummary.needsRetakeCount,
    },
    trendSignals,
    analysisQuality: photoSummary.analysisQuality,
    interpretationSignals: photoSummary.interpretationSignals,
    concernGuidance: photoSummary.concernGuidance,
    visualChanges: photoSummary.visualChanges,
    safetySignals: photoSummary.safetySignals,
  };
}

export function buildReactionSummary(
  entries: SkinJournalEntry[],
  targetDate: string,
): SuggestionContextSummary['reaction'] {
  const reactionEntries = entries
    .slice()
    .sort(compareJournalRecency)
    .filter(hasUsableJournalReactionSignal);
  const latest = reactionEntries[0] ?? null;
  const observations = latest?.analysis_observations ?? null;
  const concerns = entries.flatMap(
    (entry) => entry.analysis_observations?.detected_concerns ?? [],
  );
  const photoInputImages = entries.reduce(
    (sum, entry) => sum + currentJournalPhotoAngleCount(entry),
    0,
  );
  const reactionConcerns = concerns.filter((concern) =>
    [
      'redness_inflammation',
      'dryness',
      'skin_barrier_damage',
      'eczema_indicator',
      'acne',
    ].includes(concern.concern),
  );
  return {
    hasSignal: Boolean(latest),
    severity: observations?.reaction_signals?.reaction_severity ?? null,
    confidence: observations?.reaction_signals?.confidence ?? null,
    indicators: [
      ...(observations?.reaction_signals?.indicators ?? []),
      ...(observations?.barrier_signs?.indicators ?? []),
    ],
    affectedZones: unique(
      reactionConcerns.flatMap((concern) => concern.locations),
    ),
    concernKeys: unique(reactionConcerns.map((concern) => concern.concern)),
    daysSinceLatestSignal: latest
      ? daysBetween(latest.entry_date, targetDate)
      : null,
    barrierCompromised: Boolean(
      observations?.barrier_signs?.barrier_compromise ||
      reactionConcerns.some(
        (concern) => concern.concern === 'skin_barrier_damage',
      ),
    ),
    photoInputImages,
    multiAnglePhotoEntries: entries.filter(hasMultiAngleJournalPhoto).length,
  };
}

function buildJournalTrendSignals(
  entries: SkinJournalEntry[],
  stressCounts: Record<string, number>,
  sunExposureCounts: Record<string, number>,
  sweatExerciseDays: number,
  needsRetakeCount: number,
  photoTrendSignals: string[],
): string[] {
  const signals: string[] = [];
  if (entries.some(hasUsableJournalReactionSignal)) {
    signals.push('reaction_signal_present');
  }
  if (
    entries.some(
      (entry) =>
        entry.analysis_observations?.barrier_signs?.barrier_compromise === true,
    )
  ) {
    signals.push('barrier_compromised');
  }
  if ((stressCounts.high ?? 0) >= 2) signals.push('high_stress_recent');
  if ((sunExposureCounts.brief ?? 0) + (sunExposureCounts.lots ?? 0) > 0) {
    signals.push('sun_exposure_recent');
  }
  if (sweatExerciseDays > 0) signals.push('sweat_exercise_recent');
  if (needsRetakeCount > 0) signals.push('needs_retake_present');
  if (
    entries.some(
      (entry) =>
        (entry.ratings?.dryness ?? 0) >= 4 ||
        (entry.ratings?.irritation ?? 0) >= 4 ||
        (entry.ratings?.sensitivity ?? 0) >= 4,
    )
  ) {
    signals.push('barrier_discomfort_ratings');
  }
  if (
    entries.some((entry) => entry.recent_change?.kind === 'started_new_product')
  ) {
    signals.push('new_product_recently_started');
  }
  signals.push(...photoTrendSignals);
  return unique(signals);
}

function compareJournalRecency(
  first: SkinJournalEntry,
  second: SkinJournalEntry,
): number {
  const firstDate = toDateOnlyString(first.entry_date);
  const secondDate = toDateOnlyString(second.entry_date);
  if (firstDate !== secondDate) {
    return firstDate < secondDate ? 1 : -1;
  }
  const firstUpdated = first.updated_at?.getTime() ?? 0;
  const secondUpdated = second.updated_at?.getTime() ?? 0;
  return secondUpdated - firstUpdated;
}

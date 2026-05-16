import { SkinJournalEntry } from '../../skin-journal/entities/skin-journal-entry.entity';
import {
  AnalysisStatusValue,
  SKIN_JOURNAL_FRONT_PHOTO_ANGLE,
  SKIN_JOURNAL_PHOTO_ANGLES,
  type Angle,
} from '../../skin-journal/skin-journal.constants';

const PHOTO_ANGLE_SET: ReadonlySet<Angle> = new Set(SKIN_JOURNAL_PHOTO_ANGLES);

export function normalizeJournalEntriesForSuggestions(
  entries: SkinJournalEntry[],
): SkinJournalEntry[] {
  return entries.map(normalizeJournalEntryForSuggestion);
}

export function normalizeJournalEntryForSuggestion(
  entry: SkinJournalEntry,
): SkinJournalEntry {
  if (hasCurrentPhoto(entry)) return entry;
  return {
    ...entry,
    analysis_status: AnalysisStatusValue.Pending,
    analysis_observations: null,
    analysis_interpretation: null,
    analysis_summary: null,
    analysis_concern_keys: [],
    has_reaction_signal: false,
    needs_retake: false,
    generateId() {
      return entry.generateId.call(this);
    },
  };
}

export function hasUsableJournalReactionSignal(
  entry: SkinJournalEntry,
): boolean {
  if (!hasCurrentPhoto(entry)) return false;
  return Boolean(
    entry.has_reaction_signal ||
    entry.analysis_observations?.reaction_signals?.reaction_detected ||
    entry.analysis_observations?.barrier_signs?.barrier_compromise,
  );
}

export function currentJournalPhotoAngleCount(entry: SkinJournalEntry): number {
  return currentJournalPhotoAngles(entry).length;
}

export function currentJournalPhotoAngleLabels(
  entry: SkinJournalEntry,
): string[] {
  return currentJournalPhotoAngles(entry);
}

function currentJournalPhotoAngles(entry: SkinJournalEntry): Angle[] {
  const perAngleQuality = entry.analysis_observations?.per_angle_quality;
  if (Array.isArray(perAngleQuality) && perAngleQuality.length > 0) {
    const seen = new Set<Angle>();
    for (const quality of perAngleQuality) {
      const angle = quality.angle;
      if (PHOTO_ANGLE_SET.has(angle) && !seen.has(angle)) {
        seen.add(angle);
      }
    }
    if (seen.size > 0) {
      return Array.from(seen);
    }
  }
  return hasCurrentPhoto(entry) ? [SKIN_JOURNAL_FRONT_PHOTO_ANGLE] : [];
}

export function hasMultiAngleJournalPhoto(entry: SkinJournalEntry): boolean {
  return currentJournalPhotoAngleCount(entry) > 1;
}

export function hasCurrentPhoto(entry: SkinJournalEntry): boolean {
  return Boolean(entry.photo_object_key?.trim());
}

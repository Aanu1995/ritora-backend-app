import { SkinJournalEntry } from '../../skin-journal/entities/skin-journal-entry.entity';
import { AnalysisStatusValue } from '../../skin-journal/skin-journal.constants';

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

function hasCurrentPhoto(entry: SkinJournalEntry): boolean {
  return Boolean(entry.photo_object_key?.trim());
}

import { SkinJournalEntry } from '../../skin-journal/entities/skin-journal-entry.entity';
import {
  currentJournalPhotoAngleCount,
  currentJournalPhotoAngleLabels,
  hasMultiAngleJournalPhoto,
  hasUsableJournalReactionSignal,
  normalizeJournalEntryForSuggestion,
} from './suggestion-journal-context';

describe('suggestion journal context', () => {
  it('keeps current photo analysis available to suggestions', () => {
    const entry = reactionEntry({ photoObjectKey: 'journal/photo.jpg' });

    expect(normalizeJournalEntryForSuggestion(entry)).toBe(entry);
    expect(hasUsableJournalReactionSignal(entry)).toBe(true);
  });

  it('removes stale photo analysis after a journal photo is removed', () => {
    const entry = reactionEntry({ photoObjectKey: null });

    const normalized = normalizeJournalEntryForSuggestion(entry);

    expect(normalized.photo_object_key).toBeNull();
    expect(normalized.has_reaction_signal).toBe(false);
    expect(normalized.analysis_observations).toBeNull();
    expect(normalized.analysis_interpretation).toBeNull();
    expect(normalized.analysis_summary).toBeNull();
    expect(normalized.analysis_concern_keys).toEqual([]);
    expect(hasUsableJournalReactionSignal(normalized)).toBe(false);
  });

  it('reports multi-angle analysis coverage for downstream AI context', () => {
    const entry = {
      ...reactionEntry({ photoObjectKey: 'journal/front.jpg' }),
      analysis_observations: {
        per_angle_quality: [
          { angle: 'head_on' },
          { angle: 'left_profile' },
          { angle: 'right_profile' },
        ],
        reaction_signals: {
          reaction_detected: true,
          reaction_severity: 'moderate',
          confidence: 0.82,
          indicators: ['redness'],
        },
      },
    } as unknown as SkinJournalEntry;

    expect(currentJournalPhotoAngleCount(entry)).toBe(3);
    expect(currentJournalPhotoAngleLabels(entry)).toEqual([
      'head_on',
      'left_profile',
      'right_profile',
    ]);
    expect(hasMultiAngleJournalPhoto(entry)).toBe(true);
  });

  it('deduplicates stale duplicate angle quality rows in downstream AI context', () => {
    const entry = {
      ...reactionEntry({ photoObjectKey: 'journal/front.jpg' }),
      analysis_observations: {
        per_angle_quality: [
          { angle: 'head_on' },
          { angle: 'head_on' },
          { angle: 'left_profile' },
        ],
        reaction_signals: {
          reaction_detected: true,
          reaction_severity: 'moderate',
          confidence: 0.82,
          indicators: ['redness'],
        },
      },
    } as unknown as SkinJournalEntry;

    expect(currentJournalPhotoAngleCount(entry)).toBe(2);
    expect(currentJournalPhotoAngleLabels(entry)).toEqual([
      'head_on',
      'left_profile',
    ]);
    expect(hasMultiAngleJournalPhoto(entry)).toBe(true);
  });
});

function reactionEntry(input: {
  photoObjectKey: string | null;
}): SkinJournalEntry {
  return {
    id: 'journal-1',
    entry_date: '2026-05-06',
    photo_object_key: input.photoObjectKey,
    analysis_status: 'completed',
    has_reaction_signal: true,
    needs_retake: true,
    analysis_observations: {
      reaction_signals: {
        reaction_detected: true,
        reaction_severity: 'moderate',
        confidence: 0.82,
        indicators: ['redness'],
      },
    },
    analysis_interpretation: {
      summary: 'Visible redness around cheeks.',
    },
    analysis_summary: 'Reaction signal detected.',
    analysis_concern_keys: ['redness_inflammation'],
  } as unknown as SkinJournalEntry;
}

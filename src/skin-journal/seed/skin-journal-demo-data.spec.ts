import {
  buildSkinJournalDemoData,
  SKIN_JOURNAL_DEMO_SEED_MARKER,
} from './skin-journal-demo-data';

describe('buildSkinJournalDemoData', () => {
  it('covers every journal state the frontend needs to render', () => {
    const seed = buildSkinJournalDemoData({
      anchorDate: '2026-04-30',
      timeZone: 'Europe/Stockholm',
    });

    const statuses = new Set(seed.entries.map((entry) => entry.analysisStatus));
    const hasPhotoLessEntry = seed.entries.some((entry) => !entry.hasPhoto);
    const hasReactionEntry = seed.entries.some(
      (entry) => entry.analysis?.reaction_signals.reaction_detected === true,
    );

    expect([...statuses]).toEqual(
      expect.arrayContaining([
        'completed',
        'failed',
        'needs_review',
        'skipped',
      ]),
    );
    expect(hasPhotoLessEntry).toBe(true);
    expect(hasReactionEntry).toBe(true);
  });

  it('prepares notification and warning data without creating wrapped rows', () => {
    const seed = buildSkinJournalDemoData({
      anchorDate: '2026-04-30',
      timeZone: 'Europe/Stockholm',
    });

    expect(seed.wrapped).toEqual([]);
    expect(seed.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'reaction_detected' }),
        expect.objectContaining({ kind: 'dermatologist_referral' }),
      ]),
    );
    expect(seed.simplification).toEqual(
      expect.objectContaining({ simplification_mode: 'barrier_repair' }),
    );
    expect(seed.notifications.map((notification) => notification.kind)).toEqual(
      expect.arrayContaining([
        'photo_reminder',
        'reaction_detected',
        'simplification_started',
        'doctor_referral',
        'insight_ready',
        'analysis_failed',
      ]),
    );
    expect(
      seed.notifications.every(
        (notification) =>
          notification.payload?.seed_marker === SKIN_JOURNAL_DEMO_SEED_MARKER,
      ),
    ).toBe(true);
  });
});

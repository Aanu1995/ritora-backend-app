import { SkinJournalWrapped } from './entities/skin-journal-wrapped.entity';
import { SkinJournalEntry } from './entities/skin-journal-entry.entity';
import { RoutineSimplificationEvent } from './entities/routine-simplification-event.entity';
import { SkinJournalEvent } from './entities/skin-journal-event.entity';
import { SkinJournalInsight } from './entities/skin-journal-insight.entity';
import {
  toExportEntryRecord,
  toExportEventRecord,
  toExportInsightRecord,
  toExportSimplificationRecord,
  toWrappedExportRecord,
  toWrappedResponseDto,
} from './skin-journal-export.mapper';

describe('skin journal export mapper', () => {
  const resolvePhotoUrl = jest.fn((key: string | null, options = {}) =>
    key ? `signed:${options.ttlSeconds}:${key}` : null,
  );

  beforeEach(() => {
    resolvePhotoUrl.mockClear();
  });

  it('stores object keys in entry export records', () => {
    const entry = {
      id: 'entry-1',
      entry_date: '2026-04-30',
      photo_object_key: 'skin-journal/user-1/entry-1/photo.webp',
    } as SkinJournalEntry;

    expect(toExportEntryRecord(entry)).toEqual(
      expect.objectContaining({
        id: 'entry-1',
        photo_object_key: 'skin-journal/user-1/entry-1/photo.webp',
        photo_url: null,
      }),
    );
  });

  it('resolves wrapped manifest photo URLs for app responses', () => {
    const wrapped = {
      id: 'wrapped-1',
      period_kind: 'monthly',
      period_start: '2026-04-01',
      period_end: '2026-04-30',
      status: 'ready',
      generated_at: new Date('2026-04-30T10:00:00.000Z'),
      error: null,
      manifest: {
        entries: [
          {
            entry_id: 'entry-1',
            entry_date: '2026-04-01',
            photo_object_key: 'skin-journal/user-1/entry-1/photo.webp',
            caption: 'Week 1',
          },
        ],
        timing: { fade_ms: 400, hold_ms: 1600 },
      },
    } as SkinJournalWrapped;

    const response = toWrappedResponseDto(wrapped, resolvePhotoUrl);

    expect(response.manifest?.entries[0].photo_url).toBe(
      'signed:undefined:skin-journal/user-1/entry-1/photo.webp',
    );
  });

  it('maps related export records without leaking signed wrapped URLs into stored payloads', () => {
    const event = {
      id: 'event-1',
      kind: 'reaction_detected',
      severity: 'warning',
      payload: { indicator: 'redness' },
      acknowledged_at: null,
      created_at: new Date('2026-04-03T10:00:00.000Z'),
    } as unknown as SkinJournalEvent;
    const insight = {
      id: 'insight-1',
      kind: 'daily',
      severity: 'info',
      confidence: 0.8,
      headline: { key: 'journal.insights.daily' },
      summary: null,
      supporting_data: { count: 2 },
      related_entry_ids: ['entry-1'],
      generated_at: new Date('2026-04-03T10:00:00.000Z'),
      seen_at: null,
      dismissed_at: null,
    } as unknown as SkinJournalInsight;
    const simplification = {
      id: 'simplification-1',
      simplification_mode: 'barrier_repair',
      reason: 'Irritation signal',
      original_schedule_snapshot: { slots: [] },
      started_at: new Date('2026-04-03T10:00:00.000Z'),
      ended_at: null,
      acknowledged_at: null,
      restore_strategy: 'full',
    } as unknown as RoutineSimplificationEvent;
    const wrapped = {
      id: 'wrapped-1',
      period_kind: 'monthly',
      period_start: '2026-04-01',
      period_end: '2026-04-30',
      status: 'ready',
      generated_at: new Date('2026-04-30T10:00:00.000Z'),
      error: null,
      manifest: {
        entries: [
          {
            entry_id: 'entry-1',
            entry_date: '2026-04-01',
            photo_object_key: 'skin-journal/user-1/entry-1/photo.webp',
            photo_url: 'signed-url-should-not-persist',
          },
        ],
        timing: { fade_ms: 400, hold_ms: 1600 },
      },
    } as unknown as SkinJournalWrapped;

    expect(toExportEventRecord(event)).toEqual(
      expect.objectContaining({ id: 'event-1', kind: 'reaction_detected' }),
    );
    expect(toExportInsightRecord(insight)).toEqual(
      expect.objectContaining({ id: 'insight-1', kind: 'daily' }),
    );
    expect(toExportSimplificationRecord(simplification)).toEqual(
      expect.objectContaining({
        id: 'simplification-1',
        simplification_mode: 'barrier_repair',
      }),
    );
    expect(toWrappedExportRecord(wrapped)).toEqual(
      expect.objectContaining({
        id: 'wrapped-1',
        photo_count: 1,
        manifest: expect.objectContaining({
          entries: [
            expect.objectContaining({
              photo_url: null,
              photo_object_key: 'skin-journal/user-1/entry-1/photo.webp',
            }),
          ],
        }),
      }),
    );
  });
});

import { SkinJournalExportJob } from './entities/skin-journal-export-job.entity';
import { SkinJournalWrapped } from './entities/skin-journal-wrapped.entity';
import { SkinJournalEntry } from './entities/skin-journal-entry.entity';
import {
  SKIN_JOURNAL_EXPORT_SIGNED_URL_TTL_SECONDS,
  type SkinJournalExportPayload,
} from './skin-journal.constants';
import {
  toExportEntryRecord,
  toExportResponse,
  toWrappedResponseDto,
} from './skin-journal-export.mapper';

describe('skin journal export mapper', () => {
  const resolvePhotoUrl = jest.fn((key: string | null, options = {}) =>
    key ? `signed:${options.ttlSeconds}:${key}` : null,
  );

  beforeEach(() => {
    resolvePhotoUrl.mockClear();
  });

  it('keeps export records durable and signs photos only on response', () => {
    const payload: SkinJournalExportPayload = {
      generated_at: '2026-04-30T10:00:00.000Z',
      from: '2026-04-01',
      to: '2026-04-30',
      entries: [
        {
          id: 'entry-1',
          photo_object_key: 'skin-journal/user-1/entry-1/photo.webp',
          photo_url: null,
        },
      ],
      events: [],
      insights: [],
      wrapped: [],
      simplifications: [],
    };
    const job = {
      id: 'export-1',
      status: 'ready',
      range_from: '2026-04-01',
      range_to: '2026-04-30',
      payload,
      error: null,
      created_at: new Date('2026-04-30T10:00:00.000Z'),
    } as SkinJournalExportJob;

    const response = toExportResponse(job, resolvePhotoUrl);

    expect(response.payload?.entries[0].photo_url).toBe(
      `signed:${SKIN_JOURNAL_EXPORT_SIGNED_URL_TTL_SECONDS}:skin-journal/user-1/entry-1/photo.webp`,
    );
    expect(payload.entries[0].photo_url).toBeNull();
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
});

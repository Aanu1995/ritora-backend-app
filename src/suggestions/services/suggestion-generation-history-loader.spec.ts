import { ObjectLiteral, Repository } from 'typeorm';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { SkinJournalEntry } from '../../skin-journal/entities/skin-journal-entry.entity';
import { RoutineBreak } from '../entities/routine-break.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import {
  loadSuggestionApplicationHistory,
  loadSuggestionInstanceHistory,
  loadSuggestionJournalHistory,
  loadSuggestionRoutineBreakHistory,
} from './suggestion-generation-history-loader';

describe('suggestion generation history loaders', () => {
  it('keeps dense 30-day application history reads indexed and avoids older backfill queries', async () => {
    const repo = mockRepo<ApplicationLog>(
      applicationLogs('window', 10_000, '2026-05-04'),
    );
    const startedAt = Date.now();

    const result = await loadSuggestionApplicationHistory(
      repo,
      'user-1',
      '2026-05-04',
    );

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(result.rows).toHaveLength(10_000);
    expect(result.windowRowCount).toBe(10_000);
    expect(result.backfillRowCount).toBe(0);
    expect(repo.find).toHaveBeenCalledTimes(1);
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: 'user-1',
          target_date: expect.objectContaining({ _type: 'between' }),
        }),
        order: { target_date: 'DESC', created_at: 'DESC' },
        relations: ['items', 'items.product', 'items.substituted_with_product'],
      }),
    );
  });

  it('backfills only the missing count when large older histories exist', async () => {
    const repo = mockRepo<ApplicationLog>(
      applicationLogs('window', 29, '2026-05-04'),
      applicationLogs('older', 10_000, '2026-03-01'),
    );

    const result = await loadSuggestionApplicationHistory(
      repo,
      'user-1',
      '2026-05-04',
    );

    expect(result.rows).toHaveLength(30);
    expect(result.windowRowCount).toBe(29);
    expect(result.backfillRowCount).toBe(1);
    expect(repo.find).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        take: 1,
        where: expect.objectContaining({
          user_id: 'user-1',
          target_date: expect.objectContaining({ _type: 'lessThan' }),
        }),
      }),
    );
  });

  it('uses indexed user/date predicates for dense journal history', async () => {
    const repo = mockRepo<SkinJournalEntry>(
      journalEntries('window', 1_000, '2026-05-04'),
    );

    const result = await loadSuggestionJournalHistory(
      repo,
      'user-1',
      '2026-05-04',
    );

    expectIndexedWindowQuery(repo, 'entry_date');
    expect(result.rows).toHaveLength(1_000);
  });

  it('uses indexed user/date predicates for dense suggestion history', async () => {
    const repo = mockRepo<SuggestionInstance>(
      suggestions('window', 1_000, '2026-05-04'),
    );

    const result = await loadSuggestionInstanceHistory(
      repo,
      'user-1',
      '2026-05-04',
    );

    expectIndexedWindowQuery(repo, 'target_date');
    expect(result.rows).toHaveLength(1_000);
  });

  it('uses indexed user/date predicates for dense routine break history', async () => {
    const repo = mockRepo<RoutineBreak>(
      routineBreaks('window', 1_000, '2026-05-04'),
    );

    const result = await loadSuggestionRoutineBreakHistory(
      repo,
      'user-1',
      '2026-05-04',
    );

    expectIndexedRoutineBreakWindowQuery(repo);
    expect(result.rows).toHaveLength(1_000);
  });

  it('includes routine breaks that overlap the 30-day window after starting earlier', async () => {
    const overlappingBreak = {
      id: 'overlapping-break',
      user_id: 'user-1',
      starts_at: new Date('2026-04-01T04:00:00.000Z'),
      ends_at: new Date('2026-04-20T04:00:00.000Z'),
      resumed_at: null,
    } as RoutineBreak;
    const repo = mockRepo<RoutineBreak>([overlappingBreak], []);

    const result = await loadSuggestionRoutineBreakHistory(
      repo,
      'user-1',
      '2026-05-04',
    );

    expectIndexedRoutineBreakWindowQuery(repo);
    expect(result.rows).toEqual([overlappingBreak]);
    expect(repo.find).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          id: expect.objectContaining({ _type: 'not' }),
        }),
      }),
    );
  });
});

function mockRepo<T extends ObjectLiteral>(
  firstRows: T[],
  secondRows: T[] = [],
): jest.Mocked<Repository<T>> {
  let calls = 0;
  return {
    find: jest.fn<Promise<T[]>, [Parameters<Repository<T>['find']>[0]?]>(
      async (options) => {
        calls += 1;
        const rows = calls === 1 ? firstRows : secondRows;
        const take =
          typeof options?.take === 'number' ? options.take : rows.length;
        return rows.slice(0, take);
      },
    ),
  } as unknown as jest.Mocked<Repository<T>>;
}

function expectIndexedWindowQuery<T extends ObjectLiteral>(
  repo: jest.Mocked<Repository<T>>,
  indexedDateField: string,
): void {
  const firstQuery = repo.find.mock.calls[0]?.[0];
  const where = firstQuery?.where as Record<string, unknown> | undefined;
  expect(repo.find).toHaveBeenCalledTimes(1);
  expect(where).toEqual(
    expect.objectContaining({
      user_id: 'user-1',
      [indexedDateField]: expect.objectContaining({ _type: 'between' }),
    }),
  );
}

function expectIndexedRoutineBreakWindowQuery(
  repo: jest.Mocked<Repository<RoutineBreak>>,
): void {
  const firstQuery = repo.find.mock.calls[0]?.[0];
  const where = firstQuery?.where;
  expect(where).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        user_id: 'user-1',
        starts_at: expect.objectContaining({ _type: 'between' }),
      }),
      expect.objectContaining({
        user_id: 'user-1',
        starts_at: expect.objectContaining({ _type: 'lessThan' }),
        ends_at: expect.objectContaining({ _type: 'moreThanOrEqual' }),
      }),
      expect.objectContaining({
        user_id: 'user-1',
        starts_at: expect.objectContaining({ _type: 'lessThan' }),
        resumed_at: expect.objectContaining({ _type: 'moreThanOrEqual' }),
      }),
      expect.objectContaining({
        user_id: 'user-1',
        starts_at: expect.objectContaining({ _type: 'lessThan' }),
        ends_at: expect.objectContaining({ _type: 'isNull' }),
      }),
    ]),
  );
}

function applicationLogs(
  prefix: string,
  count: number,
  baseDate: string,
): ApplicationLog[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-application-${index}`,
    user_id: 'user-1',
    target_date: shiftIsoDate(baseDate, -index),
    created_at: new Date(`${baseDate}T07:00:00.000Z`),
    items: [],
  })) as unknown as ApplicationLog[];
}

function journalEntries(
  prefix: string,
  count: number,
  baseDate: string,
): SkinJournalEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-journal-${index}`,
    user_id: 'user-1',
    entry_date: shiftIsoDate(baseDate, -index),
    updated_at: new Date(`${baseDate}T07:00:00.000Z`),
  })) as unknown as SkinJournalEntry[];
}

function suggestions(
  prefix: string,
  count: number,
  baseDate: string,
): SuggestionInstance[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-suggestion-${index}`,
    user_id: 'user-1',
    target_date: shiftIsoDate(baseDate, -index),
    target_time: '08:00',
    created_at: new Date(`${baseDate}T07:00:00.000Z`),
    steps: [],
  })) as unknown as SuggestionInstance[];
}

function routineBreaks(
  prefix: string,
  count: number,
  baseDate: string,
): RoutineBreak[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-break-${index}`,
    user_id: 'user-1',
    starts_at: new Date(`${shiftIsoDate(baseDate, -index)}T04:00:00.000Z`),
  })) as RoutineBreak[];
}

function shiftIsoDate(date: string, days: number): string {
  const current = new Date(`${date}T00:00:00.000Z`);
  current.setUTCDate(current.getUTCDate() + days);
  return current.toISOString().slice(0, 10);
}

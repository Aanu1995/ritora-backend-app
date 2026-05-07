import { ObjectLiteral, Repository } from 'typeorm';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { decodeCursor } from '../../common/utils/cursor-pagination';
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { SkinJournalEntry } from '../../skin-journal/entities/skin-journal-entry.entity';
import { User } from '../../users/entities/user.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { SUGGESTION_HISTORY_EXPORT_MAX_ROWS } from '../suggestions.constants';
import { SuggestionHistoryExportService } from './suggestion-history-export.service';
import { SuggestionHistoryReader } from './suggestion-history-reader.service';

describe('SuggestionHistoryReader', () => {
  const suggestionRepo = repo<SuggestionInstance>();
  const slotRepo = repo<ScheduleSlot>();
  const applicationLogRepo = repo<ApplicationLog>();
  const journalEntryRepo = repo<SkinJournalEntry>();
  const historyQueryBuilder = queryBuilder();
  const reader = new SuggestionHistoryReader(
    suggestionRepo,
    slotRepo,
    applicationLogRepo,
    journalEntryRepo,
  );
  const exporter = new SuggestionHistoryExportService(
    suggestionRepo,
    slotRepo,
    applicationLogRepo,
    journalEntryRepo,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    suggestionRepo.createQueryBuilder.mockReturnValue(
      historyQueryBuilder as never,
    );
    historyQueryBuilder.getRawMany.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not include scheduled slots when no suggestion was provided', async () => {
    suggestionRepo.find.mockResolvedValue([]);

    const day = await reader.getHistoryDay(
      { id: 'user-1', time_zone: 'UTC' } as User,
      null,
      '2026-04-29',
    );

    expect(day.slots).toEqual([]);
    expect(suggestionRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ generation_status: 'ready' }),
      }),
    );
    expect(slotRepo.find).not.toHaveBeenCalled();
  });

  it('requests only ready suggestions for history list so failed jobs stay hidden', async () => {
    await reader.getHistory({ id: 'user-1', time_zone: 'UTC' } as User, null, {
      range: '7d',
    });

    expect(historyQueryBuilder.andWhere).toHaveBeenCalledWith(
      'suggestion.generation_status = :status',
      { status: 'ready' },
    );
    expect(slotRepo.find).not.toHaveBeenCalled();
  });

  it('applies history filters and returns an opaque next cursor from the backend page', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-04T10:00:00.000Z'));
    historyQueryBuilder.getRawMany.mockResolvedValue([
      {
        suggestion_id: 'suggestion-2',
        target_date: '2026-05-03',
        target_time: '20:00',
      },
      {
        suggestion_id: 'suggestion-1',
        target_date: '2026-05-02',
        target_time: '08:00',
      },
    ]);
    suggestionRepo.find.mockResolvedValue([
      historySuggestion({
        id: 'suggestion-2',
        targetDate: '2026-05-03',
        targetTime: '20:00',
        daypart: 'evening',
        mode: 'manual',
      }),
    ]);
    applicationLogRepo.find.mockResolvedValue([
      {
        id: 'log-1',
        suggestion_instance_id: 'suggestion-2',
        has_been_edited: true,
        items: [{ status: 'applied' }],
      } as unknown as ApplicationLog,
    ]);
    slotRepo.findBy.mockResolvedValue([]);
    journalEntryRepo.find.mockResolvedValue([
      {
        id: 'journal-1',
        entry_date: '2026-05-03',
        photo_object_key: 'skin-journal/user-1/journal-1/photo.webp',
        overall_feel: 'good',
        has_reaction_signal: true,
        analysis_observations: {
          overall_change_from_previous: 'improved',
        },
      } as SkinJournalEntry,
    ]);

    const result = await reader.getHistory(
      { id: 'user-1', time_zone: 'UTC' } as User,
      null,
      {
        range: '30d',
        daypart: 'evening',
        mode: 'manual',
        requestSource: 'on_demand',
        status: 'applied',
        edited: true,
        limit: 1,
      },
    );

    expect(historyQueryBuilder.andWhere).toHaveBeenCalledWith(
      'suggestion.daypart = :daypart',
      { daypart: 'evening' },
    );
    expect(historyQueryBuilder.andWhere).toHaveBeenCalledWith(
      'suggestion.mode = :mode',
      { mode: 'manual' },
    );
    expect(historyQueryBuilder.andWhere).toHaveBeenCalledWith(
      'suggestion.request_source = :requestSource',
      { requestSource: 'on_demand' },
    );
    expect(historyQueryBuilder.limit).toHaveBeenCalledWith(2);
    expect(result.days).toHaveLength(1);
    expect(result.totalEdited).toBe(1);
    expect(result.days[0]).toEqual(
      expect.objectContaining({
        photoEntryId: 'journal-1',
        moodScore: 4,
        hydrationTrend: 'up',
        reactionFlagged: true,
      }),
    );
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(decodeCursor(result.nextCursor as string).tuple).toEqual([
      '2026-05-03',
      '20:00',
      'suggestion-2',
    ]);
  });

  it('filters partial history with completed substitution items instead of treating substitutions as skipped', async () => {
    await reader.getHistory({ id: 'user-1', time_zone: 'UTC' } as User, null, {
      range: '7d',
      status: 'partial',
    });

    expect(
      historyQueryBuilder.andWhere.mock.calls
        .map(([condition]) => String(condition))
        .find((condition) => condition.includes("item.status != 'skipped'")),
    ).toEqual(expect.stringContaining("item.status != 'skipped'"));
  });

  it('keeps today out of history day detail', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-29T10:00:00.000Z'));

    const day = await reader.getHistoryDay(
      { id: 'user-1', time_zone: 'UTC' } as User,
      null,
      '2026-04-29',
    );

    expect(day.slots).toEqual([]);
    expect(suggestionRepo.find).not.toHaveBeenCalled();
  });

  it('returns provided suggestions with full detail for history day comparison', async () => {
    suggestionRepo.find.mockResolvedValue([
      {
        id: 'suggestion-1',
        user_id: 'user-1',
        slot_id: 'slot-1',
        request_source: 'scheduled',
        request_context: null,
        target_date: '2026-04-29',
        target_time: '08:00',
        daypart: 'morning',
        mode: 'ai',
        generation_status: 'ready',
        visible_at: new Date('2026-04-29T06:00:00.000Z'),
        generated_at: new Date('2026-04-29T06:01:00.000Z'),
        ai_model: 'gpt-4.1-mini',
        ai_prompt_version: '2026-05-06.v1',
        simplified_for_reaction: false,
        has_reaction_signal: false,
        steps: [],
        gap_recommendations: [],
        safety_flags: [],
        generation_context: null,
        ai_explanation: null,
        created_at: new Date('2026-04-29T06:00:00.000Z'),
        updated_at: new Date('2026-04-29T06:01:00.000Z'),
      } as unknown as SuggestionInstance,
    ]);
    applicationLogRepo.find.mockResolvedValue([]);
    slotRepo.findBy.mockResolvedValue([
      {
        id: 'slot-1',
        slot_time: '08:00',
      } as ScheduleSlot,
    ]);
    journalEntryRepo.find.mockResolvedValue([
      {
        id: 'journal-1',
        entry_date: '2026-04-29',
        photo_object_key: 'skin-journal/user-1/journal-1/photo.webp',
        overall_feel: 'ok',
        has_reaction_signal: false,
        analysis_observations: {
          overall_change_from_previous: 'worsened',
        },
      } as SkinJournalEntry,
    ]);

    const day = await reader.getHistoryDay(
      { id: 'user-1', time_zone: 'UTC' } as User,
      null,
      '2026-04-29',
    );

    expect(day.slots[0]).toEqual(
      expect.objectContaining({
        suggestionId: 'suggestion-1',
        status: 'missed',
        suggestion: expect.objectContaining({
          id: 'suggestion-1',
          aiModel: 'gpt-4.1-mini',
        }),
      }),
    );
    expect(day).toEqual(
      expect.objectContaining({
        photoEntryId: 'journal-1',
        moodScore: 3,
        hydrationTrend: 'down',
      }),
    );
  });

  it('exports every matching history row while ignoring frontend pagination', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-04T10:00:00.000Z'));
    historyQueryBuilder.getRawMany.mockResolvedValue([
      {
        suggestion_id: 'suggestion-2',
        target_date: '2026-05-03',
        target_time: '20:00',
      },
      {
        suggestion_id: 'suggestion-1',
        target_date: '2026-05-02',
        target_time: '08:00',
      },
    ]);
    suggestionRepo.find.mockResolvedValue([
      historySuggestion({
        id: 'suggestion-2',
        targetDate: '2026-05-03',
        targetTime: '20:00',
        daypart: 'evening',
        mode: 'manual',
      }),
      historySuggestion({
        id: 'suggestion-1',
        targetDate: '2026-05-02',
        targetTime: '08:00',
        daypart: 'evening',
        mode: 'mixed',
      }),
    ]);
    applicationLogRepo.find.mockResolvedValue([
      {
        id: 'log-1',
        suggestion_instance_id: 'suggestion-2',
        applied_at: new Date('2026-05-03T20:05:00.000Z'),
        has_been_edited: true,
        general_notes: 'Handled gently.',
        items: [
          {
            step_order: 0,
            status: 'substituted',
            product_brand_snapshot: 'Ava Lab',
            product_name_snapshot: 'Original serum',
            substitution_reason: 'Finished original.',
            applied_at: new Date('2026-05-03T20:06:00.000Z'),
          },
        ],
      } as unknown as ApplicationLog,
    ]);
    slotRepo.findBy.mockResolvedValue([]);
    journalEntryRepo.find.mockResolvedValue([
      {
        id: 'journal-1',
        entry_date: '2026-05-03',
        photo_object_key: 'skin-journal/user-1/journal-1/photo.webp',
        overall_feel: 'good',
        has_reaction_signal: false,
        analysis_observations: null,
      } as SkinJournalEntry,
    ]);

    const file = await exporter.exportCsv(
      { id: 'user-1', time_zone: 'UTC' } as User,
      null,
      {
        range: '30d',
        daypart: 'evening',
        cursor: 'this-cursor-is-from-the-visible-page',
        limit: 1,
      },
    );

    expect(historyQueryBuilder.limit).toHaveBeenCalledWith(
      SUGGESTION_HISTORY_EXPORT_MAX_ROWS + 1,
    );
    expect(file.fileName).toBe('ritora-history-2026-04-04-to-2026-05-03.csv');
    expect(file.body).toContain('suggestion-2');
    expect(file.body).toContain('suggestion-1');
    expect(file.body).toContain('journal-1');
    expect(file.body).toContain('Finished original.');
    expect(file.body).not.toContain('this-cursor-is-from-the-visible-page');
  });
});

function repo<T extends ObjectLiteral>() {
  return {
    createQueryBuilder: jest.fn(),
    find: jest.fn(),
    findBy: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function queryBuilder() {
  return {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    getRawMany: jest.fn(),
  };
}

function historySuggestion(input: {
  id: string;
  targetDate: string;
  targetTime: string;
  daypart: 'morning' | 'noon' | 'evening';
  mode: 'ai' | 'manual' | 'mixed';
}): SuggestionInstance {
  return {
    id: input.id,
    user_id: 'user-1',
    slot_id: 'slot-1',
    request_source: 'scheduled',
    request_context: null,
    target_date: input.targetDate,
    target_time: input.targetTime,
    daypart: input.daypart,
    mode: input.mode,
    generation_status: 'ready',
    visible_at: new Date(`${input.targetDate}T06:00:00.000Z`),
    generated_at: new Date(`${input.targetDate}T06:01:00.000Z`),
    ai_model: 'gpt-test',
    ai_prompt_version: 'prompt-v1',
    simplified_for_reaction: false,
    has_reaction_signal: false,
    steps: [{ id: 'step-1' }],
    gap_recommendations: [],
    safety_flags: [],
    generation_context: null,
    ai_explanation: null,
    created_at: new Date(`${input.targetDate}T06:00:00.000Z`),
    updated_at: new Date(`${input.targetDate}T06:01:00.000Z`),
  } as unknown as SuggestionInstance;
}

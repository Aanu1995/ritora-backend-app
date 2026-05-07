import { ConflictException, HttpException } from '@nestjs/common';
import { ObjectLiteral, Repository } from 'typeorm';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { UserNotificationPreference } from '../../notifications/entities/user-notification-preference.entity';
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { User } from '../../users/entities/user.entity';
import { SuggestionGenerationJob } from '../entities/suggestion-generation-job.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { SuggestionStep } from '../entities/suggestion-step.entity';
import { SuggestionAiUsageGuard } from './suggestion-ai-usage-guard.service';
import { SuggestionHistoryReader } from './suggestion-history-reader.service';
import { SuggestionObservabilityService } from './suggestion-observability.service';
import { SuggestionsService } from './suggestions.service';
import { TodaysSuggestionReactionService } from './todays-suggestion-reaction.service';
import { SuggestionTodayActionService } from './suggestion-today-action.service';
import { RoutineBreakService } from './routine-break.service';

describe('SuggestionsService', () => {
  const suggestionRepo = repo<SuggestionInstance>();
  const jobRepo = repo<SuggestionGenerationJob>();
  const slotRepo = repo<ScheduleSlot>();
  const applicationLogRepo = repo<ApplicationLog>();
  const preferenceRepo = repo<UserNotificationPreference>();
  const historyReader = {
    getHistory: jest.fn(),
    getHistoryDay: jest.fn(),
  } as unknown as jest.Mocked<SuggestionHistoryReader>;
  const historyExporter = {
    exportCsv: jest.fn(),
  };
  const usageGuard = {
    evaluateRegeneration: jest.fn(),
  } as unknown as jest.Mocked<SuggestionAiUsageGuard>;
  const observability = {
    record: jest.fn(),
  } as unknown as jest.Mocked<SuggestionObservabilityService>;
  const reactionService = {
    getReactionAlert: jest.fn(),
  } as unknown as jest.Mocked<TodaysSuggestionReactionService>;
  const todayActionService = {
    getGapActionMaps: jest.fn(),
    getReminderSnoozeMap: jest.fn(),
  } as unknown as jest.Mocked<SuggestionTodayActionService>;
  const routineBreakService = {
    getBreakState: jest.fn(),
    isRoutineBreakActive: jest.fn(),
  } as unknown as jest.Mocked<RoutineBreakService>;

  const service = new SuggestionsService(
    suggestionRepo,
    jobRepo,
    slotRepo,
    applicationLogRepo,
    preferenceRepo,
    historyReader,
    historyExporter as never,
    usageGuard,
    observability,
    reactionService,
    todayActionService,
    routineBreakService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-29T10:00:00.000Z'));
    suggestionRepo.create.mockImplementation(
      (value) => value as SuggestionInstance,
    );
    suggestionRepo.save.mockImplementation(
      async (value) => value as SuggestionInstance,
    );
    jobRepo.findOne.mockResolvedValue(null);
    jobRepo.insert.mockResolvedValue({
      identifiers: [],
      generatedMaps: [],
      raw: [],
    });
    usageGuard.evaluateRegeneration.mockResolvedValue({
      allowed: true,
      blockedReason: null,
      generationCountToday: 0,
      regenerationCountToday: 0,
      estimatedCostTodayUsd: 0,
    });
    reactionService.getReactionAlert.mockResolvedValue(null);
    todayActionService.getGapActionMaps.mockResolvedValue(new Map());
    todayActionService.getReminderSnoozeMap.mockResolvedValue(new Map());
    routineBreakService.getBreakState.mockResolvedValue({
      routineBreak: null,
    });
    routineBreakService.isRoutineBreakActive.mockResolvedValue(false);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates a replacement pending suggestion with a concrete job id when regenerating', async () => {
    suggestionRepo.findOne.mockResolvedValue({
      id: 'suggestion-1',
      user_id: 'user-1',
      slot_id: 'slot-1',
      target_date: '2026-04-29',
      target_time: '12:00',
      daypart: 'noon',
      mode: 'ai',
      generation_status: 'ready',
      visible_at: new Date('2026-04-29T10:00:00.000Z'),
    } as SuggestionInstance);

    const result = await service.regenerateSuggestion(user(), 'suggestion-1', {
      reason: 'reaction_detected',
    });

    expect(suggestionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'suggestion-1',
        generation_status: 'superseded',
      }),
    );
    expect(suggestionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        slot_id: 'slot-1',
        target_date: '2026-04-29',
        target_time: '12:00',
        daypart: 'noon',
        generation_status: 'pending',
        visible_at: new Date('2026-04-29T10:00:00.000Z'),
        supersedes_id: 'suggestion-1',
      }),
    );
    expect(jobRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
        user_id: 'user-1',
        slot_id: 'slot-1',
        target_date: '2026-04-29',
        run_after: new Date('2026-04-29T10:00:00.000Z'),
        last_error: 'regenerate:reaction_detected',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        slotId: 'slot-1',
        generationStatus: 'pending',
      }),
    );
  });

  it('rejects regeneration when the suggestion no longer belongs to a schedule slot', async () => {
    suggestionRepo.findOne.mockResolvedValue({
      id: 'suggestion-1',
      user_id: 'user-1',
      slot_id: null,
      target_date: '2026-04-29',
      target_time: '12:00',
      daypart: 'noon',
      mode: 'ai',
      generation_status: 'ready',
      visible_at: new Date('2026-04-29T10:00:00.000Z'),
    } as SuggestionInstance);

    await expect(
      service.regenerateSuggestion(user(), 'suggestion-1', {}),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(jobRepo.insert).not.toHaveBeenCalled();
  });

  it('rate limits manual regeneration before superseding the current suggestion', async () => {
    usageGuard.evaluateRegeneration.mockResolvedValue({
      allowed: false,
      blockedReason: 'daily_regeneration_limit',
      generationCountToday: 5,
      regenerationCountToday: 4,
      estimatedCostTodayUsd: 0.12,
    });
    suggestionRepo.findOne.mockResolvedValue({
      id: 'suggestion-1',
      user_id: 'user-1',
      slot_id: 'slot-1',
      target_date: '2026-04-29',
      target_time: '12:00',
      daypart: 'noon',
      mode: 'ai',
      generation_status: 'ready',
      visible_at: new Date('2026-04-29T10:00:00.000Z'),
    } as SuggestionInstance);

    await expect(
      service.regenerateSuggestion(user(), 'suggestion-1', {}),
    ).rejects.toBeInstanceOf(HttpException);

    expect(suggestionRepo.save).not.toHaveBeenCalled();
    expect(jobRepo.insert).not.toHaveBeenCalled();
    expect(observability.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'ai_budget_blocked',
        severity: 'warning',
      }),
    );
  });

  it('builds today slots from schedule, visible suggestions, recording status, and lead time', async () => {
    preferenceRepo.findOne.mockResolvedValue({
      suggestion_lead_time_minutes: 120,
    } as UserNotificationPreference);
    slotRepo.find.mockResolvedValue([
      scheduleSlot({
        id: 'slot-ready',
        slotTime: '12:00',
        mode: 'ai',
        lockedSteps: 0,
      }),
      scheduleSlot({
        id: 'slot-locked',
        slotTime: '18:00',
        mode: 'manual',
        lockedSteps: 1,
      }),
    ]);
    suggestionRepo.find.mockResolvedValue([
      suggestionInstance({
        id: 'suggestion-ready',
        slotId: 'slot-ready',
        targetTime: '12:00',
        generatedAt: new Date('2026-04-29T09:55:00.000Z'),
      }),
    ]);
    applicationLogRepo.find.mockResolvedValue([
      applicationLog({
        id: 'log-1',
        suggestionId: 'suggestion-ready',
        hasBeenEdited: true,
      }),
    ]);

    const result = await service.getTodaysSuggestion(user(), null);

    expect(slotRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: 'user-1', day_of_week: 'wed' },
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        date: '2026-04-29',
        timeZone: 'UTC',
        leadTimeMinutes: 120,
      }),
    );
    expect(result.summary).toEqual(
      expect.objectContaining({
        total: 2,
        locked: 1,
        recorded: 1,
        edited: 1,
      }),
    );
    expect(result.slots[0]).toEqual(
      expect.objectContaining({
        slotId: 'slot-ready',
        status: 'edited',
        recording: expect.objectContaining({
          applicationLogId: 'log-1',
          hasBeenEdited: true,
        }),
        applicationLog: expect.objectContaining({
          id: 'log-1',
          items: expect.arrayContaining([
            expect.objectContaining({ id: 'item-1' }),
          ]),
        }),
        suggestion: expect.objectContaining({
          id: 'suggestion-ready',
          aiModel: 'gpt-test',
        }),
      }),
    );
    expect(result.slots[1]).toEqual(
      expect.objectContaining({
        slotId: 'slot-locked',
        isVisible: false,
        status: 'locked',
        specialist: expect.objectContaining({
          lockedStepCount: 1,
        }),
        suggestion: null,
      }),
    );
    expect(reactionService.getReactionAlert).toHaveBeenCalledWith(
      'user-1',
      '2026-04-29',
      [],
    );
  });

  it('returns the active routine break and hides unprovided paused slots from Today', async () => {
    routineBreakService.getBreakState.mockResolvedValue({
      routineBreak: {
        id: 'break-1',
        status: 'active',
        startedAt: '2026-04-29T09:00:00.000Z',
        endsAt: '2026-04-30T08:00:00.000Z',
        canResumeNow: true,
        message:
          'Your routine is paused. Ritora will not generate new skincare suggestions until you resume.',
      },
    });
    slotRepo.find.mockResolvedValue([
      scheduleSlot({
        id: 'slot-ready',
        slotTime: '08:00',
        mode: 'ai',
        lockedSteps: 0,
      }),
      scheduleSlot({
        id: 'slot-paused',
        slotTime: '18:00',
        mode: 'ai',
        lockedSteps: 0,
      }),
    ]);
    suggestionRepo.find.mockResolvedValue([
      suggestionInstance({
        id: 'suggestion-ready',
        slotId: 'slot-ready',
        targetTime: '08:00',
        generatedAt: new Date('2026-04-29T06:00:00.000Z'),
      }),
    ]);
    applicationLogRepo.find.mockResolvedValue([]);

    const result = await service.getTodaysSuggestion(user(), null);

    expect(result.routineBreak).toEqual(
      expect.objectContaining({
        id: 'break-1',
        status: 'active',
        canResumeNow: true,
      }),
    );
    expect(result.slots).toHaveLength(1);
    expect(result.slots[0]).toEqual(
      expect.objectContaining({
        slotId: 'slot-ready',
        suggestion: expect.objectContaining({ id: 'suggestion-ready' }),
      }),
    );
  });

  it('returns same-day on-demand suggestions separately from scheduled slots', async () => {
    slotRepo.find.mockResolvedValue([]);
    suggestionRepo.find.mockResolvedValue([
      onDemandSuggestionInstance({
        id: 'suggestion-on-demand-1',
        targetTime: '12:15',
        generationStatus: 'generating',
      }),
      onDemandSuggestionInstance({
        id: 'suggestion-on-demand-ready',
        targetTime: '12:30',
        generationStatus: 'ready',
      }),
    ]);
    applicationLogRepo.find.mockResolvedValue([
      applicationLog({
        id: 'log-on-demand',
        suggestionId: 'suggestion-on-demand-ready',
        hasBeenEdited: false,
      }),
    ]);

    const result = await service.getTodaysSuggestion(user(), null);

    expect(result.slots).toEqual([]);
    expect(result.summary).toEqual(
      expect.objectContaining({
        onDemand: 2,
        recorded: 1,
      }),
    );
    expect(result.onDemandSuggestions).toEqual([
      expect.objectContaining({
        id: 'suggestion-on-demand-1',
        status: 'generating',
        suggestion: expect.objectContaining({
          requestSource: 'on_demand',
          requestContext: expect.objectContaining({
            intent: 'post_workout',
          }),
        }),
      }),
      expect.objectContaining({
        id: 'suggestion-on-demand-ready',
        status: 'recorded',
        applicationLog: expect.objectContaining({
          id: 'log-on-demand',
        }),
      }),
    ]);
  });

  it('blocks manual regeneration while the user is on a routine break', async () => {
    routineBreakService.isRoutineBreakActive.mockResolvedValue(true);
    suggestionRepo.findOne.mockResolvedValue({
      id: 'suggestion-1',
      user_id: 'user-1',
      slot_id: 'slot-1',
      target_date: '2026-04-29',
      target_time: '12:00',
      daypart: 'noon',
      mode: 'ai',
      generation_status: 'ready',
      visible_at: new Date('2026-04-29T10:00:00.000Z'),
    } as SuggestionInstance);

    await expect(
      service.regenerateSuggestion(user(), 'suggestion-1', {}),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(usageGuard.evaluateRegeneration).not.toHaveBeenCalled();
    expect(suggestionRepo.save).not.toHaveBeenCalled();
    expect(jobRepo.insert).not.toHaveBeenCalled();
  });

  it('returns one suggestion with application link and delegates history reads', async () => {
    const suggestion = suggestionInstance({
      id: 'suggestion-1',
      slotId: 'slot-1',
      targetTime: '08:00',
    });
    suggestionRepo.findOne.mockResolvedValue(suggestion);
    applicationLogRepo.findOne.mockResolvedValue(
      applicationLog({
        id: 'log-1',
        suggestionId: 'suggestion-1',
        hasBeenEdited: false,
      }),
    );
    historyReader.getHistory.mockResolvedValue({
      days: [],
      nextCursor: null,
      totalApplied: 0,
      totalSlots: 0,
      totalEdited: 0,
      adherencePercent: null,
    });
    historyReader.getHistoryDay.mockResolvedValue({
      date: '2026-04-28',
      weatherSummary: null,
      moodScore: null,
      hydrationTrend: null,
      reactionFlagged: false,
      photoEntryId: null,
      slots: [],
    });

    await expect(
      service.getSuggestion(user(), 'suggestion-1'),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'suggestion-1',
        applicationLogId: 'log-1',
      }),
    );
    await service.getHistory(user(), null, {});
    await service.getHistoryDay(user(), null, '2026-04-28');
    historyExporter.exportCsv.mockResolvedValue({
      fileName: 'ritora-history.csv',
      contentType: 'text/csv; charset=utf-8',
      body: 'Date\n',
    });
    await service.exportHistoryCsv(user(), null, { mode: 'mixed' });

    expect(historyReader.getHistory).toHaveBeenCalledWith(user(), null, {});
    expect(historyReader.getHistoryDay).toHaveBeenCalledWith(
      user(),
      null,
      '2026-04-28',
    );
    expect(historyExporter.exportCsv).toHaveBeenCalledWith(user(), null, {
      mode: 'mixed',
    });
  });
});

function repo<T extends ObjectLiteral>() {
  return {
    create: jest.fn((value) => value),
    find: jest.fn(),
    findOne: jest.fn(),
    insert: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function user(): User {
  return {
    id: 'user-1',
    time_zone: 'UTC',
  } as User;
}

function scheduleSlot(input: {
  id: string;
  slotTime: string;
  mode: 'manual' | 'ai';
  lockedSteps: number;
}): ScheduleSlot {
  const now = new Date('2026-04-29T08:00:00.000Z');
  return {
    id: input.id,
    user_id: 'user-1',
    day_of_week: 'wed',
    slot_time: input.slotTime,
    mode: input.mode,
    slot_notes: null,
    created_at: now,
    updated_at: now,
    steps: Array.from({ length: input.lockedSteps }, (_, index) => ({
      id: `${input.id}-step-${index}`,
      is_specialist_locked: true,
      step_order: index,
    })),
  } as unknown as ScheduleSlot;
}

function suggestionInstance(input: {
  id: string;
  slotId: string;
  targetTime: string;
  generatedAt?: Date | null;
}): SuggestionInstance {
  const now = new Date('2026-04-29T09:55:00.000Z');
  return {
    id: input.id,
    user_id: 'user-1',
    slot_id: input.slotId,
    request_source: 'scheduled',
    request_context: null,
    target_date: '2026-04-29',
    target_time: input.targetTime,
    daypart: input.targetTime < '12:00' ? 'morning' : 'noon',
    mode: 'ai',
    generation_status: 'ready',
    visible_at: new Date('2026-04-29T10:00:00.000Z'),
    generated_at: input.generatedAt ?? now,
    ai_model: 'gpt-test',
    ai_prompt_version: 'prompt-v1',
    ai_input_tokens: 10,
    ai_output_tokens: 20,
    ai_total_tokens: 30,
    ai_estimated_cost_usd: 0.0001,
    ai_duration_ms: 123,
    ai_explanation: {
      headline: 'Keep it steady',
      body: [],
      perStepReasons: [],
      skipped: [],
      inputs: [],
    },
    generation_context: null,
    gap_recommendations: [],
    safety_flags: [],
    has_reaction_signal: false,
    simplified_for_reaction: false,
    supersedes_id: null,
    ai_error: null,
    ai_retry_count: 0,
    created_at: now,
    updated_at: now,
    steps: [suggestionStep()],
  } as unknown as SuggestionInstance;
}

function onDemandSuggestionInstance(input: {
  id: string;
  targetTime: string;
  generationStatus: 'generating' | 'ready' | 'failed';
}): SuggestionInstance {
  const requestedAt = new Date('2026-04-29T10:15:00.000Z');
  return {
    ...suggestionInstance({
      id: input.id,
      slotId: 'slot-unused',
      targetTime: input.targetTime,
      generatedAt:
        input.generationStatus === 'ready'
          ? new Date('2026-04-29T10:16:00.000Z')
          : null,
    }),
    slot_id: null,
    request_source: 'on_demand',
    request_context: {
      intent: 'post_workout',
      intensity: 'minimal',
      note: 'Back from training.',
      activityAt: null,
      requestedAt: requestedAt.toISOString(),
    },
    generation_status: input.generationStatus,
    visible_at: requestedAt,
    created_at: requestedAt,
    updated_at: requestedAt,
  } as unknown as SuggestionInstance;
}

function suggestionStep(): SuggestionStep {
  return {
    id: 'suggestion-step-1',
    suggestion_instance_id: 'suggestion-1',
    step_order: 0,
    routine_step_id: null,
    inventory_product_id: null,
    product_brand_snapshot: 'Ava Lab',
    product_name_snapshot: 'Barrier Serum',
    step_label: 'serum',
    custom_label: null,
    application_method: null,
    quantity: null,
    wait_after_minutes: null,
    explanation: 'Support the barrier.',
    provenance: 'ai_added',
    chips: [],
    safety_warnings: [],
    created_at: new Date('2026-04-29T09:55:00.000Z'),
    product: null,
  } as unknown as SuggestionStep;
}

function applicationLog(input: {
  id: string;
  suggestionId: string;
  hasBeenEdited: boolean;
}): ApplicationLog {
  const now = new Date('2026-04-29T12:10:00.000Z');
  return {
    id: input.id,
    user_id: 'user-1',
    suggestion_instance_id: input.suggestionId,
    slot_id: 'slot-ready',
    target_date: '2026-04-29',
    target_time: '12:00',
    daypart: 'noon',
    applied_at: now,
    general_notes: null,
    edit_reason: null,
    edit_count: input.hasBeenEdited ? 1 : 0,
    has_been_edited: input.hasBeenEdited,
    first_recorded_at: now,
    last_edited_at: input.hasBeenEdited ? now : null,
    created_at: now,
    updated_at: now,
    items: [
      {
        id: 'item-1',
        step_order: 0,
        status: 'applied',
      },
    ],
  } as unknown as ApplicationLog;
}

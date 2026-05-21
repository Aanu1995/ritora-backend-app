import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ObjectLiteral, Repository } from 'typeorm';
import { RoutineSimplificationEvent } from '../../skin-journal/entities/routine-simplification-event.entity';
import { SmartPickSnapshot } from '../../smart-picks/entities/smart-pick-snapshot.entity';
import { SmartPickProductSuggestion } from '../../smart-picks/entities/smart-pick-product-suggestion.entity';
import { SkinJournalEntry } from '../../skin-journal/entities/skin-journal-entry.entity';
import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import { User } from '../../users/entities/user.entity';
import { SuggestionGapAction } from '../entities/suggestion-gap-action.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { SuggestionRecordingReminderSnooze } from '../entities/suggestion-recording-reminder-snooze.entity';
import { SuggestionReactionOverride } from '../entities/suggestion-reaction-override.entity';
import { SuggestionObservabilityService } from './suggestion-observability.service';
import { SuggestionTodayActionService } from './suggestion-today-action.service';

describe('SuggestionTodayActionService', () => {
  const overrideRepo = repo<SuggestionReactionOverride>();
  const gapActionRepo = repo<SuggestionGapAction>();
  const reminderSnoozeRepo = repo<SuggestionRecordingReminderSnooze>();
  const suggestionRepo = repo<SuggestionInstance>();
  const productSuggestionRepo = repo<SmartPickProductSuggestion>();
  const smartPickSnapshotRepo = repo<SmartPickSnapshot>();
  const skinProfileRepo = repo<SkinProfile>();
  const entryRepo = repo<SkinJournalEntry>();
  const simplificationRepo = repo<RoutineSimplificationEvent>();
  const observability = {
    record: jest.fn(),
  } as unknown as jest.Mocked<SuggestionObservabilityService>;
  const service = new SuggestionTodayActionService(
    overrideRepo,
    gapActionRepo,
    reminderSnoozeRepo,
    suggestionRepo,
    productSuggestionRepo,
    smartPickSnapshotRepo,
    skinProfileRepo,
    entryRepo,
    simplificationRepo,
    observability,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-05-04T10:00:00.000Z'));
    overrideRepo.create.mockImplementation(
      (value) => value as SuggestionReactionOverride,
    );
    overrideRepo.save.mockImplementation(
      async (value) => value as SuggestionReactionOverride,
    );
    gapActionRepo.create.mockImplementation(
      (value) => value as SuggestionGapAction,
    );
    gapActionRepo.save.mockImplementation(
      async (value) => value as SuggestionGapAction,
    );
    reminderSnoozeRepo.create.mockImplementation(
      (value) => value as SuggestionRecordingReminderSnooze,
    );
    reminderSnoozeRepo.save.mockImplementation(
      async (value) => value as SuggestionRecordingReminderSnooze,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('persists a same-day normal routine override and ends active simplification', async () => {
    overrideRepo.findOne.mockResolvedValue(null);
    entryRepo.find.mockResolvedValue([reactionEntry()]);
    simplificationRepo.update.mockResolvedValue({
      affected: 1,
      generatedMaps: [],
      raw: [],
    });

    await expect(
      service.useNormalRoutineForToday(user(), 'Europe/Stockholm'),
    ).resolves.toEqual(
      expect.objectContaining({
        targetDate: '2026-05-04',
        reactionEntryId: 'entry-1',
      }),
    );

    expect(overrideRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        target_date: '2026-05-04',
        reaction_entry_id: 'entry-1',
        reason: 'normal_routine_requested',
      }),
    );
    expect(simplificationRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1' }),
      expect.objectContaining({
        ended_at: new Date('2026-05-04T10:00:00.000Z'),
        acknowledged_at: new Date('2026-05-04T10:00:00.000Z'),
      }),
    );
  });

  it('uses persisted override or regeneration marker to ignore reaction context', async () => {
    await expect(
      service.shouldIgnoreReactionContext(
        'user-1',
        '2026-05-04',
        'regenerate:normal_routine_requested',
      ),
    ).resolves.toBe(true);

    overrideRepo.findOne.mockResolvedValue({ id: 'override-1' } as never);
    await expect(
      service.shouldIgnoreReactionContext('user-1', '2026-05-04', null),
    ).resolves.toBe(true);
  });

  it('persists save and dismiss actions only for owned recommendation gaps', async () => {
    suggestionRepo.findOne.mockResolvedValue(suggestion());
    gapActionRepo.findOne.mockResolvedValue(null);

    await expect(
      service.recordGapAction(user(), {
        suggestionInstanceId: 'suggestion-1',
        ingredientOrCategory: 'Vitamin C Serum',
        action: 'saved',
      }),
    ).resolves.toEqual({
      sourceType: 'today',
      suggestionInstanceId: 'suggestion-1',
      smartPickProductSuggestionId: null,
      ingredientOrCategory: 'Vitamin C Serum',
      normalizedKey: 'vitamin-c-serum',
      action: 'saved',
    });

    expect(gapActionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        source_type: 'today',
        suggestion_instance_id: 'suggestion-1',
        smart_pick_product_suggestion_id: null,
        normalized_key: 'vitamin-c-serum',
        action: 'saved',
      }),
    );
  });

  it('persists smart pick actions only for owned product suggestions', async () => {
    skinProfileRepo.findOne.mockResolvedValue({
      allow_smart_picks: true,
    } as SkinProfile);
    smartPickSnapshotRepo.findOne.mockResolvedValue({
      inputs_hash: 'hash-1',
    } as SmartPickSnapshot);
    productSuggestionRepo.findOne.mockResolvedValue(
      smartPickProductSuggestion(),
    );
    gapActionRepo.findOne.mockResolvedValue(null);

    await expect(
      service.recordGapAction(user(), {
        sourceType: 'smart_pick',
        smartPickProductSuggestionId: 'pick-1',
        action: 'saved',
      }),
    ).resolves.toEqual({
      sourceType: 'smart_pick',
      suggestionInstanceId: null,
      smartPickProductSuggestionId: 'pick-1',
      ingredientOrCategory: 'Broad-spectrum sunscreen SPF 30+',
      normalizedKey: 'broad-spectrum-sunscreen-spf-30',
      action: 'saved',
    });

    expect(gapActionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        source_type: 'smart_pick',
        suggestion_instance_id: null,
        smart_pick_product_suggestion_id: 'pick-1',
        ingredient_or_category: 'Broad-spectrum sunscreen SPF 30+',
        normalized_key: 'broad-spectrum-sunscreen-spf-30',
        action: 'saved',
      }),
    );
    expect(smartPickSnapshotRepo.findOne).toHaveBeenCalledWith({
      where: { user_id: 'user-1', inputs_hash: 'hash-1' },
    });
    expect(observability.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'smart_pick_user_feedback',
        userId: 'user-1',
        metadata: expect.objectContaining({
          action: 'saved',
          normalizedKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          sellerNameCount: 0,
          sourceIdCount: 0,
        }),
      }),
    );
    expect(JSON.stringify(observability.record.mock.calls)).not.toContain(
      'broad-spectrum-sunscreen-spf-30',
    );
  });

  it('rejects smart pick actions when Smart Picks consent is off', async () => {
    skinProfileRepo.findOne.mockResolvedValue({
      allow_smart_picks: false,
    } as SkinProfile);

    await expect(
      service.recordGapAction(user(), {
        sourceType: 'smart_pick',
        smartPickProductSuggestionId: 'pick-1',
        action: 'saved',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(productSuggestionRepo.findOne).not.toHaveBeenCalled();
    expect(gapActionRepo.save).not.toHaveBeenCalled();
  });

  it('rejects smart pick actions for stale product suggestions', async () => {
    skinProfileRepo.findOne.mockResolvedValue({
      allow_smart_picks: true,
    } as SkinProfile);
    smartPickSnapshotRepo.findOne.mockResolvedValue(null);
    productSuggestionRepo.findOne.mockResolvedValue(
      smartPickProductSuggestion({ inputs_hash: 'old-hash' }),
    );

    await expect(
      service.recordGapAction(user(), {
        sourceType: 'smart_pick',
        smartPickProductSuggestionId: 'pick-1',
        action: 'saved',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(smartPickSnapshotRepo.findOne).toHaveBeenCalledWith({
      where: { user_id: 'user-1', inputs_hash: 'old-hash' },
    });
    expect(gapActionRepo.save).not.toHaveBeenCalled();
  });

  it('rejects spoofed gap actions', async () => {
    suggestionRepo.findOne.mockResolvedValueOnce({
      ...suggestion(),
      user_id: 'user-2',
    } as SuggestionInstance);
    await expect(
      service.recordGapAction(user(), {
        suggestionInstanceId: 'suggestion-1',
        ingredientOrCategory: 'Vitamin C Serum',
        action: 'saved',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    suggestionRepo.findOne.mockResolvedValueOnce(suggestion());
    await expect(
      service.recordGapAction(user(), {
        suggestionInstanceId: 'suggestion-1',
        ingredientOrCategory: 'Retinal serum',
        action: 'dismissed',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects smart pick actions for another user', async () => {
    skinProfileRepo.findOne.mockResolvedValue({
      allow_smart_picks: true,
    } as SkinProfile);
    smartPickSnapshotRepo.findOne.mockResolvedValue({
      inputs_hash: 'hash-1',
    } as SmartPickSnapshot);
    const spoofed = smartPickProductSuggestion();
    spoofed.user_id = 'user-2';
    productSuggestionRepo.findOne.mockResolvedValue(spoofed);

    await expect(
      service.recordGapAction(user(), {
        sourceType: 'smart_pick',
        smartPickProductSuggestionId: 'pick-1',
        action: 'saved',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('loads only today gap actions into today suggestion maps', async () => {
    gapActionRepo.find.mockResolvedValue([
      {
        suggestion_instance_id: 'suggestion-1',
        normalized_key: 'vitamin-c-serum',
        action: 'saved',
      } as SuggestionGapAction,
    ]);

    await expect(
      service.getGapActionMaps('user-1', ['suggestion-1']),
    ).resolves.toEqual(
      new Map([['suggestion-1', new Map([['vitamin-c-serum', 'saved']])]]),
    );
    expect(gapActionRepo.find).toHaveBeenCalledWith({
      where: expect.objectContaining({
        user_id: 'user-1',
        source_type: 'today',
      }),
    });
  });

  it('persists and returns active recording reminder snoozes', async () => {
    suggestionRepo.findOne.mockResolvedValue(suggestion());
    reminderSnoozeRepo.findOne.mockResolvedValue(null);

    await expect(
      service.snoozeRecordingReminder(user(), {
        suggestionInstanceId: 'suggestion-1',
        minutes: 30,
      }),
    ).resolves.toEqual({
      suggestionInstanceId: 'suggestion-1',
      snoozedUntil: '2026-05-04T10:30:00.000Z',
    });

    expect(reminderSnoozeRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        suggestion_instance_id: 'suggestion-1',
        snoozed_until: new Date('2026-05-04T10:30:00.000Z'),
      }),
    );

    reminderSnoozeRepo.find.mockResolvedValue([
      {
        suggestion_instance_id: 'suggestion-1',
        snoozed_until: new Date('2026-05-04T10:30:00.000Z'),
      },
    ] as SuggestionRecordingReminderSnooze[]);

    await expect(
      service.getReminderSnoozeMap('user-1', ['suggestion-1']),
    ).resolves.toEqual(
      new Map([['suggestion-1', new Date('2026-05-04T10:30:00.000Z')]]),
    );
  });
});

function repo<T extends ObjectLiteral>() {
  return {
    create: jest.fn((value) => value),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function user(): User {
  return { id: 'user-1', time_zone: 'Europe/Stockholm' } as User;
}

function reactionEntry(): SkinJournalEntry {
  return {
    id: 'entry-1',
    user_id: 'user-1',
    entry_date: '2026-05-04',
    has_reaction_signal: true,
    analysis_observations: null,
  } as unknown as SkinJournalEntry;
}

function suggestion(): SuggestionInstance {
  return {
    id: 'suggestion-1',
    user_id: 'user-1',
    gap_recommendations: [
      {
        ingredientOrCategory: 'Vitamin C serum',
        reason: 'Supports brightening goal.',
        budgetTier: 'mid',
        goalAlignment: 'Brightening',
        sourceIds: [],
      },
    ],
  } as unknown as SuggestionInstance;
}

function smartPickProductSuggestion(
  overrides: Partial<SmartPickProductSuggestion> = {},
): SmartPickProductSuggestion {
  return {
    id: 'pick-1',
    user_id: 'user-1',
    ingredient_or_category: 'Broad-spectrum sunscreen SPF 30+',
    normalized_key: 'broad-spectrum-sunscreen-spf-30',
    brand: 'La Roche-Posay',
    product_name: 'Anthelios Mineral SPF 50',
    budget_tier: 'mid',
    seller_names_json: [],
    reasoning_chips_json: [],
    reasoning_facts_json: {},
    ruled_out_json: [],
    alternatives_json: [],
    source_ids: [],
    recommendation_rank_reason: 'Best local SPF fit.',
    inputs_hash: 'hash-1',
    gap_reason: 'No SPF on shelf.',
    goal_alignment: 'sun protection',
    created_at: new Date('2026-05-04T10:00:00.000Z'),
    updated_at: new Date('2026-05-04T10:00:00.000Z'),
    user: undefined as never,
    generateId: jest.fn(),
    ...overrides,
  };
}

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, MoreThan, Repository } from 'typeorm';
import { toIsoString } from '../../common/utils/date';
import { resolveEffectiveTimeZone } from '../../common/timezone/timezone.utils';
import { RoutineSimplificationEvent } from '../../skin-journal/entities/routine-simplification-event.entity';
import { SkinJournalEntry } from '../../skin-journal/entities/skin-journal-entry.entity';
import { User } from '../../users/entities/user.entity';
import {
  NormalRoutineOverrideResponseDto,
  RecordingReminderSnoozeResponseDto,
  RecordSuggestionGapActionDto,
  SnoozeRecordingReminderDto,
  SuggestionGapActionResponseDto,
} from '../dto/suggestion-today-actions.dto';
import { SuggestionGapAction } from '../entities/suggestion-gap-action.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { SuggestionRecordingReminderSnooze } from '../entities/suggestion-recording-reminder-snooze.entity';
import { SuggestionReactionOverride } from '../entities/suggestion-reaction-override.entity';
import { SuggestionGapActionKind } from '../suggestions.constants';
import {
  endOfLocalDateInstant,
  formatDateInTimeZone,
} from './suggestion-helpers';
import { normalizeSuggestionGapKey } from './suggestion-gap-actions';

const REACTION_LOOKBACK_DAYS = 7;
const NORMAL_ROUTINE_REGENERATION_ERROR =
  'regenerate:normal_routine_requested';
const RECORDING_REMINDER_SNOOZE_DEFAULT_MINUTES = 60;

@Injectable()
export class SuggestionTodayActionService {
  constructor(
    @InjectRepository(SuggestionReactionOverride)
    private readonly overrideRepo: Repository<SuggestionReactionOverride>,
    @InjectRepository(SuggestionGapAction)
    private readonly gapActionRepo: Repository<SuggestionGapAction>,
    @InjectRepository(SuggestionRecordingReminderSnooze)
    private readonly reminderSnoozeRepo: Repository<SuggestionRecordingReminderSnooze>,
    @InjectRepository(SuggestionInstance)
    private readonly suggestionRepo: Repository<SuggestionInstance>,
    @InjectRepository(SkinJournalEntry)
    private readonly entryRepo: Repository<SkinJournalEntry>,
    @InjectRepository(RoutineSimplificationEvent)
    private readonly simplificationRepo: Repository<RoutineSimplificationEvent>,
  ) {}

  async useNormalRoutineForToday(
    user: User,
    requestTimeZone: string | null,
  ): Promise<NormalRoutineOverrideResponseDto> {
    const timeZone = resolveEffectiveTimeZone(user.time_zone, requestTimeZone);
    const now = new Date();
    const targetDate = formatDateInTimeZone(timeZone, now);
    const latestReaction = await this.findLatestReactionEntry(
      user.id,
      targetDate,
    );
    const expiresAt = endOfLocalDateInstant(targetDate, timeZone);
    const existing = await this.overrideRepo.findOne({
      where: { user_id: user.id, target_date: targetDate },
    });
    const override = this.overrideRepo.create({
      ...(existing ?? {}),
      user_id: user.id,
      target_date: targetDate,
      reaction_entry_id: latestReaction?.id ?? null,
      reason: 'normal_routine_requested',
      expires_at: expiresAt,
    });
    await this.overrideRepo.save(override);
    await this.simplificationRepo.update(
      { user_id: user.id, ended_at: IsNull() },
      { ended_at: now, acknowledged_at: now },
    );
    return {
      targetDate,
      expiresAt: toIsoString(expiresAt),
      reactionEntryId: latestReaction?.id ?? null,
    };
  }

  async shouldIgnoreReactionContext(
    userId: string,
    targetDate: string,
    lastError: string | null,
  ): Promise<boolean> {
    if (lastError === NORMAL_ROUTINE_REGENERATION_ERROR) return true;
    const override = await this.overrideRepo.findOne({
      where: {
        user_id: userId,
        target_date: targetDate,
        expires_at: MoreThan(new Date()),
      },
    });
    return Boolean(override);
  }

  async recordGapAction(
    user: User,
    payload: RecordSuggestionGapActionDto,
  ): Promise<SuggestionGapActionResponseDto> {
    const suggestion = await this.suggestionRepo.findOne({
      where: { id: payload.suggestionInstanceId },
    });
    if (!suggestion) throw new NotFoundException('Suggestion not found.');
    if (suggestion.user_id !== user.id) {
      throw new ForbiddenException('Suggestion belongs to another user.');
    }
    const normalizedKey = normalizeSuggestionGapKey(
      payload.ingredientOrCategory,
    );
    if (!hasGapRecommendation(suggestion, normalizedKey)) {
      throw new BadRequestException('Gap recommendation was not found.');
    }
    const existing = await this.gapActionRepo.findOne({
      where: {
        user_id: user.id,
        suggestion_instance_id: suggestion.id,
        normalized_key: normalizedKey,
      },
    });
    const action = await this.gapActionRepo.save(
      this.gapActionRepo.create({
        ...(existing ?? {}),
        user_id: user.id,
        suggestion_instance_id: suggestion.id,
        ingredient_or_category: payload.ingredientOrCategory,
        normalized_key: normalizedKey,
        action: payload.action,
      }),
    );
    return toGapActionResponse(action);
  }

  async getGapActionMaps(
    userId: string,
    suggestionIds: string[],
  ): Promise<Map<string, Map<string, SuggestionGapActionKind>>> {
    if (suggestionIds.length === 0) return new Map();
    const rows = await this.gapActionRepo.find({
      where: {
        user_id: userId,
        suggestion_instance_id: In(Array.from(new Set(suggestionIds))),
      },
    });
    const result = new Map<string, Map<string, SuggestionGapActionKind>>();
    for (const row of rows) {
      const map = result.get(row.suggestion_instance_id) ?? new Map();
      map.set(row.normalized_key, row.action);
      result.set(row.suggestion_instance_id, map);
    }
    return result;
  }

  async snoozeRecordingReminder(
    user: User,
    payload: SnoozeRecordingReminderDto,
  ): Promise<RecordingReminderSnoozeResponseDto> {
    const suggestion = await this.assertOwnedSuggestion(
      user.id,
      payload.suggestionInstanceId,
    );
    const minutes =
      payload.minutes ?? RECORDING_REMINDER_SNOOZE_DEFAULT_MINUTES;
    const snoozedUntil = new Date(Date.now() + minutes * 60_000);
    const existing = await this.reminderSnoozeRepo.findOne({
      where: {
        user_id: user.id,
        suggestion_instance_id: suggestion.id,
      },
    });
    const snooze = await this.reminderSnoozeRepo.save(
      this.reminderSnoozeRepo.create({
        ...(existing ?? {}),
        user_id: user.id,
        suggestion_instance_id: suggestion.id,
        snoozed_until: snoozedUntil,
      }),
    );
    return {
      suggestionInstanceId: snooze.suggestion_instance_id,
      snoozedUntil: toIsoString(snooze.snoozed_until),
    };
  }

  async getReminderSnoozeMap(
    userId: string,
    suggestionIds: string[],
  ): Promise<Map<string, Date>> {
    if (suggestionIds.length === 0) return new Map();
    const rows = await this.reminderSnoozeRepo.find({
      where: {
        user_id: userId,
        suggestion_instance_id: In(Array.from(new Set(suggestionIds))),
        snoozed_until: MoreThan(new Date()),
      },
    });
    return new Map(
      rows.map((row) => [row.suggestion_instance_id, row.snoozed_until]),
    );
  }

  private async findLatestReactionEntry(
    userId: string,
    targetDate: string,
  ): Promise<SkinJournalEntry | null> {
    const entries = await this.entryRepo.find({
      where: {
        user_id: userId,
        entry_date: Between(startDate(targetDate), targetDate),
      },
      order: { entry_date: 'DESC' },
      take: REACTION_LOOKBACK_DAYS,
    });
    return entries.find(hasReactionSignal) ?? null;
  }

  private async assertOwnedSuggestion(
    userId: string,
    suggestionId: string,
  ): Promise<SuggestionInstance> {
    const suggestion = await this.suggestionRepo.findOne({
      where: { id: suggestionId },
    });
    if (!suggestion) throw new NotFoundException('Suggestion not found.');
    if (suggestion.user_id !== userId) {
      throw new ForbiddenException('Suggestion belongs to another user.');
    }
    return suggestion;
  }
}

function hasGapRecommendation(
  suggestion: SuggestionInstance,
  normalizedKey: string,
): boolean {
  return (suggestion.gap_recommendations ?? []).some(
    (gap) => normalizeSuggestionGapKey(gap.ingredientOrCategory) === normalizedKey,
  );
}

function startDate(targetDate: string): string {
  const date = new Date(`${targetDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - (REACTION_LOOKBACK_DAYS - 1));
  return date.toISOString().slice(0, 10);
}

function hasReactionSignal(entry: SkinJournalEntry): boolean {
  return Boolean(
    entry.has_reaction_signal ||
      entry.analysis_observations?.reaction_signals?.reaction_detected ||
      entry.analysis_observations?.barrier_signs?.barrier_compromise,
  );
}

function toGapActionResponse(
  action: SuggestionGapAction,
): SuggestionGapActionResponseDto {
  return {
    suggestionInstanceId: action.suggestion_instance_id,
    ingredientOrCategory: action.ingredient_or_category,
    normalizedKey: action.normalized_key,
    action: action.action,
  };
}

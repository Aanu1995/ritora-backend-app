import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { toDateOnlyString, toTimeOnlyString } from '../../common/utils/date';
import { ApplicationLogResponseDto } from '../../application-tracking/dto/application-log-response.dto';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { resolveEffectiveTimeZone } from '../../common/timezone/timezone.utils';
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { User } from '../../users/entities/user.entity';
import {
  SuggestionHistoryDayDto,
  SuggestionHistoryListQueryDto,
  SuggestionHistoryListResponseDto,
  SuggestionHistorySlotSummaryDto,
} from '../dto/suggestion-history.dto';
import { SuggestionInstanceResponseDto } from '../dto/suggestion-instance-response.dto';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import {
  buildSummaryLine,
  computeRange,
  computeSlotStatus,
  isDateBefore,
  rangeWhere,
  shiftIsoDate,
} from './suggestion-history.helpers';
import { formatDateInTimeZone } from './suggestion-helpers';

@Injectable()
export class SuggestionHistoryReader {
  constructor(
    @InjectRepository(SuggestionInstance)
    private readonly suggestionRepo: Repository<SuggestionInstance>,
    @InjectRepository(ScheduleSlot)
    private readonly slotRepo: Repository<ScheduleSlot>,
    @InjectRepository(ApplicationLog)
    private readonly applicationLogRepo: Repository<ApplicationLog>,
  ) {}

  async getHistory(
    user: User,
    requestTimeZone: string | null,
    query: SuggestionHistoryListQueryDto,
  ): Promise<SuggestionHistoryListResponseDto> {
    const timeZone = resolveEffectiveTimeZone(user.time_zone, requestTimeZone);
    const today = formatDateInTimeZone(timeZone, new Date());
    const historyEndDate = shiftIsoDate(today, -1);
    const { fromDate, toDate } = computeRange(query, historyEndDate);
    if (toDate < fromDate) {
      return {
        days: [],
        nextCursor: null,
        totalApplied: 0,
        totalSlots: 0,
        adherencePercent: null,
      };
    }
    const suggestions = await this.suggestionRepo.find({
      where: {
        user_id: user.id,
        target_date: rangeWhere(fromDate, toDate),
        generation_status: 'ready',
      },
      relations: ['steps'],
    });
    const logs = await this.loadLogs(user.id, suggestions, ['items']);
    const logBySuggestion = mapLogsBySuggestion(logs);
    const slotById = await this.loadSlotMap(suggestions);
    const dayMap = new Map<string, SuggestionHistoryDayDto>();
    let totalApplied = 0;
    let totalSlots = 0;

    for (const suggestion of suggestions) {
      const suggestionDate = toDateOnlyString(suggestion.target_date);
      const log = logBySuggestion.get(suggestion.id) ?? null;
      const status = computeSlotStatus(suggestion, log);
      if (query.daypart && query.daypart !== suggestion.daypart) continue;
      if (query.status && query.status !== status) continue;
      if (query.edited === true && !log?.has_been_edited) continue;
      if (query.edited === false && log?.has_been_edited) continue;

      const appliedCount = countApplied(log);
      const totalSteps = suggestion.steps?.length ?? 0;
      const day = getOrCreateDay(dayMap, suggestionDate);
      day.reactionFlagged =
        day.reactionFlagged || suggestion.has_reaction_signal;
      day.slots.push(
        buildSlotSummary(
          suggestion,
          log,
          slotById.get(suggestion.slot_id ?? ''),
          totalSteps,
          appliedCount,
        ),
      );
      dayMap.set(suggestionDate, day);
      totalSlots += 1;
      if (status === 'applied') totalApplied += 1;
    }

    const days = sortDays(dayMap);
    const adherencePercent =
      totalSlots > 0 ? Math.round((totalApplied / totalSlots) * 100) : null;
    return {
      days,
      nextCursor: null,
      totalApplied,
      totalSlots,
      adherencePercent,
    };
  }

  async getHistoryDay(
    user: User,
    requestTimeZone: string | null,
    date: string,
  ): Promise<SuggestionHistoryDayDto> {
    const timeZone = resolveEffectiveTimeZone(user.time_zone, requestTimeZone);
    const today = formatDateInTimeZone(timeZone, new Date());
    if (!isDateBefore(date, today)) {
      return emptyHistoryDay(date);
    }
    const suggestions = await this.suggestionRepo.find({
      where: {
        user_id: user.id,
        target_date: date,
        generation_status: 'ready',
      },
      relations: ['steps', 'steps.product'],
      order: { target_time: 'ASC' },
    });
    const logs = await this.loadLogs(user.id, suggestions, [
      'items',
      'items.product',
      'items.substituted_with_product',
    ]);
    const logBySuggestion = mapLogsBySuggestion(logs);
    const slotById = await this.loadSlotMap(suggestions);
    const slots: SuggestionHistorySlotSummaryDto[] = suggestions.map(
      (suggestion) => {
        const log = logBySuggestion.get(suggestion.id) ?? null;
        const totalSteps = suggestion.steps?.length ?? 0;
        const appliedCount = countApplied(log);
        return {
          ...buildSlotSummary(
            suggestion,
            log,
            slotById.get(suggestion.slot_id ?? ''),
            totalSteps,
            appliedCount,
          ),
          suggestion: SuggestionInstanceResponseDto.fromEntity(suggestion, {
            applicationLogId: log?.id ?? null,
          }),
          applicationLog: log
            ? ApplicationLogResponseDto.fromEntity(log)
            : null,
        };
      },
    );
    slots.sort((a, b) => a.slotTime.localeCompare(b.slotTime));
    return {
      date,
      weatherSummary: null,
      moodScore: null,
      hydrationTrend: null,
      reactionFlagged: suggestions.some(
        (suggestion) => suggestion.has_reaction_signal,
      ),
      photoEntryId: null,
      slots,
    };
  }

  private async loadLogs(
    userId: string,
    suggestions: SuggestionInstance[],
    relations: string[],
  ): Promise<ApplicationLog[]> {
    const suggestionIds = suggestions.map((suggestion) => suggestion.id);
    if (suggestionIds.length === 0) return [];
    return this.applicationLogRepo.find({
      where: {
        user_id: userId,
        suggestion_instance_id: In(suggestionIds),
      },
      relations,
    });
  }

  private async loadSlotMap(
    suggestions: SuggestionInstance[],
  ): Promise<Map<string, ScheduleSlot>> {
    const slotIds = Array.from(
      new Set(suggestions.map((s) => s.slot_id).filter(Boolean) as string[]),
    );
    if (slotIds.length === 0) return new Map();
    const slots = await this.slotRepo.findBy({ id: In(slotIds) });
    return new Map(slots.map((slot) => [slot.id, slot]));
  }
}

function buildSlotSummary(
  suggestion: SuggestionInstance,
  log: ApplicationLog | null,
  slot: ScheduleSlot | undefined,
  totalSteps: number,
  appliedCount: number,
): SuggestionHistorySlotSummaryDto {
  return {
    slotId: suggestion.slot_id,
    suggestionId: suggestion.id,
    applicationLogId: log?.id ?? null,
    daypart: suggestion.daypart,
    slotTime: toTimeOnlyString(slot?.slot_time ?? suggestion.target_time),
    mode: suggestion.mode,
    appliedCount,
    totalSteps,
    status: computeSlotStatus(suggestion, log),
    hasBeenEdited: log?.has_been_edited ?? false,
    summaryLine: buildSummaryLine(suggestion, log, totalSteps, appliedCount),
  };
}

function getOrCreateDay(
  dayMap: Map<string, SuggestionHistoryDayDto>,
  date: string,
): SuggestionHistoryDayDto {
  return dayMap.get(date) ?? emptyHistoryDay(date);
}

function emptyHistoryDay(date: string): SuggestionHistoryDayDto {
  return {
    date,
    weatherSummary: null,
    moodScore: null,
    hydrationTrend: null,
    reactionFlagged: false,
    photoEntryId: null,
    slots: [],
  };
}

function mapLogsBySuggestion(
  logs: ApplicationLog[],
): Map<string, ApplicationLog> {
  const map = new Map<string, ApplicationLog>();
  for (const log of logs) {
    if (log.suggestion_instance_id) {
      map.set(log.suggestion_instance_id, log);
    }
  }
  return map;
}

function countApplied(log: ApplicationLog | null): number {
  return log?.items?.filter((item) => item.status === 'applied').length ?? 0;
}

function sortDays(
  dayMap: Map<string, SuggestionHistoryDayDto>,
): SuggestionHistoryDayDto[] {
  const days = Array.from(dayMap.values()).sort((a, b) =>
    a.date < b.date ? 1 : -1,
  );
  for (const day of days) {
    day.slots.sort((a, b) => a.slotTime.localeCompare(b.slotTime));
  }
  return days;
}

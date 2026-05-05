import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { toDateOnlyString } from '../../common/utils/date';
import { ApplicationLogResponseDto } from '../../application-tracking/dto/application-log-response.dto';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { resolveEffectiveTimeZone } from '../../common/timezone/timezone.utils';
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { SkinJournalEntry } from '../../skin-journal/entities/skin-journal-entry.entity';
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
  applyHistoryCursor,
  applyHistoryFilters,
  buildHistoryNextCursor,
  clampHistoryLimit,
  HistoryCursorRow,
  historyCursorFingerprint,
} from './suggestion-history-cursor';
import {
  computeRange,
  computeSlotStatus,
  isDateBefore,
  shiftIsoDate,
} from './suggestion-history.helpers';
import {
  applyJournalMetadata,
  buildHistorySlotSummary,
  countAppliedItems,
  emptyHistoryDay,
  getOrCreateHistoryDay,
  mapLogsBySuggestion,
  sortHistoryDays,
} from './suggestion-history-day.mapper';
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
    @InjectRepository(SkinJournalEntry)
    private readonly journalEntryRepo: Repository<SkinJournalEntry>,
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
        totalEdited: 0,
      };
    }
    const fingerprint = historyCursorFingerprint(user.id, {
      ...query,
      fromDate,
      toDate,
    });
    const limit = clampHistoryLimit(query.limit);
    const cursorRows = await this.loadHistoryCursorRows({
      userId: user.id,
      fromDate,
      toDate,
      query,
      fingerprint,
      limit,
    });
    const hasMore = cursorRows.length > limit;
    const pageRows = hasMore ? cursorRows.slice(0, limit) : cursorRows;
    const suggestions = await this.loadSuggestionsByCursorRows(pageRows);
    const logs = await this.loadLogs(user.id, suggestions, ['items']);
    const logBySuggestion = mapLogsBySuggestion(logs);
    const slotById = await this.loadSlotMap(suggestions);
    const journalEntryByDate = await this.loadJournalEntryMap(
      user.id,
      suggestions,
    );
    const dayMap = new Map<string, SuggestionHistoryDayDto>();
    let totalApplied = 0;
    let totalSlots = 0;
    let totalEdited = 0;

    for (const suggestion of suggestions) {
      const suggestionDate = toDateOnlyString(suggestion.target_date);
      const log = logBySuggestion.get(suggestion.id) ?? null;
      const status = computeSlotStatus(suggestion, log);

      const appliedCount = countAppliedItems(log);
      const totalSteps = suggestion.steps?.length ?? 0;
      const day = getOrCreateHistoryDay(dayMap, suggestionDate);
      applyJournalMetadata(day, journalEntryByDate.get(suggestionDate));
      day.reactionFlagged =
        day.reactionFlagged || suggestion.has_reaction_signal;
      day.slots.push(
        buildHistorySlotSummary(
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
      if (log?.has_been_edited) totalEdited += 1;
    }

    const days = sortHistoryDays(dayMap);
    const lastPageRow = pageRows.at(-1);
    const adherencePercent =
      totalSlots > 0 ? Math.round((totalApplied / totalSlots) * 100) : null;
    return {
      days,
      nextCursor: buildHistoryNextCursor(lastPageRow, fingerprint, hasMore),
      totalApplied,
      totalSlots,
      adherencePercent,
      totalEdited,
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
    const journalEntry = (
      await this.loadJournalEntryMap(user.id, suggestions)
    ).get(date);
    const logBySuggestion = mapLogsBySuggestion(logs);
    const slotById = await this.loadSlotMap(suggestions);
    const slots: SuggestionHistorySlotSummaryDto[] = suggestions.map(
      (suggestion) => {
        const log = logBySuggestion.get(suggestion.id) ?? null;
        const totalSteps = suggestion.steps?.length ?? 0;
        const appliedCount = countAppliedItems(log);
        return {
          ...buildHistorySlotSummary(
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
    return applyJournalMetadata(
      {
        date,
        weatherSummary: null,
        moodScore: null,
        hydrationTrend: null,
        reactionFlagged: suggestions.some(
          (suggestion) => suggestion.has_reaction_signal,
        ),
        photoEntryId: null,
        slots,
      },
      journalEntry,
    );
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

  private async loadJournalEntryMap(
    userId: string,
    suggestions: SuggestionInstance[],
  ): Promise<Map<string, SkinJournalEntry>> {
    const dates = Array.from(
      new Set(suggestions.map((s) => toDateOnlyString(s.target_date))),
    );
    if (dates.length === 0) return new Map();
    const entries = await this.journalEntryRepo.find({
      where: { user_id: userId, entry_date: In(dates) },
    });
    return new Map(entries.map((entry) => [entry.entry_date, entry]));
  }

  private async loadHistoryCursorRows(params: {
    userId: string;
    fromDate: string;
    toDate: string;
    query: SuggestionHistoryListQueryDto;
    fingerprint: string;
    limit: number;
  }): Promise<HistoryCursorRow[]> {
    const queryBuilder = this.suggestionRepo
      .createQueryBuilder('suggestion')
      .select('suggestion.id', 'suggestion_id')
      .addSelect('suggestion.target_date', 'target_date')
      .addSelect('suggestion.target_time', 'target_time')
      .where('suggestion.user_id = :userId', { userId: params.userId })
      .andWhere('suggestion.generation_status = :status', {
        status: 'ready',
      })
      .andWhere('suggestion.target_date BETWEEN :fromDate AND :toDate', {
        fromDate: params.fromDate,
        toDate: params.toDate,
      })
      .orderBy('suggestion.target_date', 'DESC')
      .addOrderBy('suggestion.target_time', 'DESC')
      .addOrderBy('suggestion.id', 'DESC')
      .limit(params.limit + 1);

    applyHistoryFilters(queryBuilder, params.query, params.userId);
    applyHistoryCursor(queryBuilder, params.query.cursor, params.fingerprint);

    return queryBuilder.getRawMany<HistoryCursorRow>();
  }

  private async loadSuggestionsByCursorRows(
    rows: HistoryCursorRow[],
  ): Promise<SuggestionInstance[]> {
    const ids = rows.map((row) => row.suggestion_id);
    if (ids.length === 0) return [];
    const suggestions = await this.suggestionRepo.find({
      where: { id: In(ids) },
      relations: ['steps'],
    });
    const suggestionById = new Map(
      suggestions.map((suggestion) => [suggestion.id, suggestion]),
    );
    return ids
      .map((id) => suggestionById.get(id))
      .filter((suggestion): suggestion is SuggestionInstance =>
        Boolean(suggestion),
      );
  }
}

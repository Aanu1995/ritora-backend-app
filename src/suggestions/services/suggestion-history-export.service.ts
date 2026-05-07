import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  ApplicationItemSource,
  ApplicationItemStatus,
} from '../../application-tracking/application-tracking.constants';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import {
  toDateOnlyString,
  toIsoString,
  toTimeOnlyString,
} from '../../common/utils/date';
import { resolveEffectiveTimeZone } from '../../common/timezone/timezone.utils';
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { SkinJournalEntry } from '../../skin-journal/entities/skin-journal-entry.entity';
import { User } from '../../users/entities/user.entity';
import {
  SuggestionHistoryExportFile,
  SuggestionHistoryListQueryDto,
} from '../dto/suggestion-history.dto';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { SuggestionStep } from '../entities/suggestion-step.entity';
import {
  SUGGESTION_HISTORY_EXPORT_MAX_ROWS,
  SuggestionGenerationStatus,
  SuggestionRequestSource,
} from '../suggestions.constants';
import {
  applyHistoryFilters,
  HistoryCursorRow,
} from './suggestion-history-cursor';
import {
  buildSummaryLine,
  computeRange,
  computeSlotStatus,
  shiftIsoDate,
} from './suggestion-history.helpers';
import { formatDateInTimeZone } from './suggestion-helpers';

const HISTORY_EXPORT_CONTENT_TYPE = 'text/csv; charset=utf-8';
const HISTORY_EXPORT_HEADERS = [
  'Date',
  'Time',
  'Daypart',
  'Mode',
  'Source',
  'On-Demand Intent',
  'Status',
  'Applied Count',
  'Total Steps',
  'Edited',
  'AI Model',
  'Photo Entry ID',
  'Suggestion ID',
  'Application Log ID',
  'Suggested Steps',
  'Applied Items',
  'General Notes',
  'Summary',
] as const;

@Injectable()
export class SuggestionHistoryExportService {
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

  async exportCsv(
    user: User,
    requestTimeZone: string | null,
    query: SuggestionHistoryListQueryDto,
  ): Promise<SuggestionHistoryExportFile> {
    const timeZone = resolveEffectiveTimeZone(user.time_zone, requestTimeZone);
    const today = formatDateInTimeZone(timeZone, new Date());
    const historyEndDate = shiftIsoDate(today, -1);
    const { fromDate, toDate } = computeRange(query, historyEndDate);
    if (toDate < fromDate) {
      return buildExportFile(fromDate, toDate, []);
    }

    const rows = await this.loadExportCursorRows(
      user.id,
      fromDate,
      toDate,
      query,
    );
    if (rows.length > SUGGESTION_HISTORY_EXPORT_MAX_ROWS) {
      throw new BadRequestException(
        `History export is limited to ${SUGGESTION_HISTORY_EXPORT_MAX_ROWS} rows. Narrow the filters and try again.`,
      );
    }

    const suggestions = await this.loadSuggestionsByCursorRows(rows);
    const logs = await this.loadLogs(user.id, suggestions);
    const logBySuggestion = mapLogsBySuggestion(logs);
    const slotById = await this.loadSlotMap(suggestions);
    const journalEntryByDate = await this.loadJournalEntryMap(
      user.id,
      suggestions,
    );
    const exportRows: string[][] = suggestions.map((suggestion): string[] => {
      const targetDate = toDateOnlyString(suggestion.target_date);
      const log = logBySuggestion.get(suggestion.id) ?? null;
      const totalSteps = suggestion.steps?.length ?? 0;
      const appliedCount = countApplied(log);
      const slotTime = toTimeOnlyString(
        slotById.get(suggestion.slot_id ?? '')?.slot_time ??
          suggestion.target_time,
      );
      return [
        targetDate,
        slotTime,
        suggestion.daypart,
        suggestion.mode,
        suggestion.request_source ?? SuggestionRequestSource.Scheduled,
        suggestion.request_source === SuggestionRequestSource.OnDemand
          ? (suggestion.request_context?.intent ?? '')
          : '',
        computeSlotStatus(suggestion, log),
        String(appliedCount),
        String(totalSteps),
        log?.has_been_edited ? 'yes' : 'no',
        suggestion.ai_model ?? '',
        journalEntryByDate.get(targetDate)?.photo_object_key
          ? (journalEntryByDate.get(targetDate)?.id ?? '')
          : '',
        suggestion.id,
        log?.id ?? '',
        formatSuggestedSteps(suggestion.steps ?? []),
        formatAppliedItems(log),
        log?.general_notes ?? '',
        buildSummaryLine(suggestion, log, totalSteps, appliedCount),
      ];
    });

    return buildExportFile(fromDate, toDate, exportRows);
  }

  private async loadExportCursorRows(
    userId: string,
    fromDate: string,
    toDate: string,
    query: SuggestionHistoryListQueryDto,
  ): Promise<HistoryCursorRow[]> {
    const queryBuilder = this.suggestionRepo
      .createQueryBuilder('suggestion')
      .select('suggestion.id', 'suggestion_id')
      .addSelect('suggestion.target_date', 'target_date')
      .addSelect('suggestion.target_time', 'target_time')
      .where('suggestion.user_id = :userId', { userId })
      .andWhere('suggestion.generation_status = :status', {
        status: SuggestionGenerationStatus.Ready,
      })
      .andWhere('suggestion.target_date BETWEEN :fromDate AND :toDate', {
        fromDate,
        toDate,
      })
      .orderBy('suggestion.target_date', 'DESC')
      .addOrderBy('suggestion.target_time', 'DESC')
      .addOrderBy('suggestion.id', 'DESC')
      .limit(SUGGESTION_HISTORY_EXPORT_MAX_ROWS + 1);

    applyHistoryFilters(queryBuilder, query, userId);
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

  private async loadLogs(
    userId: string,
    suggestions: SuggestionInstance[],
  ): Promise<ApplicationLog[]> {
    const suggestionIds = suggestions.map((suggestion) => suggestion.id);
    if (suggestionIds.length === 0) return [];
    return this.applicationLogRepo.find({
      where: {
        user_id: userId,
        suggestion_instance_id: In(suggestionIds),
      },
      relations: ['items', 'items.product', 'items.substituted_with_product'],
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
}

function buildExportFile(
  fromDate: string,
  toDate: string,
  rows: string[][],
): SuggestionHistoryExportFile {
  return {
    fileName: `ritora-history-${fromDate}-to-${toDate}.csv`,
    contentType: HISTORY_EXPORT_CONTENT_TYPE,
    body: [[...HISTORY_EXPORT_HEADERS], ...rows]
      .map((row) => row.map(csvCell).join(','))
      .join('\n'),
  };
}

function formatSuggestedSteps(steps: SuggestionStep[]): string {
  return [...steps]
    .sort((a, b) => a.step_order - b.step_order)
    .map((step) =>
      compactText([
        String(step.step_order + 1),
        step.product_brand_snapshot,
        step.product_name_snapshot,
        step.custom_label,
        step.step_label,
      ]),
    )
    .join(' | ');
}

function formatAppliedItems(log: ApplicationLog | null): string {
  return [...(log?.items ?? [])]
    .sort((a, b) => a.step_order - b.step_order)
    .map((item) => {
      const product = compactText([
        item.substituted_with_product?.brand ??
          item.applied_snapshot?.brand ??
          item.product_brand_snapshot ??
          item.ad_hoc_brand,
        item.substituted_with_product?.name ??
          item.applied_snapshot?.name ??
          item.product_name_snapshot ??
          item.ad_hoc_name ??
          item.step_label,
      ]);
      return compactText([
        `${item.step_order + 1}.`,
        formatAppliedStatus(item.status),
        formatItemSource(item.item_source),
        product,
        item.applied_at ? toIsoString(item.applied_at) : null,
        item.substitution_reason,
        item.notes,
      ]);
    })
    .join(' | ');
}

function formatAppliedStatus(status: ApplicationItemStatus): string {
  return status;
}

function formatItemSource(source: ApplicationItemSource): string {
  return source;
}

function compactText(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(' ');
}

function csvCell(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
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
  return log?.items?.filter((item) => item.status !== 'skipped').length ?? 0;
}

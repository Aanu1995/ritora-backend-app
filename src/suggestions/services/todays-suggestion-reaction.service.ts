import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, Repository } from 'typeorm';
import { toIsoString } from '../../common/utils/date';
import { RoutineSimplificationEvent } from '../../skin-journal/entities/routine-simplification-event.entity';
import { SkinJournalEntry } from '../../skin-journal/entities/skin-journal-entry.entity';
import type { AnalysisObservations } from '../../skin-journal/skin-journal.constants';
import { TodaysSuggestionReactionAlertDto } from '../dto/todays-suggestion-response.dto';
import { SuggestionTodayActionService } from './suggestion-today-action.service';

const REACTION_LOOKBACK_DAYS = 7;
const CLEAR_PHOTO_TARGET = 2;
const CLEAR_CRITERIA = [
  'Two follow-up photos without a reaction signal.',
  'No new irritation, redness, or dryness notes.',
  'No professional-review safety flag on the latest entry.',
];
const REACTION_CONCERN_KEYS = new Set([
  'redness_inflammation',
  'dryness',
  'skin_barrier_damage',
  'eczema_indicator',
  'acne',
]);

@Injectable()
export class TodaysSuggestionReactionService {
  constructor(
    @InjectRepository(SkinJournalEntry)
    private readonly entryRepo: Repository<SkinJournalEntry>,
    @InjectRepository(RoutineSimplificationEvent)
    private readonly simplificationRepo: Repository<RoutineSimplificationEvent>,
    private readonly todayActionService: SuggestionTodayActionService,
  ) {}

  async getReactionAlert(
    userId: string,
    targetDate: string,
    pausedActiveNames: string[],
  ): Promise<TodaysSuggestionReactionAlertDto | null> {
    if (
      await this.todayActionService.shouldIgnoreReactionContext(
        userId,
        targetDate,
        null,
      )
    ) {
      return null;
    }
    const entries = await this.entryRepo.find({
      where: {
        user_id: userId,
        entry_date: Between(startDate(targetDate), targetDate),
      },
      order: { entry_date: 'DESC' },
      take: REACTION_LOOKBACK_DAYS,
    });
    const latest = entries.find(hasReactionSignal) ?? null;
    if (!latest) return null;

    const simplification = await this.simplificationRepo.findOne({
      where: { user_id: userId, ended_at: IsNull() },
      order: { started_at: 'DESC' },
    });
    const observations = latest.analysis_observations;
    const concernKeys = collectConcernKeys(observations);
    return {
      detectedAt: toIsoString(
        latest.analysis_completed_at ?? latest.updated_at ?? latest.created_at,
      ),
      simplificationId: simplification?.id ?? null,
      canUseNormalRoutine: true,
      photoEntryId: latest.id,
      severity: observations?.reaction_signals?.reaction_severity ?? null,
      confidence: observations?.reaction_signals?.confidence ?? null,
      pausedActiveNames: unique(pausedActiveNames),
      affectedZones: collectAffectedZones(observations),
      indicators: collectIndicators(observations),
      concernKeys,
      barrierConcern: hasBarrierConcern(observations, concernKeys),
      photosUntilClear: photosUntilClear(entries, latest),
      clearCriteria: CLEAR_CRITERIA,
      summary: buildSummary(latest, observations),
    };
  }
}

function hasReactionSignal(entry: SkinJournalEntry): boolean {
  return Boolean(
    entry.has_reaction_signal ||
      entry.analysis_observations?.reaction_signals?.reaction_detected ||
      entry.analysis_observations?.barrier_signs?.barrier_compromise,
  );
}

function startDate(targetDate: string): string {
  const date = new Date(`${targetDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - (REACTION_LOOKBACK_DAYS - 1));
  return date.toISOString().slice(0, 10);
}

function collectConcernKeys(
  observations: AnalysisObservations | null,
): string[] {
  return unique(
    (observations?.detected_concerns ?? [])
      .map((concern) => concern.concern)
      .filter((concern) => REACTION_CONCERN_KEYS.has(concern)),
  );
}

function collectAffectedZones(
  observations: AnalysisObservations | null,
): string[] {
  return unique(
    (observations?.detected_concerns ?? [])
      .filter((concern) => REACTION_CONCERN_KEYS.has(concern.concern))
      .flatMap((concern) => concern.locations),
  );
}

function collectIndicators(
  observations: AnalysisObservations | null,
): string[] {
  return unique([
    ...(observations?.reaction_signals?.indicators ?? []),
    ...(observations?.barrier_signs?.indicators ?? []),
  ]);
}

function hasBarrierConcern(
  observations: AnalysisObservations | null,
  concernKeys: string[],
): boolean {
  return Boolean(
    observations?.barrier_signs?.barrier_compromise ||
      concernKeys.includes('skin_barrier_damage'),
  );
}

function photosUntilClear(
  entries: SkinJournalEntry[],
  latest: SkinJournalEntry,
): number {
  const clearFollowUps = entries.filter(
    (entry) => entry.entry_date > latest.entry_date && !hasReactionSignal(entry),
  ).length;
  return Math.max(0, CLEAR_PHOTO_TARGET - clearFollowUps);
}

function buildSummary(
  entry: SkinJournalEntry,
  observations: AnalysisObservations | null,
): string {
  return (
    observations?.user_visible_message ??
    entry.analysis_summary ??
    'A recent journal photo suggested a possible irritation signal, so Ritora is keeping today simple.'
  );
}

function unique(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

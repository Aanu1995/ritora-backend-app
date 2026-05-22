import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import {
  ApplicationItemStatus,
  ApplicationLogItemSnapshot,
} from '../../application-tracking/application-tracking.constants';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { ApplicationLogItem } from '../../application-tracking/entities/application-log-item.entity';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ProductCategory, ShelfStatus } from '../../shelf/shelf.types';
import {
  AnalysisConcern,
  AnalysisObservations,
  AnalysisStatusValue,
  SKIN_JOURNAL_FRONT_PHOTO_ANGLE,
  SKIN_JOURNAL_PHOTO_ANGLES,
  type Angle,
} from '../../skin-journal/skin-journal.constants';
import { SkinJournalEntry } from '../../skin-journal/entities/skin-journal-entry.entity';
import {
  SmartPicksProductAdherence,
  SmartPicksProductPerformanceSignal,
  SmartPicksProductPerformanceSummary,
} from '../smart-picks.types';

const HISTORY_WINDOW_DAYS = 90;
const RECENT_WINDOW_DAYS = 30;
const CONSISTENT_USAGE_LAST_30 = 10;
const CONSISTENT_USAGE_LAST_90 = 20;
const REACTION_LOOKBACK_DAYS = 2;
const REACTION_REPLACEMENT_THRESHOLD = 2;
const PROGRESS_IMPROVEMENT_RATIO = 0.65;
const DAY_MS = 24 * 60 * 60 * 1000;

const PROGRESS_REPLACEABLE_CATEGORIES = new Set<ProductCategory>([
  ProductCategory.Serum,
  ProductCategory.Treatment,
  ProductCategory.Exfoliant,
  ProductCategory.SunProtection,
  ProductCategory.Moisturizer,
]);
const PHOTO_ANGLE_SET: ReadonlySet<Angle> = new Set(SKIN_JOURNAL_PHOTO_ANGLES);

export interface SmartPicksProductPerformanceParams {
  userId: string;
  products: InventoryProduct[];
  primaryGoal: string | null;
  referenceDate?: Date;
}

interface SummarizeProductPerformanceInput {
  products: InventoryProduct[];
  applicationLogs: ApplicationLog[];
  journalEntries: SkinJournalEntry[];
  primaryGoal: string | null;
  referenceDate: Date;
}

@Injectable()
export class SmartPicksProductPerformanceService {
  private readonly logger = new Logger(
    SmartPicksProductPerformanceService.name,
  );

  constructor(
    @InjectRepository(ApplicationLog)
    private readonly applicationLogRepo: Repository<ApplicationLog>,
    @InjectRepository(SkinJournalEntry)
    private readonly journalEntryRepo: Repository<SkinJournalEntry>,
  ) {}

  async summarizeForUser(
    params: SmartPicksProductPerformanceParams,
  ): Promise<SmartPicksProductPerformanceSummary[]> {
    if (params.products.length === 0) return [];
    const referenceDate =
      params.referenceDate ?? (await this.latestUserHistoryDate(params.userId));
    const fromDate = shiftIsoDate(referenceDate, -HISTORY_WINDOW_DAYS);
    const toDate = toIsoDate(referenceDate);
    let applicationLogs: ApplicationLog[];
    let journalEntries: SkinJournalEntry[];
    try {
      [applicationLogs, journalEntries] = await Promise.all([
        this.applicationLogRepo.find({
          where: {
            user_id: params.userId,
            target_date: Between(fromDate, toDate),
          },
          relations: ['items'],
          order: { target_date: 'ASC' },
        }),
        this.journalEntryRepo.find({
          where: {
            user_id: params.userId,
            entry_date: Between(fromDate, toDate),
            analysis_status: AnalysisStatusValue.Completed,
          },
          order: { entry_date: 'ASC' },
        }),
      ]);
    } catch (error) {
      this.logger.warn(
        `Smart Picks history summary unavailable; skipping performance signals: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return [];
    }

    return summarizeSmartPicksProductPerformance({
      products: params.products,
      applicationLogs,
      journalEntries,
      primaryGoal: params.primaryGoal,
      referenceDate,
    });
  }

  private async latestUserHistoryDate(userId: string): Promise<Date> {
    try {
      const [latestApplicationLog, latestJournalEntry] = await Promise.all([
        this.latestApplicationLogDate(userId),
        this.latestJournalEntryDate(userId),
      ]);
      const latestDate = latestIsoDate(
        latestApplicationLog,
        latestJournalEntry,
      );
      return latestDate ? isoDateToUtc(latestDate) : new Date();
    } catch (error) {
      this.logger.warn(
        `Smart Picks history anchor unavailable; using current date: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return new Date();
    }
  }

  private async latestApplicationLogDate(
    userId: string,
  ): Promise<string | null> {
    const latestApplicationLog = await this.applicationLogRepo.findOne({
      where: { user_id: userId },
      order: { target_date: 'DESC' },
      select: ['target_date'],
    });
    return latestApplicationLog?.target_date ?? null;
  }

  private async latestJournalEntryDate(userId: string): Promise<string | null> {
    const latestJournalEntry = await this.journalEntryRepo.findOne({
      where: {
        user_id: userId,
        analysis_status: AnalysisStatusValue.Completed,
      },
      order: { entry_date: 'DESC' },
      select: ['entry_date'],
    });
    return latestJournalEntry?.entry_date ?? null;
  }
}

export function summarizeSmartPicksProductPerformance(
  input: SummarizeProductPerformanceInput,
): SmartPicksProductPerformanceSummary[] {
  const referenceDate = input.referenceDate;
  const productUsageDates = buildProductUsageDateMap(input.applicationLogs);
  const trend = summarizePhotoTrend(input.journalEntries, input.primaryGoal);

  return input.products.map((product) => {
    const usageDates = [...(productUsageDates.get(product.id) ?? new Set())]
      .filter((date) => inWindow(date, referenceDate, HISTORY_WINDOW_DAYS))
      .sort();
    const usageDaysLast30 = usageDates.filter((date) =>
      inWindow(date, referenceDate, RECENT_WINDOW_DAYS),
    ).length;
    const usageDaysLast90 = usageDates.length;
    const reactionSignalCount = countReactionSignalsNearUse(
      usageDates,
      input.journalEntries,
      referenceDate,
    );
    const adherence = usageAdherence(usageDaysLast30, usageDaysLast90);
    const goalTrend = productGoalTrend({
      adherence,
      reactionSignalCount,
      photoTrendSignal: trend.signal,
    });
    const replacementCandidate = shouldSuggestReplacement({
      product,
      adherence,
      goalTrend,
      reactionSignalCount,
    });
    const replacementReason = replacementCandidate
      ? buildReplacementReason({
          product,
          usageDaysLast90,
          photoCheckpoints: trend.photoCheckpoints,
          concernTrend: trend.concernTrend,
          reactionSignalCount,
          goalTrend,
        })
      : null;

    return {
      productId: product.id,
      brand: product.brand,
      productName: product.name,
      category: product.category ?? null,
      usageDaysLast30,
      usageDaysLast90,
      firstUsedAt: usageDates[0] ?? null,
      lastUsedAt: usageDates.at(-1) ?? null,
      adherence,
      goalTrend,
      concernTrend: trend.concernTrend,
      photoCheckpoints: trend.photoCheckpoints,
      photoInputImages: trend.photoInputImages,
      multiAnglePhotoCheckpoints: trend.multiAnglePhotoCheckpoints,
      reactionSignalCount,
      replacementCandidate,
      replacementReason,
    };
  });
}

function buildProductUsageDateMap(
  logs: ApplicationLog[],
): Map<string, Set<string>> {
  const usage = new Map<string, Set<string>>();
  for (const log of logs) {
    for (const item of log.items ?? []) {
      const productId = appliedProductId(item);
      if (!productId) continue;
      const dates = usage.get(productId) ?? new Set<string>();
      dates.add(log.target_date);
      usage.set(productId, dates);
    }
  }
  return usage;
}

function appliedProductId(item: ApplicationLogItem): string | null {
  if (item.status === ApplicationItemStatus.Skipped) return null;
  if (item.status === ApplicationItemStatus.Substituted) {
    return (
      item.substituted_with_product_id ??
      productIdFromSnapshot(item.applied_snapshot) ??
      null
    );
  }
  return item.inventory_product_id;
}

function productIdFromSnapshot(
  snapshot: ApplicationLogItemSnapshot['applied_snapshot'] | null,
): string | null {
  return snapshot?.product_id ?? null;
}

function summarizePhotoTrend(
  entries: SkinJournalEntry[],
  primaryGoal: string | null,
): {
  signal: SmartPicksProductPerformanceSignal;
  concernTrend: string | null;
  photoCheckpoints: number;
  photoInputImages: number;
  multiAnglePhotoCheckpoints: number;
} {
  const analyzedEntries = entries
    .filter((entry) => isTrendUsable(entry.analysis_observations))
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date));
  const concernSet = concernsForGoal(primaryGoal);
  const concernTrend = firstConcernName(analyzedEntries, concernSet);
  const photoCheckpoints = countPhotoCheckpoints(analyzedEntries);
  const photoInputImages = analyzedEntries.reduce(
    (sum, entry) => sum + currentPhotoAngleCount(entry),
    0,
  );
  const multiAnglePhotoCheckpoints = analyzedEntries.filter(
    (entry) => currentPhotoAngleCount(entry) > 1,
  ).length;

  if (analyzedEntries.length < 2 || photoCheckpoints === 0) {
    return {
      signal: SmartPicksProductPerformanceSignal.InsufficientHistory,
      concernTrend,
      photoCheckpoints,
      photoInputImages,
      multiAnglePhotoCheckpoints,
    };
  }

  const referenceDate = isoDateToUtc(analyzedEntries.at(-1)?.entry_date ?? '');
  const recentEntries = analyzedEntries.filter((entry) => {
    const daysAgo = daysBetween(entry.entry_date, referenceDate);
    return daysAgo >= 0 && daysAgo <= RECENT_WINDOW_DAYS;
  });
  const baselineEntries = analyzedEntries.filter((entry) => {
    const daysAgo = daysBetween(entry.entry_date, referenceDate);
    return daysAgo > RECENT_WINDOW_DAYS;
  });

  if (recentEntries.length === 0 || baselineEntries.length === 0) {
    return {
      signal: SmartPicksProductPerformanceSignal.InsufficientHistory,
      concernTrend,
      photoCheckpoints,
      photoInputImages,
      multiAnglePhotoCheckpoints,
    };
  }

  const latestChangeSignal = latestConcernChangeSignal(
    recentEntries,
    concernSet,
  );
  if (latestChangeSignal === 'improved') {
    return {
      signal: SmartPicksProductPerformanceSignal.Working,
      concernTrend,
      photoCheckpoints,
      photoInputImages,
      multiAnglePhotoCheckpoints,
    };
  }
  if (latestChangeSignal === 'worsened') {
    return {
      signal: SmartPicksProductPerformanceSignal.NotImproving,
      concernTrend,
      photoCheckpoints,
      photoInputImages,
      multiAnglePhotoCheckpoints,
    };
  }

  const baselineScore = averageConcernScore(baselineEntries, concernSet);
  const recentScore = averageConcernScore(recentEntries, concernSet);
  if (baselineScore <= 0 && recentScore <= 0) {
    return {
      signal: SmartPicksProductPerformanceSignal.InsufficientHistory,
      concernTrend,
      photoCheckpoints,
      photoInputImages,
      multiAnglePhotoCheckpoints,
    };
  }

  const signal =
    recentScore <= baselineScore * PROGRESS_IMPROVEMENT_RATIO
      ? SmartPicksProductPerformanceSignal.Working
      : SmartPicksProductPerformanceSignal.NotImproving;
  return {
    signal,
    concernTrend,
    photoCheckpoints,
    photoInputImages,
    multiAnglePhotoCheckpoints,
  };
}

function isTrendUsable(obs: AnalysisObservations | null): boolean {
  if (!obs) return false;
  if (obs.image_quality.needs_retake) return false;
  if (!obs.image_quality.face_detected) return false;
  return obs.image_quality.lighting_quality !== 'poor';
}

function latestConcernChangeSignal(
  entries: SkinJournalEntry[],
  concerns: Set<AnalysisConcern>,
): 'improved' | 'worsened' | null {
  for (const entry of [...entries].reverse()) {
    const matchingConcern = entry.analysis_observations?.detected_concerns.find(
      (detected) => concerns.has(detected.concern),
    );
    if (matchingConcern?.change_from_previous === 'improved') return 'improved';
    if (matchingConcern?.change_from_previous === 'worsened') return 'worsened';
    const overall = entry.analysis_observations?.overall_change_from_previous;
    if (overall === 'improved') return 'improved';
    if (overall === 'worsened') return 'worsened';
  }
  return null;
}

function averageConcernScore(
  entries: SkinJournalEntry[],
  concerns: Set<AnalysisConcern>,
): number {
  if (entries.length === 0) return 0;
  const total = entries.reduce(
    (sum, entry) => sum + concernScore(entry.analysis_observations, concerns),
    0,
  );
  return total / entries.length;
}

function concernScore(
  obs: AnalysisObservations | null,
  concerns: Set<AnalysisConcern>,
): number {
  if (!obs) return 0;
  const matchingScores = obs.detected_concerns
    .filter((detected) => concerns.has(detected.concern))
    .map((detected) => severityScore(detected.severity) * detected.confidence);
  return matchingScores.length ? Math.max(...matchingScores) : 0;
}

function severityScore(severity: 'mild' | 'moderate' | 'severe'): number {
  if (severity === 'severe') return 3;
  if (severity === 'moderate') return 2;
  return 1;
}

function firstConcernName(
  entries: SkinJournalEntry[],
  concerns: Set<AnalysisConcern>,
): string | null {
  for (const entry of [...entries].reverse()) {
    const detected = entry.analysis_observations?.detected_concerns.find(
      (concern) => concerns.has(concern.concern),
    );
    if (detected) return detected.concern;
  }
  return null;
}

function concernsForGoal(primaryGoal: string | null): Set<AnalysisConcern> {
  const normalized = (primaryGoal ?? '').toLowerCase();
  if (
    normalized.includes('dark') ||
    normalized.includes('mark') ||
    normalized.includes('hyper') ||
    normalized.includes('tone') ||
    normalized.includes('pih')
  ) {
    return new Set<AnalysisConcern>(['hyperpigmentation', 'uneven_tone']);
  }
  if (normalized.includes('acne') || normalized.includes('breakout')) {
    return new Set<AnalysisConcern>(['acne']);
  }
  if (normalized.includes('texture') || normalized.includes('pore')) {
    return new Set<AnalysisConcern>(['texture', 'large_pores']);
  }
  if (normalized.includes('dry') || normalized.includes('barrier')) {
    return new Set<AnalysisConcern>(['dryness', 'skin_barrier_damage']);
  }
  if (normalized.includes('red') || normalized.includes('irrit')) {
    return new Set<AnalysisConcern>([
      'redness_inflammation',
      'skin_barrier_damage',
    ]);
  }
  if (normalized.includes('line') || normalized.includes('aging')) {
    return new Set<AnalysisConcern>(['fine_lines']);
  }
  return new Set<AnalysisConcern>([
    'acne',
    'hyperpigmentation',
    'uneven_tone',
    'texture',
    'dryness',
    'redness_inflammation',
  ]);
}

function countPhotoCheckpoints(entries: SkinJournalEntry[]): number {
  if (entries.length === 0) return 0;
  const referenceDate = isoDateToUtc(entries.at(-1)?.entry_date ?? '');
  const checkpoints = [
    [21, 45],
    [46, 75],
    [76, 105],
  ] as const;
  return checkpoints.filter(([from, to]) =>
    entries.some((entry) => {
      const daysAgo = daysBetween(entry.entry_date, referenceDate);
      return daysAgo >= from && daysAgo <= to;
    }),
  ).length;
}

function currentPhotoAngleCount(entry: SkinJournalEntry): number {
  return currentPhotoAngles(entry).length;
}

function currentPhotoAngles(entry: SkinJournalEntry): Angle[] {
  const perAngleQuality = entry.analysis_observations?.per_angle_quality;
  if (Array.isArray(perAngleQuality) && perAngleQuality.length > 0) {
    const seen = new Set<Angle>();
    for (const quality of perAngleQuality) {
      const angle = quality.angle;
      if (PHOTO_ANGLE_SET.has(angle) && !seen.has(angle)) {
        seen.add(angle);
      }
    }
    if (seen.size > 0) {
      return Array.from(seen);
    }
  }
  if (entry.photo_object_key || entry.analysis_observations) {
    return [SKIN_JOURNAL_FRONT_PHOTO_ANGLE];
  }
  return [];
}

function countReactionSignalsNearUse(
  usageDates: string[],
  journalEntries: SkinJournalEntry[],
  referenceDate: Date,
): number {
  if (usageDates.length === 0) return 0;
  const usageTimes = usageDates.map((date) => isoDateToUtc(date).getTime());
  return journalEntries.filter((entry) => {
    if (!inWindow(entry.entry_date, referenceDate, HISTORY_WINDOW_DAYS)) {
      return false;
    }
    if (!hasReactionSignal(entry)) return false;
    const entryTime = isoDateToUtc(entry.entry_date).getTime();
    return usageTimes.some((usageTime) => {
      const daysAfterUse = Math.floor((entryTime - usageTime) / DAY_MS);
      return daysAfterUse >= 0 && daysAfterUse <= REACTION_LOOKBACK_DAYS;
    });
  }).length;
}

function hasReactionSignal(entry: SkinJournalEntry): boolean {
  return Boolean(
    entry.has_reaction_signal ||
    entry.analysis_observations?.reaction_signals.reaction_detected ||
    entry.analysis_observations?.barrier_signs.barrier_compromise,
  );
}

function usageAdherence(
  usageDaysLast30: number,
  usageDaysLast90: number,
): SmartPicksProductAdherence {
  if (
    usageDaysLast30 >= CONSISTENT_USAGE_LAST_30 ||
    usageDaysLast90 >= CONSISTENT_USAGE_LAST_90
  ) {
    return SmartPicksProductAdherence.Consistent;
  }
  if (usageDaysLast90 > 0) return SmartPicksProductAdherence.Light;
  return SmartPicksProductAdherence.None;
}

function productGoalTrend(params: {
  adherence: SmartPicksProductAdherence;
  reactionSignalCount: number;
  photoTrendSignal: SmartPicksProductPerformanceSignal;
}): SmartPicksProductPerformanceSignal {
  if (params.reactionSignalCount >= REACTION_REPLACEMENT_THRESHOLD) {
    return SmartPicksProductPerformanceSignal.IrritationSignal;
  }
  if (params.adherence !== SmartPicksProductAdherence.Consistent) {
    return SmartPicksProductPerformanceSignal.InsufficientHistory;
  }
  return params.photoTrendSignal;
}

function shouldSuggestReplacement(params: {
  product: InventoryProduct;
  adherence: SmartPicksProductAdherence;
  goalTrend: SmartPicksProductPerformanceSignal;
  reactionSignalCount: number;
}): boolean {
  if (params.product.status === ShelfStatus.Archived) return false;
  if (
    params.goalTrend === SmartPicksProductPerformanceSignal.IrritationSignal
  ) {
    return params.reactionSignalCount >= REACTION_REPLACEMENT_THRESHOLD;
  }
  return (
    params.adherence === SmartPicksProductAdherence.Consistent &&
    params.goalTrend === SmartPicksProductPerformanceSignal.NotImproving &&
    PROGRESS_REPLACEABLE_CATEGORIES.has(params.product.category)
  );
}

function buildReplacementReason(params: {
  product: InventoryProduct;
  usageDaysLast90: number;
  photoCheckpoints: number;
  concernTrend: string | null;
  reactionSignalCount: number;
  goalTrend: SmartPicksProductPerformanceSignal;
}): string {
  if (
    params.goalTrend === SmartPicksProductPerformanceSignal.IrritationSignal
  ) {
    return `${params.product.brand} ${params.product.name} has ${params.usageDaysLast90} logged use days, and ${params.reactionSignalCount} reaction signals appeared within ${REACTION_LOOKBACK_DAYS} days of use. This is not proof of causation, but it is enough to consider a gentler replacement.`;
  }
  const concern = params.concernTrend ?? 'the tracked goal concern';
  return `${params.product.brand} ${params.product.name} has ${params.usageDaysLast90} logged use days, but photo history still shows ${concern} across ${params.photoCheckpoints} checkpoints. Smart Pick should suggest a replacement, not an extra product.`;
}

function inWindow(date: string, referenceDate: Date, days: number): boolean {
  const daysAgo = daysBetween(date, referenceDate);
  return daysAgo >= 0 && daysAgo <= days;
}

function daysBetween(date: string, referenceDate: Date): number {
  const targetTime = isoDateToUtc(date).getTime();
  const referenceTime = isoDateToUtc(toIsoDate(referenceDate)).getTime();
  return Math.floor((referenceTime - targetTime) / DAY_MS);
}

function shiftIsoDate(referenceDate: Date, days: number): string {
  const date = isoDateToUtc(toIsoDate(referenceDate));
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoDateToUtc(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function latestIsoDate(...dates: Array<string | null>): string | null {
  const values = dates.filter((date): date is string => Boolean(date));
  if (values.length === 0) return null;
  return values.sort().at(-1) ?? null;
}

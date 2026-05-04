import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ulid } from 'ulid';
import { toDateOnlyString, toTimeOnlyString } from '../../common/utils/date';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { RoutineStep } from '../../schedule/entities/routine-step.entity';
import { SkinJournalEntry } from '../../skin-journal/entities/skin-journal-entry.entity';
import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import { SuggestionContextCache } from '../entities/suggestion-context-cache.entity';
import { SuggestionContextSummary } from '../suggestion-context.types';
import {
  buildSafetyConstraints,
  skippedReasonsFromPolicy,
} from './suggestion-safety-policy';
import { scoreProductForSuggestion } from './suggestion-product-intelligence';

@Injectable()
export class SuggestionContextBuilder {
  constructor(
    @InjectRepository(SuggestionContextCache)
    private readonly contextCacheRepo: Repository<SuggestionContextCache>,
  ) {}

  async build(
    inputs: SuggestionContextBuilderInput,
  ): Promise<SuggestionContextSummary> {
    const normalizedInputs = {
      ...inputs,
      targetDate: toDateOnlyString(inputs.targetDate),
      targetTime: toTimeOnlyString(inputs.targetTime),
    };
    const cacheKey = buildCacheKey(normalizedInputs);
    const cached = await this.contextCacheRepo.findOne({
      where: {
        user_id: normalizedInputs.userId,
        context_date: normalizedInputs.targetDate,
        target_time: normalizedInputs.targetTime,
      },
    });
    if (cached?.cache_key === cacheKey && cached.summary) {
      return cached.summary;
    }

    const recentUseByProduct = buildRecentUseByProduct(
      normalizedInputs.recentApplications,
    );
    const lockedProductIds = new Set(
      normalizedInputs.routineSteps
        .filter(
          (step) => step.is_specialist_locked && step.inventory_product_id,
        )
        .map((step) => step.inventory_product_id as string),
    );
    const reaction = buildReactionSummary(
      normalizedInputs.recentJournalEntries,
      normalizedInputs.targetDate,
    );
    const productScores = normalizedInputs.shelfActiveProducts
      .map((product) =>
        scoreProductForSuggestion(product, {
          daypart: normalizedInputs.daypart,
          primaryGoal: normalizedInputs.skinProfile?.primary_goal ?? null,
          sensitivityLevel:
            normalizedInputs.skinProfile?.sensitivity_level ?? null,
          recentUseCount: recentUseByProduct.get(product.id) ?? 0,
          hasReactionSignal: reaction.hasSignal,
          lockedProductIds,
        }),
      )
      .sort((a, b) => b.suitabilityScore - a.suitabilityScore);
    const baseContext: SuggestionContextSummary = {
      cacheKey,
      builtAt: new Date().toISOString(),
      targetDate: normalizedInputs.targetDate,
      targetTime: normalizedInputs.targetTime,
      daypart: normalizedInputs.daypart,
      skinProfile: {
        primaryGoal: normalizedInputs.skinProfile?.primary_goal ?? null,
        skinType: normalizedInputs.skinProfile?.skin_type ?? null,
        sensitivityLevel:
          normalizedInputs.skinProfile?.sensitivity_level ?? null,
        activeConcerns: normalizedInputs.skinProfile?.current_concerns ?? [],
        pregnancyStatus: normalizedInputs.skinProfile?.pregnancy_status ?? null,
      },
      reaction,
      productScores,
      applicationPatterns: buildApplicationPatterns(
        normalizedInputs.recentApplications,
      ),
      safetyConstraints: [],
      skippedCandidates: [],
    };
    const summary = {
      ...baseContext,
      safetyConstraints: buildSafetyConstraints(baseContext),
      skippedCandidates: skippedReasonsFromPolicy(baseContext),
    };

    const cachePayload = {
      cache_key: cacheKey,
      summary,
    };
    if (cached) {
      await this.contextCacheRepo.update({ id: cached.id }, cachePayload);
    } else {
      try {
        await this.contextCacheRepo.insert(
          this.contextCacheRepo.create({
            id: ulid(),
            user_id: normalizedInputs.userId,
            context_date: normalizedInputs.targetDate,
            target_time: normalizedInputs.targetTime,
            cache_key: cacheKey,
            summary,
          }),
        );
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        await this.contextCacheRepo.update(
          {
            user_id: inputs.userId,
            context_date: normalizedInputs.targetDate,
            target_time: normalizedInputs.targetTime,
          },
          cachePayload,
        );
      }
    }
    return summary;
  }
}

export interface SuggestionContextBuilderInput {
  userId: string;
  targetDate: string;
  targetTime: string;
  daypart: 'morning' | 'noon' | 'evening';
  skinProfile: SkinProfile | null;
  shelfActiveProducts: InventoryProduct[];
  routineSteps: RoutineStep[];
  recentJournalEntries: SkinJournalEntry[];
  recentApplications: ApplicationLog[];
}

function buildReactionSummary(
  entries: SkinJournalEntry[],
  targetDate: string,
): SuggestionContextSummary['reaction'] {
  const reactionEntries = entries
    .slice()
    .sort(compareJournalRecency)
    .filter(
      (entry) =>
        entry.has_reaction_signal ||
        entry.analysis_observations?.reaction_signals?.reaction_detected ||
        entry.analysis_observations?.barrier_signs?.barrier_compromise,
    );
  const latest = reactionEntries[0] ?? null;
  const observations = latest?.analysis_observations ?? null;
  const concerns = entries.flatMap(
    (entry) => entry.analysis_observations?.detected_concerns ?? [],
  );
  const reactionConcerns = concerns.filter((concern) =>
    [
      'redness_inflammation',
      'dryness',
      'skin_barrier_damage',
      'eczema_indicator',
      'acne',
    ].includes(concern.concern),
  );
  return {
    hasSignal: Boolean(latest),
    severity: observations?.reaction_signals?.reaction_severity ?? null,
    confidence: observations?.reaction_signals?.confidence ?? null,
    indicators: [
      ...(observations?.reaction_signals?.indicators ?? []),
      ...(observations?.barrier_signs?.indicators ?? []),
    ],
    affectedZones: unique(
      reactionConcerns.flatMap((concern) => concern.locations),
    ),
    concernKeys: unique(reactionConcerns.map((concern) => concern.concern)),
    daysSinceLatestSignal: latest
      ? daysBetween(latest.entry_date, targetDate)
      : null,
    barrierCompromised: Boolean(
      observations?.barrier_signs?.barrier_compromise ||
      reactionConcerns.some(
        (concern) => concern.concern === 'skin_barrier_damage',
      ),
    ),
  };
}

function buildApplicationPatterns(
  logs: ApplicationLog[],
): SuggestionContextSummary['applicationPatterns'] {
  const skippedByCategory: Record<string, number> = {};
  const substitutedByCategory: Record<string, number> = {};
  const adherenceByCategory: Record<string, number> = {};
  let addedOffShelfCount = 0;
  let editedLogCount = 0;
  for (const log of logs) {
    if (log.has_been_edited) editedLogCount += 1;
    for (const item of log.items ?? []) {
      const category = item.step_label ?? 'unknown';
      if (item.status === 'skipped') increment(skippedByCategory, category);
      if (item.status === 'substituted')
        increment(substitutedByCategory, category);
      if (item.status === 'applied') increment(adherenceByCategory, category);
      if (item.is_ad_hoc) addedOffShelfCount += 1;
    }
  }
  return {
    days: unique(logs.map((log) => toDateOnlyString(log.target_date))).length,
    skippedByCategory,
    substitutedByCategory,
    addedOffShelfCount,
    editedLogCount,
    adherenceByCategory,
  };
}

function buildRecentUseByProduct(logs: ApplicationLog[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const log of logs) {
    for (const item of log.items ?? []) {
      const productId =
        item.status === 'substituted'
          ? item.substituted_with_product_id
          : item.inventory_product_id;
      if (productId && item.status !== 'skipped') {
        map.set(productId, (map.get(productId) ?? 0) + 1);
      }
    }
  }
  return map;
}

function buildCacheKey(inputs: SuggestionContextBuilderInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        targetDate: inputs.targetDate,
        targetTime: inputs.targetTime,
        profile: inputs.skinProfile?.updated_at?.toISOString() ?? null,
        routineSteps: inputs.routineSteps
          .slice()
          .sort(
            (a, b) => a.step_order - b.step_order || a.id.localeCompare(b.id),
          )
          .map((step) => [
            step.id,
            step.updated_at?.toISOString() ?? null,
            step.inventory_product_id,
            step.step_order,
            step.step_label,
            step.is_specialist_locked,
          ]),
        products: inputs.shelfActiveProducts
          .slice()
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((product) => [
            product.id,
            product.updated_at?.toISOString() ?? null,
            product.status,
          ]),
        journals: inputs.recentJournalEntries
          .slice()
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((entry) => [
            entry.id,
            entry.updated_at?.toISOString() ?? null,
            entry.has_reaction_signal,
          ]),
        logs: inputs.recentApplications
          .slice()
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((log) => [
            log.id,
            log.updated_at?.toISOString() ?? null,
            log.edit_count,
            log.has_been_edited,
            (log.items ?? [])
              .slice()
              .sort(
                (a, b) =>
                  a.step_order - b.step_order ||
                  (a.id ?? '').localeCompare(b.id ?? ''),
              )
              .map((item) => [
                item.id,
                item.status,
                item.item_source,
                item.inventory_product_id,
                item.substituted_with_product_id,
                item.suggestion_step_id,
                item.is_ad_hoc,
              ]),
          ]),
      }),
    )
    .digest('hex')
    .slice(0, 32);
}

function daysBetween(fromDate: string, toDate: string): number {
  const from = new Date(`${toDateOnlyString(fromDate)}T00:00:00Z`).getTime();
  const to = new Date(`${toDateOnlyString(toDate)}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

function compareJournalRecency(
  first: SkinJournalEntry,
  second: SkinJournalEntry,
): number {
  const firstDate = toDateOnlyString(first.entry_date);
  const secondDate = toDateOnlyString(second.entry_date);
  if (firstDate !== secondDate) {
    return firstDate < secondDate ? 1 : -1;
  }
  const firstUpdated = first.updated_at?.getTime() ?? 0;
  const secondUpdated = second.updated_at?.getTime() ?? 0;
  return secondUpdated - firstUpdated;
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

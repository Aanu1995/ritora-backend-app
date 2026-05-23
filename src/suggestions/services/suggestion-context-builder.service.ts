import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ulid } from 'ulid';
import { isPostgresUniqueConstraintError } from '../../common/utils/database-errors';
import { toDateOnlyString, toTimeOnlyString } from '../../common/utils/date';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { IngredientIntelligenceService } from '../../ingredients/ingredient-intelligence.service';
import type { ProductForAnalysis } from '../../ingredients/ingredients.types';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { RoutineStep } from '../../schedule/entities/routine-step.entity';
import { SkinJournalEntry } from '../../skin-journal/entities/skin-journal-entry.entity';
import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import type { EnvironmentContextSummary } from '../../environment-intelligence/environment-intelligence.types';
import { buildEnvironmentAdaptationPolicy } from '../../environment-intelligence/environment-adaptation-policy';
import { RoutineBreak } from '../entities/routine-break.entity';
import { SuggestionContextCache } from '../entities/suggestion-context-cache.entity';
import { SuggestionContextSummary } from '../suggestion-context.types';
import {
  SUGGESTION_CONSERVATIVE_RESTART_AFTER_DAYS,
  SUGGESTION_SAFETY_POLICY_REVIEWED_AT,
  SUGGESTION_SAFETY_POLICY_VERSION,
  SuggestionDaypart,
  SuggestionRequestContextJson,
  SuggestionRequestSource,
} from '../suggestions.constants';
import {
  buildSafetyConstraints,
  skippedReasonsFromPolicy,
} from './suggestion-safety-policy';
import {
  getSuggestionEvidenceSources,
  mergeEvidenceSourceIds,
} from './suggestion-evidence-sources';
import {
  scoreProductForSuggestion,
  type ProductIngredientIntelligence,
} from './suggestion-product-intelligence';
import { buildRoutineBreakSummary } from './suggestion-routine-break-context';
import { buildSuggestionContextCacheKey } from './suggestion-context-cache-key';
import {
  currentJournalPhotoAngleCount,
  hasMultiAngleJournalPhoto,
  hasUsableJournalReactionSignal,
} from './suggestion-journal-context';
@Injectable()
export class SuggestionContextBuilder {
  constructor(
    @InjectRepository(SuggestionContextCache)
    private readonly contextCacheRepo: Repository<SuggestionContextCache>,
    @Optional()
    private readonly ingredientIntelligence?: IngredientIntelligenceService,
  ) {}

  async build(
    inputs: SuggestionContextBuilderInput,
  ): Promise<SuggestionContextSummary> {
    const normalizedInputs = {
      ...inputs,
      targetDate: toDateOnlyString(inputs.targetDate),
      targetTime: toTimeOnlyString(inputs.targetTime),
      requestSource: inputs.requestSource ?? SuggestionRequestSource.Scheduled,
      requestContext: inputs.requestContext ?? null,
      environment: inputs.environment ?? null,
    };
    const cacheKey = buildSuggestionContextCacheKey(normalizedInputs);
    const shouldCache =
      normalizedInputs.requestSource === SuggestionRequestSource.Scheduled;
    const cached = shouldCache
      ? await this.contextCacheRepo.findOne({
          where: {
            user_id: normalizedInputs.userId,
            context_date: normalizedInputs.targetDate,
            target_time: normalizedInputs.targetTime,
          },
        })
      : null;
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
    const applicationPatterns = buildApplicationPatterns(
      normalizedInputs.recentApplications,
      normalizedInputs.targetDate,
    );
    const ingredientIntelligenceByProductId =
      await buildIngredientIntelligenceByProductId(
        this.ingredientIntelligence,
        normalizedInputs.shelfActiveProducts,
      );
    const environmentPolicy = buildEnvironmentAdaptationPolicy(
      normalizedInputs.environment,
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
          conservativeRestart: applicationPatterns.conservativeRestart,
          ingredientIntelligence: ingredientIntelligenceByProductId.get(
            product.id,
          ),
          environment: normalizedInputs.environment,
        }),
      )
      .sort((a, b) => b.suitabilityScore - a.suitabilityScore);
    const baseContext: SuggestionContextSummary = {
      cacheKey,
      builtAt: new Date().toISOString(),
      targetDate: normalizedInputs.targetDate,
      targetTime: normalizedInputs.targetTime,
      daypart: normalizedInputs.daypart,
      requestSource: normalizedInputs.requestSource,
      onDemand: normalizedInputs.requestContext,
      skinProfile: {
        primaryGoal: normalizedInputs.skinProfile?.primary_goal ?? null,
        skinType: normalizedInputs.skinProfile?.skin_type ?? null,
        sensitivityLevel:
          normalizedInputs.skinProfile?.sensitivity_level ?? null,
        activeConcerns: normalizedInputs.skinProfile?.current_concerns ?? [],
        pregnancyStatus: normalizedInputs.skinProfile?.pregnancy_status ?? null,
      },
      reaction,
      routineBreak: buildRoutineBreakSummary(
        normalizedInputs.recentRoutineBreaks ?? [],
        normalizedInputs.targetDate,
      ),
      environment: normalizedInputs.environment,
      productScores,
      applicationPatterns,
      safetyConstraints: [],
      governance: {
        safetyPolicyVersion: SUGGESTION_SAFETY_POLICY_VERSION,
        safetyPolicyReviewedAt: SUGGESTION_SAFETY_POLICY_REVIEWED_AT,
        aiPersonalizationAllowed:
          normalizedInputs.aiPersonalizationAllowed ?? true,
        aiPersonalizationBlockedReason:
          normalizedInputs.aiPersonalizationBlockedReason ?? null,
      },
      evidenceSources: [],
      skippedCandidates: [],
    };
    const skippedCandidates = skippedReasonsFromPolicy(baseContext);
    const summary = {
      ...baseContext,
      safetyConstraints: [
        ...buildSafetyConstraints(baseContext),
        ...environmentPolicy.safetyConstraints,
      ],
      skippedCandidates,
      evidenceSources: getSuggestionEvidenceSources(
        mergeEvidenceSourceIds(
          ...productScores.map((product) => product.evidenceSourceIds),
          ...skippedCandidates.map((candidate) => candidate.sourceIds),
          normalizedInputs.environment?.sourceIds ?? [],
          ...environmentPolicy.signals.map((signal) => signal.sourceIds),
        ),
      ),
    };

    if (!shouldCache) {
      return summary;
    }

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
        if (!isPostgresUniqueConstraintError(error)) throw error;
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
  daypart: SuggestionDaypart;
  requestSource?: SuggestionRequestSource;
  requestContext?: SuggestionRequestContextJson | null;
  skinProfile: SkinProfile | null;
  shelfActiveProducts: InventoryProduct[];
  routineSteps: RoutineStep[];
  recentJournalEntries: SkinJournalEntry[];
  recentApplications: ApplicationLog[];
  recentRoutineBreaks?: RoutineBreak[];
  environment?: EnvironmentContextSummary | null;
  aiPersonalizationAllowed?: boolean;
  aiPersonalizationBlockedReason?: string | null;
}

function buildReactionSummary(
  entries: SkinJournalEntry[],
  targetDate: string,
): SuggestionContextSummary['reaction'] {
  const reactionEntries = entries
    .slice()
    .sort(compareJournalRecency)
    .filter(hasUsableJournalReactionSignal);
  const latest = reactionEntries[0] ?? null;
  const observations = latest?.analysis_observations ?? null;
  const concerns = entries.flatMap(
    (entry) => entry.analysis_observations?.detected_concerns ?? [],
  );
  const photoInputImages = entries.reduce(
    (sum, entry) => sum + currentJournalPhotoAngleCount(entry),
    0,
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
    photoInputImages,
    multiAnglePhotoEntries: entries.filter(hasMultiAngleJournalPhoto).length,
  };
}

function buildApplicationPatterns(
  logs: ApplicationLog[],
  targetDate: string,
): SuggestionContextSummary['applicationPatterns'] {
  const skippedByCategory: Record<string, number> = {};
  const substitutedByCategory: Record<string, number> = {};
  const adherenceByCategory: Record<string, number> = {};
  let addedOffShelfCount = 0;
  let editedLogCount = 0;
  const applicationDates = logs
    .map((log) => toDateOnlyString(log.target_date))
    .filter((date) => date <= toDateOnlyString(targetDate))
    .sort((a, b) => (a < b ? 1 : -1));
  const daysSinceLastApplication = applicationDates[0]
    ? daysBetween(applicationDates[0], targetDate)
    : null;
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
    daysSinceLastApplication,
    conservativeRestart:
      daysSinceLastApplication === null ||
      daysSinceLastApplication >= SUGGESTION_CONSERVATIVE_RESTART_AFTER_DAYS,
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

async function buildIngredientIntelligenceByProductId(
  ingredientIntelligence: IngredientIntelligenceService | undefined,
  products: InventoryProduct[],
): Promise<Map<string, ProductIngredientIntelligence>> {
  const map = new Map<string, ProductIngredientIntelligence>();
  if (!ingredientIntelligence) return map;

  const matches = await ingredientIntelligence.matchProducts(
    products.map(toAnalysisProduct),
  );
  for (const match of matches) {
    map.set(match.product.id, {
      matchedIngredientCount: match.matchedIngredients.length,
      totalIngredientCount: match.totalTokens,
    });
  }
  return map;
}

function toAnalysisProduct(product: InventoryProduct): ProductForAnalysis {
  return {
    id: product.id,
    brand: product.brand,
    name: product.name,
    category: product.category,
    inciIngredients: product.identity?.inciIngredients ?? [],
  };
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

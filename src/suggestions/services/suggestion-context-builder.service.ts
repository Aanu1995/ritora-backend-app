import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ulid } from 'ulid';
import { isPostgresUniqueConstraintError } from '../../common/utils/database-errors';
import { toDateOnlyString, toTimeOnlyString } from '../../common/utils/date';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { IngredientIntelligenceService } from '../../ingredients/ingredient-intelligence.service';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { RoutineStep } from '../../schedule/entities/routine-step.entity';
import { SkinJournalEntry } from '../../skin-journal/entities/skin-journal-entry.entity';
import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import type { EnvironmentContextSummary } from '../../environment-intelligence/environment-intelligence.types';
import { buildEnvironmentAdaptationPolicy } from '../../environment-intelligence/environment-adaptation-policy';
import { RoutineBreak } from '../entities/routine-break.entity';
import { SuggestionContextCache } from '../entities/suggestion-context-cache.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { SuggestionContextSummary } from '../suggestion-context.types';
import {
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
import { scoreProductForSuggestion } from './suggestion-product-intelligence';
import { buildRoutineBreakSummary } from './suggestion-routine-break-context';
import { buildSuggestionContextCacheKey } from './suggestion-context-cache-key';
import {
  buildApplicationPatterns,
  buildApplicationProductSignals,
  buildAppliedProductHistory,
  buildRecentUseByProduct,
} from './suggestion-application-history';
import { buildEnvironmentSignals } from './suggestion-environment-signals';
import { buildIngredientIntelligenceByProductId } from './suggestion-ingredient-context';
import {
  buildJournalSignals,
  buildReactionSummary,
} from './suggestion-journal-signals';
import {
  buildGoalSignals,
  buildProfileSignals,
} from './suggestion-profile-context';
import { buildRoutineMemory } from './suggestion-routine-memory-context';

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

    const goalSignals = buildGoalSignals(normalizedInputs.skinProfile);
    const profileSignals = buildProfileSignals(normalizedInputs.skinProfile);
    const journalSignals = buildJournalSignals(
      normalizedInputs.recentJournalEntries,
    );
    const appliedProductHistory = buildAppliedProductHistory(
      normalizedInputs.recentApplications,
      normalizedInputs.targetDate,
    );
    const routineMemory = buildRoutineMemory(
      normalizedInputs.recentApplications,
      normalizedInputs.recentSuggestions ?? [],
      normalizedInputs.daypart,
    );
    const applicationProductSignals = buildApplicationProductSignals(
      normalizedInputs.recentApplications,
      normalizedInputs.targetDate,
    );
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
          secondaryGoals: goalSignals.secondaryGoals.map(
            (signal) => signal.concern,
          ),
          sensitivityLevel:
            normalizedInputs.skinProfile?.sensitivity_level ?? null,
          recentUseCount: recentUseByProduct.get(product.id) ?? 0,
          adherenceCount:
            applicationProductSignals.get(product.id)?.adheredCount ?? 0,
          reactionSkipCount:
            applicationProductSignals.get(product.id)?.reactionSkipCount ?? 0,
          substitutionCount:
            applicationProductSignals.get(product.id)?.substitutedAwayCount ??
            0,
          recentSameDaypartSuggestionCount:
            routineMemory.recentSameDaypartFingerprints.filter((fingerprint) =>
              fingerprint.productIds.includes(product.id),
            ).length,
          hasReactionSignal: reaction.hasSignal,
          lockedProductIds,
          conservativeRestart: applicationPatterns.conservativeRestart,
          ingredientIntelligence: ingredientIntelligenceByProductId.get(
            product.id,
          ),
          environment: normalizedInputs.environment,
          targetDate: normalizedInputs.targetDate,
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
      goalSignals,
      profileSignals,
      reaction,
      journalSignals,
      routineBreak: buildRoutineBreakSummary(
        normalizedInputs.recentRoutineBreaks ?? [],
        normalizedInputs.targetDate,
      ),
      environment: normalizedInputs.environment,
      environmentSignals: buildEnvironmentSignals(environmentPolicy),
      appliedProductHistory,
      routineMemory,
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
    const summary: SuggestionContextSummary = {
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
  recentSuggestions?: SuggestionInstance[];
  recentRoutineBreaks?: RoutineBreak[];
  environment?: EnvironmentContextSummary | null;
  aiPersonalizationAllowed?: boolean;
  aiPersonalizationBlockedReason?: string | null;
}

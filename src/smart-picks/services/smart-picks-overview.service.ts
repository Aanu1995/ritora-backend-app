import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Not, Repository } from 'typeorm';
import {
  AppLanguage,
  DEFAULT_LANGUAGE,
  normalizeLanguage,
} from '../../common/i18n/i18n';
import { toIsoString } from '../../common/utils/date';
import { buildEnvironmentAdaptationPolicy } from '../../environment-intelligence/environment-adaptation-policy';
import type { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import { ProductCategory } from '../../shelf/shelf.types';
import type { ConcernDetails } from '../../skin-profile/entities/skin-profile.entity';
import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import { normalizeSuggestionGapKey } from '../../suggestions/services/suggestion-gap-actions';
import { mergeEvidenceSourceIds } from '../../suggestions/services/suggestion-evidence-sources';
import {
  SuggestionEvidenceSourceId,
  SuggestionGapActionKind,
} from '../../suggestions/suggestions.constants';
import { User } from '../../users/entities/user.entity';
import { SuggestionGapAction } from '../../suggestions/entities/suggestion-gap-action.entity';
import { SuggestionObservabilityService } from '../../suggestions/services/suggestion-observability.service';
import { SmartPickProductSuggestion } from '../entities/smart-pick-product-suggestion.entity';
import { SmartPickSnapshot } from '../entities/smart-pick-snapshot.entity';
import {
  SmartPicksBudgetTier,
  type SmartPicksAiUsageMetrics,
  SmartPicksCoverage,
  SmartPicksEmptyReason,
  SmartPicksEmptyState,
  SmartPicksGap,
  SmartPicksGenerationJobStatus,
  SmartPicksGapKind,
  SmartPicksGapSnapshot,
  SmartPicksHistoryReadiness,
  SmartPicksHistoryReadinessReason,
  SmartPicksMode,
  SmartPicksOverview,
  SmartPicksProductPerformanceSignal,
  SmartPicksProductGenerationReason,
  SmartPicksProductGenerationState,
  SmartPicksProductGenerationStatus,
  SmartPicksProductPerformanceSummary,
  SmartPicksProductPick,
  SmartPicksRecap,
  SmartPicksRedundancyGroup,
  SmartPicksSnapshotPayload,
  SmartPicksStarterKit,
  SmartPicksStarterKitStep,
  SmartPicksStarterKitStepStatus,
} from '../smart-picks.types';
import {
  SmartPicksAiGenerationDiagnostics,
  SmartPicksAiPlanDiagnostics,
  GeneratedSmartPick,
  SmartPicksAiGenerator,
  SmartPicksAiProviderSkippedReason,
} from './smart-picks-ai-generator';
import {
  SmartPicksContext,
  SmartPicksContextBuilder,
} from './smart-picks-context-builder';
import { SmartPicksGenerationQueueService } from './smart-picks-generation-queue.service';
import { buildGoalGapCandidates } from './smart-picks-goal-gap-policy';
import {
  buildSmartPicksCoveredItems,
  localizeSmartPicksGapText,
  localizeSmartPicksCoveredItems,
  localizeSmartPicksRedundancyGroups,
  smartPicksStarterCoveredReason,
  smartPicksStarterKitSummary,
  smartPicksStarterStepTitle,
  smartPicksStarterWaitReason,
} from './smart-picks-localization';
import { SmartPicksRedundancyService } from './smart-picks-redundancy.service';

const DISMISSAL_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_REPLACEMENT_USAGE_DAYS = 20;
const MIN_REPLACEMENT_PHOTO_CHECKPOINTS = 2;
const SMART_PICKS_AI_GAP_BATCH_SIZE = 2;
const PRODUCT_GENERATION_RETRY_COOLDOWN_MS = 5 * 60 * 1000;
type StarterTreatmentDecision = {
  ingredientOrCategory: string;
  goalAlignment: string;
  reason: string;
  sourceIds: SuggestionEvidenceSourceId[];
  alignmentSignals: readonly string[];
};

type StarterTreatmentDecisionInput = {
  primaryGoal: string | null;
  currentConcerns: readonly string[];
  concernDetails: ConcernDetails | null;
  pregnancyStatus: string | null;
};

type SmartPickActionSummary = {
  dismissedKeys: Set<string>;
  savedSuggestionIds: Set<string>;
  dismissedGapCount: number;
  nextEligibleAt: Date | null;
};

type ProductGenerationIssue = {
  status:
    | typeof SmartPicksProductGenerationStatus.Failed
    | typeof SmartPicksProductGenerationStatus.Skipped;
  reason: SmartPicksProductGenerationReason;
  attemptedAt: Date;
  missingPickCount: number;
};

@Injectable()
export class SmartPicksOverviewService {
  private readonly logger = new Logger(SmartPicksOverviewService.name);
  private readonly backgroundGenerationJobs = new Map<
    string,
    Promise<SmartPicksProductGenerationState>
  >();
  private readonly productGenerationIssues = new Map<
    string,
    ProductGenerationIssue
  >();

  constructor(
    private readonly contextBuilder: SmartPicksContextBuilder,
    private readonly redundancyService: SmartPicksRedundancyService,
    private readonly aiGenerator: SmartPicksAiGenerator,
    private readonly notifications: NotificationsService,
    private readonly observability: SuggestionObservabilityService,
    @InjectRepository(SmartPickSnapshot)
    private readonly snapshotRepo: Repository<SmartPickSnapshot>,
    @InjectRepository(SmartPickProductSuggestion)
    private readonly productSuggestionRepo: Repository<SmartPickProductSuggestion>,
    @InjectRepository(SuggestionGapAction)
    private readonly gapActionRepo: Repository<SuggestionGapAction>,
    @InjectRepository(SkinProfile)
    private readonly skinProfileRepo: Repository<SkinProfile>,
    @Optional()
    private readonly generationQueue?: SmartPicksGenerationQueueService,
  ) {}

  async getOverview(
    user: User,
    requestedMode: SmartPicksMode | null = null,
    language: AppLanguage = normalizeLanguage(user.preferred_language),
  ): Promise<SmartPicksOverview> {
    const context = await this.contextBuilder.build(user, requestedMode);
    if (context.skinProfileRequired || context.consentRequired) {
      return this.emptyOverview(context);
    }

    const cached = await this.snapshotRepo.findOne({
      where: { user_id: user.id, mode: context.mode },
    });
    if (cached && isFreshSnapshot(cached, context)) {
      return this.hydrateOverview(context, cached, language);
    }

    const previousPriorityKeys = new Set(
      (cached?.gaps_json ?? [])
        .filter((gap) => gap.priority === 'priority')
        .map((gap) => gap.normalizedKey),
    );
    const snapshotPayload = await this.buildSnapshotPayload(context);
    if (!snapshotPayload) {
      return this.aiPlanUnavailableOverview(context);
    }
    const snapshot = await this.saveSnapshot(context, snapshotPayload, cached);
    await this.pruneStaleProductSuggestions(context);
    await this.maybeDispatchReadyNotification(
      context,
      previousPriorityKeys,
      snapshotPayload.priorityGaps,
    );
    return this.hydrateOverview(context, snapshot, language);
  }

  async waitForBackgroundGeneration(): Promise<void> {
    while (this.backgroundGenerationJobs.size > 0) {
      await Promise.allSettled(this.backgroundGenerationJobs.values());
    }
  }

  async generateProductPicksForJob(
    user: User,
    mode: SmartPicksMode,
    inputsHash: string,
  ): Promise<SmartPicksProductGenerationState> {
    const context = await this.contextBuilder.build(user, mode);
    if (
      context.skinProfileRequired ||
      context.consentRequired ||
      context.inputsHash !== inputsHash
    ) {
      return readyProductGenerationState();
    }

    const cached = await this.snapshotRepo.findOne({
      where: { user_id: user.id, mode: context.mode },
    });
    let snapshot: SmartPickSnapshot;
    if (cached && isFreshSnapshot(cached, context)) {
      snapshot = cached;
    } else {
      const snapshotPayload = await this.buildSnapshotPayload(context);
      if (!snapshotPayload) {
        return failedAiPlanningGenerationState();
      }
      snapshot = await this.saveSnapshot(context, snapshotPayload, cached);
    }

    const gaps = (snapshot.gaps_json ?? []).map(normalizeGapSnapshot);
    const suggestions = await this.productSuggestionRepo.find({
      where: { user_id: context.user.id, inputs_hash: context.inputsHash },
    });
    const generatedKeys = new Set(
      suggestions.map((suggestion) => suggestion.normalized_key),
    );
    const actionSummary = await this.loadActionSummary(
      context.user.id,
      gaps.map((gap) => gap.normalizedKey),
    );
    const missingGenerationGaps = gaps.filter(
      (gap) =>
        !generatedKeys.has(gap.normalizedKey) &&
        !actionSummary.dismissedKeys.has(gap.normalizedKey),
    );

    return this.generateProductPicks(context, missingGenerationGaps);
  }

  async updateBudget(
    user: User,
    budgetTier: SmartPicksBudgetTier,
    language: AppLanguage = normalizeLanguage(user.preferred_language),
  ): Promise<SmartPicksOverview> {
    const profile = await this.skinProfileRepo.findOne({
      where: { user_id: user.id },
    });
    if (!profile) {
      throw new NotFoundException('Skin profile not found.');
    }
    profile.budget_tier = budgetTier;
    await this.skinProfileRepo.save(profile);
    await this.snapshotRepo.delete({ user_id: user.id });
    return this.getOverview(user, null, language);
  }

  private async buildSnapshotPayload(
    context: SmartPicksContext,
  ): Promise<SmartPicksSnapshotPayload | null> {
    const { plan, diagnostics } =
      await this.aiGenerator.generatePlanWithDiagnostics(context);
    await this.recordPlanDiagnostics(context, diagnostics);
    if (!plan) return null;

    const recap = buildRecap(context);

    return {
      recap,
      coverage: plan.coverage,
      priorityGaps: plan.priorityGaps,
      considerGaps: plan.considerGaps,
      covered: buildSmartPicksCoveredItems(plan.coverage, DEFAULT_LANGUAGE),
      redundancy: this.redundancyService.detect(
        context.activeProducts,
        DEFAULT_LANGUAGE,
      ),
      aiUsage: aiUsageFromPlanDiagnostics(diagnostics),
    };
  }

  private async recordPlanDiagnostics(
    context: SmartPicksContext,
    diagnostics: SmartPicksAiPlanDiagnostics,
  ): Promise<void> {
    const privacySafeBase = {
      mode: context.mode,
      rawCoverageSlotCount: diagnostics.rawCoverageSlotCount,
      acceptedCoverageSlotCount: diagnostics.acceptedCoverageSlotCount,
      rawGapCount: diagnostics.rawGapCount,
      acceptedGapCount: diagnostics.acceptedGapCount,
    };

    if (
      diagnostics.providerFailed ||
      diagnostics.providerSkippedReason ||
      diagnostics.missingPlan
    ) {
      await this.observability.record({
        kind: 'smart_pick_ai_failed',
        severity: 'warning',
        userId: context.user.id,
        metadata: {
          ...privacySafeBase,
          providerFailed: diagnostics.providerFailed,
          providerSkippedReason: diagnostics.providerSkippedReason,
          missingPlan: diagnostics.missingPlan,
          stage: 'plan',
        },
      });
    }

    if (
      diagnostics.blockedSafetyGapCount > 0 ||
      diagnostics.blockedPregnancySafetyGapCount > 0
    ) {
      await this.observability.record({
        kind: 'smart_pick_unsafe_output_blocked',
        severity: 'warning',
        userId: context.user.id,
        metadata: {
          ...privacySafeBase,
          blockedSafetyGapCount: diagnostics.blockedSafetyGapCount,
          blockedPregnancySafetyGapCount:
            diagnostics.blockedPregnancySafetyGapCount,
          stage: 'plan',
        },
      });
    }

    const blockedOrInvalidCount =
      diagnostics.invalidCoverageSlotCount +
      diagnostics.invalidGapCount +
      diagnostics.blockedOwnedGapCount +
      diagnostics.blockedReplacementEvidenceGapCount;
    if (blockedOrInvalidCount > 0) {
      await this.observability.record({
        kind: 'smart_pick_quality_drift',
        severity: 'warning',
        userId: context.user.id,
        metadata: {
          ...privacySafeBase,
          invalidCoverageSlotCount: diagnostics.invalidCoverageSlotCount,
          invalidGapCount: diagnostics.invalidGapCount,
          blockedOwnedGapCount: diagnostics.blockedOwnedGapCount,
          blockedReplacementEvidenceGapCount:
            diagnostics.blockedReplacementEvidenceGapCount,
          stage: 'plan',
        },
      });
    }

    if (
      diagnostics.missingPlan ||
      (diagnostics.rawGapCount > 0 && diagnostics.acceptedGapCount === 0)
    ) {
      await this.observability.record({
        kind: 'smart_pick_no_pick',
        severity: 'warning',
        userId: context.user.id,
        metadata: {
          ...privacySafeBase,
          missingPlan: diagnostics.missingPlan,
          stage: 'plan',
        },
      });
    }
  }

  private async saveSnapshot(
    context: SmartPicksContext,
    payload: SmartPicksSnapshotPayload,
    existing: SmartPickSnapshot | null,
  ): Promise<SmartPickSnapshot> {
    const now = new Date();
    const snapshot = this.snapshotRepo.create({
      ...(existing ?? {}),
      user_id: context.user.id,
      mode: context.mode,
      coverage_json: payload.coverage,
      gaps_json: [...payload.priorityGaps, ...payload.considerGaps],
      covered_json: payload.covered,
      redundancy_json: payload.redundancy,
      recap_json: payload.recap,
      inputs_hash: context.inputsHash,
      generated_at: now,
      ai_model: payload.aiUsage?.model ?? null,
      ai_input_tokens: payload.aiUsage?.inputTokens ?? null,
      ai_output_tokens: payload.aiUsage?.outputTokens ?? null,
      ai_total_tokens: payload.aiUsage?.totalTokens ?? null,
      ai_estimated_cost_usd: payload.aiUsage?.estimatedCostUsd ?? null,
    });
    return this.snapshotRepo.save(snapshot);
  }

  private async hydrateOverview(
    context: SmartPicksContext,
    snapshot: SmartPickSnapshot,
    language: AppLanguage,
  ): Promise<SmartPicksOverview> {
    const gaps = (snapshot.gaps_json ?? []).map(normalizeGapSnapshot);
    const suggestions = await this.productSuggestionRepo.find({
      where: { user_id: context.user.id, inputs_hash: context.inputsHash },
    });
    const suggestionsByKey = new Map(
      suggestions.map((suggestion) => [suggestion.normalized_key, suggestion]),
    );
    const actionSummary = await this.loadActionSummary(
      context.user.id,
      gaps.map((gap) => gap.normalizedKey),
    );
    const toGap = (gap: SmartPicksGapSnapshot): SmartPicksGap | null => {
      if (actionSummary.dismissedKeys.has(gap.normalizedKey)) return null;
      const suggestion = suggestionsByKey.get(gap.normalizedKey) ?? null;
      const action =
        suggestion && actionSummary.savedSuggestionIds.has(suggestion.id)
          ? 'saved'
          : null;
      const localizedGap = localizeSmartPicksGapText(gap, language);
      return {
        ...localizedGap,
        pick: suggestion ? toProductPick(suggestion, action) : null,
      };
    };
    const priorityGaps = gaps
      .filter((gap) => gap.priority === 'priority')
      .map(toGap)
      .filter((gap): gap is SmartPicksGap => Boolean(gap));
    const considerGaps = gaps
      .filter((gap) => gap.priority === 'consider')
      .map(toGap)
      .filter((gap): gap is SmartPicksGap => Boolean(gap));
    const visibleGaps = [...priorityGaps, ...considerGaps];
    const productSuggestionsUnavailable = visibleGaps.some((gap) => !gap.pick);
    const missingGenerationGaps = gaps.filter(
      (gap) =>
        !suggestionsByKey.has(gap.normalizedKey) &&
        !actionSummary.dismissedKeys.has(gap.normalizedKey),
    );
    let productGeneration = await this.resolveProductGenerationState(
      context,
      missingGenerationGaps.length,
    );
    if (
      productGeneration.status === SmartPicksProductGenerationStatus.Pending
    ) {
      if (this.generationQueue) {
        const generationJob = await this.generationQueue.enqueueForContext(
          context,
          missingGenerationGaps.length,
        );
        productGeneration = {
          ...productGeneration,
          isProcessing: Boolean(generationJob),
        };
      } else {
        this.enqueueProductPickGeneration(context, missingGenerationGaps);
        productGeneration = {
          ...productGeneration,
          isProcessing: missingGenerationGaps.length > 0,
        };
      }
    }
    const starterKit =
      context.mode === 'starter'
        ? buildStarterKit(
            context,
            snapshot.coverage_json,
            visibleGaps,
            language,
          )
        : emptyStarterKit();
    const covered = localizeSmartPicksCoveredItems(
      snapshot.covered_json ?? [],
      language,
    );
    const redundancy = localizeSmartPicksRedundancyGroups(
      snapshot.redundancy_json ?? [],
      language,
    );

    return {
      mode: snapshot.mode,
      generatedAt: toIsoString(snapshot.generated_at),
      inputsHash: snapshot.inputs_hash,
      recap: snapshot.recap_json,
      coverage: snapshot.coverage_json,
      priorityGaps,
      considerGaps,
      covered,
      redundancy,
      consentRequired: false,
      skinProfileRequired: false,
      productSuggestionsUnavailable,
      productGeneration,
      emptyState: buildEmptyState(context, {
        visibleGapCount: visibleGaps.length,
        snapshotGapCount: gaps.length,
        dismissedGapCount: actionSummary.dismissedGapCount,
        nextEligibleAt: actionSummary.nextEligibleAt,
        redundancy,
        productSuggestionsUnavailable,
      }),
      starterKit,
    };
  }

  private emptyOverview(context: SmartPicksContext): SmartPicksOverview {
    const recap = buildRecap(context);
    return {
      mode: context.mode,
      generatedAt: new Date().toISOString(),
      inputsHash: context.inputsHash,
      recap,
      coverage: { slots: [], filled: 0, total: 0 },
      priorityGaps: [],
      considerGaps: [],
      covered: [],
      redundancy: [],
      consentRequired: context.consentRequired,
      skinProfileRequired: context.skinProfileRequired,
      productSuggestionsUnavailable: false,
      productGeneration: readyProductGenerationState(),
      emptyState: buildEmptyState(context, {
        visibleGapCount: 0,
        snapshotGapCount: 0,
        dismissedGapCount: 0,
        nextEligibleAt: null,
        redundancy: [],
        productSuggestionsUnavailable: false,
      }),
      starterKit: emptyStarterKit(),
    };
  }

  private aiPlanUnavailableOverview(
    context: SmartPicksContext,
  ): SmartPicksOverview {
    const recap = buildRecap(context);
    return {
      mode: context.mode,
      generatedAt: new Date().toISOString(),
      inputsHash: context.inputsHash,
      recap,
      coverage: { slots: [], filled: 0, total: 0 },
      priorityGaps: [],
      considerGaps: [],
      covered: [],
      redundancy: [],
      consentRequired: false,
      skinProfileRequired: false,
      productSuggestionsUnavailable: true,
      productGeneration: failedAiPlanningGenerationState(),
      emptyState: buildEmptyState(context, {
        visibleGapCount: 0,
        snapshotGapCount: 0,
        dismissedGapCount: 0,
        nextEligibleAt: null,
        redundancy: [],
        productSuggestionsUnavailable: true,
      }),
      starterKit: emptyStarterKit(),
    };
  }

  private enqueueProductPickGeneration(
    context: SmartPicksContext,
    gaps: SmartPicksGapSnapshot[],
  ): void {
    if (gaps.length === 0) return;
    const jobKey = this.productGenerationJobKey(context);
    if (this.backgroundGenerationJobs.has(jobKey)) return;

    const job = this.generateProductPicks(context, gaps)
      .catch((error) => {
        this.logger.warn(
          `Smart Picks background product generation failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
        return {
          status: SmartPicksProductGenerationStatus.Failed,
          reason: SmartPicksProductGenerationReason.ProviderFailed,
          missingPickCount: gaps.length,
          isProcessing: false,
          attemptedAt: new Date().toISOString(),
          retryAfter: null,
        };
      })
      .finally(() => {
        this.backgroundGenerationJobs.delete(jobKey);
      });
    this.backgroundGenerationJobs.set(jobKey, job);
  }

  private async generateProductPicks(
    context: SmartPicksContext,
    gaps: SmartPicksGapSnapshot[],
  ): Promise<SmartPicksProductGenerationState> {
    const dismissedKeys = await this.loadRecentlyDismissedKeys(context.user.id);
    const gapsForGeneration = gaps.filter(
      (gap) => !dismissedKeys.has(gap.normalizedKey),
    );
    if (gapsForGeneration.length === 0) return readyProductGenerationState();

    const generatedPicks = new Map<string, GeneratedSmartPick>();
    let combinedDiagnostics = emptyGenerationDiagnostics(
      gapsForGeneration.length,
    );
    for (const batch of chunkSmartPickGaps(
      gapsForGeneration,
      SMART_PICKS_AI_GAP_BATCH_SIZE,
    )) {
      const generationResult = await this.aiGenerator.generateWithDiagnostics(
        context,
        batch,
      );
      const duplicatePickCount = mergeUniqueGeneratedPicks(
        generatedPicks,
        generationResult.picks,
      );
      combinedDiagnostics = combineGenerationDiagnostics(
        gapsForGeneration.length,
        generatedPicks.size,
        combinedDiagnostics,
        withDuplicatePickDiagnostics(
          generationResult.diagnostics,
          duplicatePickCount,
        ),
      );
      const retryGaps = batch.filter(
        (gap) => !generatedPicks.has(gap.normalizedKey),
      );
      if (
        !generationResult.diagnostics.providerFailed &&
        retryGaps.length > 0
      ) {
        combinedDiagnostics = await this.retryMissingProductPicks(
          context,
          combinedDiagnostics,
          generatedPicks,
          gapsForGeneration,
          retryGaps,
        );
      }
    }
    if (
      !(await this.hasSmartPicksConsent(context)) ||
      !(await this.isCurrentSnapshotContext(context))
    ) {
      return readyProductGenerationState();
    }
    await this.persistGeneratedPicks(
      context,
      gapsForGeneration,
      generatedPicks,
    );
    const outcome = this.rememberProductGenerationOutcome(
      context,
      gapsForGeneration.length,
      generatedPicks.size,
      combinedDiagnostics,
    );
    await this.recordGenerationMetrics(
      context,
      gapsForGeneration,
      generatedPicks,
      combinedDiagnostics,
    );
    return outcome;
  }

  private async retryMissingProductPicks(
    context: SmartPicksContext,
    initialDiagnostics: SmartPicksAiGenerationDiagnostics,
    generatedPicks: Map<string, GeneratedSmartPick>,
    allGaps: SmartPicksGapSnapshot[],
    retryGaps: SmartPicksGapSnapshot[],
  ): Promise<SmartPicksAiGenerationDiagnostics> {
    const retryResult = await this.aiGenerator.generateWithDiagnostics(
      context,
      retryGaps,
    );
    const duplicatePickCount = mergeUniqueGeneratedPicks(
      generatedPicks,
      retryResult.picks,
    );
    return combineGenerationDiagnostics(
      allGaps.length,
      generatedPicks.size,
      initialDiagnostics,
      withDuplicatePickDiagnostics(retryResult.diagnostics, duplicatePickCount),
    );
  }

  private async resolveProductGenerationState(
    context: SmartPicksContext,
    missingPickCount: number,
  ): Promise<SmartPicksProductGenerationState> {
    const jobKey = this.productGenerationJobKey(context);
    if (missingPickCount === 0) {
      this.productGenerationIssues.delete(jobKey);
      return readyProductGenerationState();
    }

    if (this.generationQueue) {
      const durableJob = await this.generationQueue.latestForContext(context);
      if (
        durableJob?.status === SmartPicksGenerationJobStatus.Queued ||
        durableJob?.status === SmartPicksGenerationJobStatus.Sent ||
        durableJob?.status === SmartPicksGenerationJobStatus.Running
      ) {
        return {
          ...pendingProductGenerationState(missingPickCount),
          isProcessing: true,
          attemptedAt: durableJob.locked_at
            ? toIsoString(durableJob.locked_at)
            : null,
        };
      }
      if (durableJob?.status === SmartPicksGenerationJobStatus.Failed) {
        const attemptedAt = durableJob.updated_at ?? durableJob.created_at;
        const retryAfter = new Date(
          attemptedAt.getTime() + PRODUCT_GENERATION_RETRY_COOLDOWN_MS,
        );
        if (retryAfter.getTime() <= Date.now()) {
          return pendingProductGenerationState(missingPickCount);
        }
        return {
          status: SmartPicksProductGenerationStatus.Failed,
          reason: productGenerationReasonFromJob(durableJob.last_error),
          missingPickCount,
          isProcessing: false,
          attemptedAt: toIsoString(attemptedAt),
          retryAfter: toIsoString(retryAfter),
        };
      }
      return pendingProductGenerationState(missingPickCount);
    }

    if (this.backgroundGenerationJobs.has(jobKey)) {
      return {
        ...pendingProductGenerationState(missingPickCount),
        isProcessing: true,
      };
    }

    const issue = this.productGenerationIssues.get(jobKey);
    if (!issue) return pendingProductGenerationState(missingPickCount);

    const retryAfter = new Date(
      issue.attemptedAt.getTime() + PRODUCT_GENERATION_RETRY_COOLDOWN_MS,
    );
    if (retryAfter.getTime() <= Date.now()) {
      this.productGenerationIssues.delete(jobKey);
      return pendingProductGenerationState(missingPickCount);
    }

    return {
      status: issue.status,
      reason: issue.reason,
      missingPickCount: Math.max(missingPickCount, issue.missingPickCount),
      isProcessing: false,
      attemptedAt: toIsoString(issue.attemptedAt),
      retryAfter: toIsoString(retryAfter),
    };
  }

  private rememberProductGenerationOutcome(
    context: SmartPicksContext,
    requestedGapCount: number,
    generatedPickCount: number,
    diagnostics: SmartPicksAiGenerationDiagnostics,
  ): SmartPicksProductGenerationState {
    const jobKey = this.productGenerationJobKey(context);
    const missingPickCount = Math.max(
      0,
      requestedGapCount - generatedPickCount,
    );
    if (
      missingPickCount === 0 &&
      !diagnostics.providerFailed &&
      !diagnostics.providerSkippedReason
    ) {
      this.productGenerationIssues.delete(jobKey);
      return withAiUsage(
        readyProductGenerationState(),
        aiUsageFromDiagnostics(diagnostics),
      );
    }

    const attemptedAt = new Date();
    this.productGenerationIssues.set(jobKey, {
      status: diagnostics.providerSkippedReason
        ? SmartPicksProductGenerationStatus.Skipped
        : SmartPicksProductGenerationStatus.Failed,
      reason: productGenerationReason(diagnostics),
      attemptedAt,
      missingPickCount:
        missingPickCount > 0 ? missingPickCount : diagnostics.missingPickCount,
    });
    return withAiUsage(
      {
        status: diagnostics.providerSkippedReason
          ? SmartPicksProductGenerationStatus.Skipped
          : SmartPicksProductGenerationStatus.Failed,
        reason: productGenerationReason(diagnostics),
        missingPickCount:
          missingPickCount > 0
            ? missingPickCount
            : diagnostics.missingPickCount,
        isProcessing: false,
        attemptedAt: toIsoString(attemptedAt),
        retryAfter: toIsoString(
          new Date(
            attemptedAt.getTime() + PRODUCT_GENERATION_RETRY_COOLDOWN_MS,
          ),
        ),
      },
      aiUsageFromDiagnostics(diagnostics),
    );
  }

  private productGenerationJobKey(context: SmartPicksContext): string {
    return `picks:${context.user.id}:${context.mode}:${context.inputsHash}`;
  }

  private async persistGeneratedPicks(
    context: SmartPicksContext,
    gaps: SmartPicksGapSnapshot[],
    generatedPicks: Map<string, GeneratedSmartPick>,
  ): Promise<void> {
    for (const gap of gaps) {
      const pick = generatedPicks.get(gap.normalizedKey);
      if (!pick) continue;
      const existing = await this.productSuggestionRepo.findOne({
        where: {
          user_id: context.user.id,
          normalized_key: gap.normalizedKey,
          inputs_hash: context.inputsHash,
        },
      });
      await this.productSuggestionRepo.save(
        this.productSuggestionRepo.create({
          ...(existing ?? {}),
          user_id: context.user.id,
          ingredient_or_category: gap.ingredientOrCategory,
          normalized_key: gap.normalizedKey,
          brand: pick.brand,
          product_name: pick.productName,
          budget_tier: pick.budgetTier,
          seller_names_json: sanitizeSellerNames(pick.sellerNames),
          reasoning_chips_json: pick.reasoningChips,
          reasoning_facts_json: pick.reasoningFacts,
          ruled_out_json: pick.ruledOut,
          alternatives_json: pick.alternatives.map((alternative) => ({
            brand: alternative.brand,
            productName: alternative.productName,
            budgetTier: alternative.budgetTier,
            sellerNames: sanitizeSellerNames(alternative.sellerNames),
            reasoningChips: alternative.reasoningChips,
            reasoningFacts: alternative.reasoningFacts,
            ruledOut: alternative.ruledOut,
            sourceIds: alternative.sourceIds,
            recommendationRankReason: alternative.recommendationRankReason,
          })),
          source_ids: pick.sourceIds,
          recommendation_rank_reason: pick.recommendationRankReason,
          inputs_hash: context.inputsHash,
          gap_reason: gap.shortReason,
          goal_alignment: gap.goalAlignment,
        }),
      );
    }
  }

  private async recordGenerationMetrics(
    context: SmartPicksContext,
    gaps: SmartPicksGapSnapshot[],
    generatedPicks: ReadonlyMap<string, GeneratedSmartPick>,
    diagnostics: SmartPicksAiGenerationDiagnostics,
  ): Promise<void> {
    const picks = Array.from(generatedPicks.values());
    const missingPickCount = Math.max(0, gaps.length - generatedPicks.size);
    const shouldWarn = gaps.length > 0 && missingPickCount > 0;
    await this.observability.record({
      kind: shouldWarn
        ? 'smart_pick_generation_degraded'
        : 'smart_pick_generation_completed',
      severity: shouldWarn ? 'warning' : 'info',
      userId: context.user.id,
      metadata: {
        requestedGapCount: gaps.length,
        generatedPickCount: generatedPicks.size,
        missingPickCount,
        alternativePickCount: picks.reduce(
          (count, pick) => count + pick.alternatives.length,
          0,
        ),
        mode: context.mode,
        rawGapCount: diagnostics.rawGapCount,
        blockedSafetyCount: diagnostics.blockedSafetyCount,
        blockedBudgetCount: diagnostics.blockedBudgetCount,
        blockedOwnedCount: diagnostics.blockedOwnedCount,
        invalidPickCount: diagnostics.invalidPickCount,
      },
    });
    await this.recordProductionMonitoringSignals({
      context,
      gaps,
      picks,
      diagnostics,
      missingPickCount,
    });
  }

  private async recordProductionMonitoringSignals(input: {
    context: SmartPicksContext;
    gaps: SmartPicksGapSnapshot[];
    picks: GeneratedSmartPick[];
    diagnostics: SmartPicksAiGenerationDiagnostics;
    missingPickCount: number;
  }): Promise<void> {
    const { context, gaps, picks, diagnostics, missingPickCount } = input;
    const privacySafeBase = {
      requestedGapCount: gaps.length,
      generatedPickCount: picks.length,
      mode: context.mode,
    };
    if (diagnostics.providerFailed || diagnostics.providerSkippedReason) {
      await this.observability.record({
        kind: 'smart_pick_ai_failed',
        severity: 'warning',
        userId: context.user.id,
        metadata: {
          ...privacySafeBase,
          providerFailed: diagnostics.providerFailed,
          providerSkippedReason: diagnostics.providerSkippedReason,
        },
      });
    }
    if (diagnostics.blockedSafetyCount > 0) {
      await this.observability.record({
        kind: 'smart_pick_unsafe_output_blocked',
        severity: 'warning',
        userId: context.user.id,
        metadata: {
          ...privacySafeBase,
          blockedSafetyCount: diagnostics.blockedSafetyCount,
        },
      });
    }
    if (missingPickCount > 0) {
      await this.observability.record({
        kind: 'smart_pick_no_pick',
        severity: 'warning',
        userId: context.user.id,
        metadata: {
          ...privacySafeBase,
          missingPickCount,
        },
      });
    }
  }

  private async loadActionSummary(
    userId: string,
    normalizedKeys: string[],
  ): Promise<SmartPickActionSummary> {
    const rows = await this.gapActionRepo.find({
      where: {
        user_id: userId,
        source_type: 'smart_pick',
      },
    });
    const keySet = new Set(normalizedKeys);
    const latestByKey = new Map<string, SuggestionGapAction>();
    const savedSuggestionIds = new Set<string>();
    for (const row of rows) {
      if (row.action === 'saved' && row.smart_pick_product_suggestion_id) {
        savedSuggestionIds.add(row.smart_pick_product_suggestion_id);
      }
      if (!keySet.has(row.normalized_key)) continue;
      const existing = latestByKey.get(row.normalized_key);
      if (
        !existing ||
        existing.updated_at.getTime() < row.updated_at.getTime()
      ) {
        latestByKey.set(row.normalized_key, row);
      }
    }

    const dismissedKeys = new Set<string>();
    let dismissedGapCount = 0;
    let nextEligibleAt: Date | null = null;
    const cutoff = Date.now() - DISMISSAL_LOOKBACK_MS;
    for (const row of latestByKey.values()) {
      if (row.action !== 'dismissed') continue;
      if (row.updated_at.getTime() <= cutoff) continue;
      const eligibleAt = new Date(
        row.updated_at.getTime() + DISMISSAL_LOOKBACK_MS,
      );
      dismissedGapCount += 1;
      dismissedKeys.add(row.normalized_key);
      if (!nextEligibleAt || eligibleAt.getTime() < nextEligibleAt.getTime()) {
        nextEligibleAt = eligibleAt;
      }
    }

    return {
      dismissedKeys,
      savedSuggestionIds,
      dismissedGapCount,
      nextEligibleAt,
    };
  }

  private async pruneStaleProductSuggestions(
    context: SmartPicksContext,
  ): Promise<void> {
    const activeSnapshots =
      (await this.snapshotRepo.find({
        where: { user_id: context.user.id },
      })) ?? [];
    const retainedInputHashes = new Set([
      context.inputsHash,
      ...activeSnapshots.map((snapshot) => snapshot.inputs_hash),
    ]);
    const suggestions = await this.productSuggestionRepo.find({
      where: {
        user_id: context.user.id,
        inputs_hash: Not(In([...retainedInputHashes])),
      },
    });
    if (suggestions.length === 0) return;

    const protectedIds = protectedSmartPickSuggestionIds(
      await this.gapActionRepo.find({
        where: {
          user_id: context.user.id,
          source_type: 'smart_pick',
        },
      }),
    );
    const staleIds = suggestions
      .filter((suggestion) => !protectedIds.has(suggestion.id))
      .map((suggestion) => suggestion.id);
    if (staleIds.length === 0) return;

    await this.productSuggestionRepo.delete({
      user_id: context.user.id,
      id: In(staleIds),
    });
  }

  private async loadRecentlyDismissedKeys(
    userId: string,
  ): Promise<Set<string>> {
    const rows = await this.gapActionRepo.find({
      where: {
        user_id: userId,
        source_type: 'smart_pick',
        action: 'dismissed',
        updated_at: MoreThan(new Date(Date.now() - DISMISSAL_LOOKBACK_MS)),
      },
    });
    return new Set(rows.map((row) => row.normalized_key));
  }

  private async maybeDispatchReadyNotification(
    context: SmartPicksContext,
    previousPriorityKeys: ReadonlySet<string>,
    priorityGaps: SmartPicksGapSnapshot[],
  ): Promise<void> {
    if (!context.skinProfile?.allow_smart_picks) return;
    const hasNewPriorityGap = priorityGaps.some(
      (gap) => !previousPriorityKeys.has(gap.normalizedKey),
    );
    if (!hasNewPriorityGap || previousPriorityKeys.size === 0) return;
    await this.notifications.dispatch({
      userId: context.user.id,
      kind: 'smart_pick_ready',
      titleKey: 'notificationsPage.kinds.smart_pick_ready.title',
      bodyKey: 'notificationsPage.kinds.smart_pick_ready.body',
      payload: { gapCount: priorityGaps.length },
      deepLink: '/smart-picks',
      dedupeKey: `smart_pick_ready:${context.inputsHash.slice(0, 16)}`,
    });
  }

  private async hasSmartPicksConsent(
    context: SmartPicksContext,
  ): Promise<boolean> {
    const profile = await this.skinProfileRepo.findOne({
      where: { user_id: context.user.id },
    });
    return (
      profile?.allow_smart_picks ??
      context.skinProfile?.allow_smart_picks ??
      false
    );
  }

  private async isCurrentSnapshotContext(
    context: SmartPicksContext,
  ): Promise<boolean> {
    const snapshot = await this.snapshotRepo.findOne({
      where: { user_id: context.user.id, mode: context.mode },
    });
    if (!snapshot) return true;
    return (
      snapshot.mode === context.mode &&
      snapshot.inputs_hash === context.inputsHash
    );
  }
}

function protectedSmartPickSuggestionIds(
  actions: SuggestionGapAction[],
): Set<string> {
  const protectedIds = new Set<string>();
  const dismissalCutoff = Date.now() - DISMISSAL_LOOKBACK_MS;
  for (const action of actions) {
    const suggestionId = action.smart_pick_product_suggestion_id;
    if (!suggestionId) continue;
    if (action.action === 'saved') {
      protectedIds.add(suggestionId);
      continue;
    }
    if (
      action.action === 'dismissed' &&
      action.updated_at.getTime() > dismissalCutoff
    ) {
      protectedIds.add(suggestionId);
    }
  }
  return protectedIds;
}

function considerGapLimit(context: SmartPicksContext): number {
  return context.budgetTier === 'premium' || context.budgetTier === 'luxury'
    ? 4
    : 2;
}

function combineGenerationDiagnostics(
  requestedGapCount: number,
  acceptedPickCount: number,
  initial: SmartPicksAiGenerationDiagnostics,
  retry: SmartPicksAiGenerationDiagnostics,
): SmartPicksAiGenerationDiagnostics {
  return {
    requestedGapCount,
    rawGapCount: initial.rawGapCount + retry.rawGapCount,
    acceptedPickCount,
    blockedOwnedCount: initial.blockedOwnedCount + retry.blockedOwnedCount,
    blockedBudgetCount: initial.blockedBudgetCount + retry.blockedBudgetCount,
    blockedSafetyCount: initial.blockedSafetyCount + retry.blockedSafetyCount,
    invalidPickCount: initial.invalidPickCount + retry.invalidPickCount,
    missingPickCount: Math.max(0, requestedGapCount - acceptedPickCount),
    providerFailed: initial.providerFailed || retry.providerFailed,
    providerSkippedReason:
      initial.providerSkippedReason ?? retry.providerSkippedReason,
    ...combineAiUsageDiagnostics(initial, retry),
  };
}

function emptyGenerationDiagnostics(
  requestedGapCount: number,
): SmartPicksAiGenerationDiagnostics {
  return {
    requestedGapCount,
    rawGapCount: 0,
    acceptedPickCount: 0,
    blockedOwnedCount: 0,
    blockedBudgetCount: 0,
    blockedSafetyCount: 0,
    invalidPickCount: 0,
    missingPickCount: requestedGapCount,
    providerFailed: false,
    providerSkippedReason: null,
    model: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    estimatedCostUsd: null,
  };
}

function combineAiUsageDiagnostics(
  initial: SmartPicksAiGenerationDiagnostics,
  retry: SmartPicksAiGenerationDiagnostics,
): SmartPicksAiUsageMetrics {
  return {
    estimatedCostUsd: nullableSum(
      initial.estimatedCostUsd,
      retry.estimatedCostUsd,
    ),
    inputTokens: nullableSum(initial.inputTokens, retry.inputTokens),
    model: initial.model ?? retry.model,
    outputTokens: nullableSum(initial.outputTokens, retry.outputTokens),
    totalTokens: nullableSum(initial.totalTokens, retry.totalTokens),
  };
}

function nullableSum(left: number | null, right: number | null): number | null {
  return left === null && right === null ? null : (left ?? 0) + (right ?? 0);
}

function aiUsageFromDiagnostics(
  diagnostics: SmartPicksAiGenerationDiagnostics,
): SmartPicksAiUsageMetrics | undefined {
  if (
    diagnostics.inputTokens === null &&
    diagnostics.outputTokens === null &&
    diagnostics.totalTokens === null &&
    diagnostics.estimatedCostUsd === null
  ) {
    return undefined;
  }

  return {
    estimatedCostUsd: diagnostics.estimatedCostUsd,
    inputTokens: diagnostics.inputTokens,
    model: diagnostics.model,
    outputTokens: diagnostics.outputTokens,
    totalTokens: diagnostics.totalTokens,
  };
}

function aiUsageFromPlanDiagnostics(
  diagnostics: SmartPicksAiPlanDiagnostics,
): SmartPicksAiUsageMetrics | undefined {
  if (
    diagnostics.inputTokens === null &&
    diagnostics.outputTokens === null &&
    diagnostics.totalTokens === null &&
    diagnostics.estimatedCostUsd === null
  ) {
    return undefined;
  }

  return {
    estimatedCostUsd: diagnostics.estimatedCostUsd,
    inputTokens: diagnostics.inputTokens,
    model: diagnostics.model,
    outputTokens: diagnostics.outputTokens,
    totalTokens: diagnostics.totalTokens,
  };
}

function withAiUsage(
  state: SmartPicksProductGenerationState,
  aiUsage: SmartPicksAiUsageMetrics | undefined,
): SmartPicksProductGenerationState {
  return aiUsage ? { ...state, aiUsage } : state;
}

function readyProductGenerationState(): SmartPicksProductGenerationState {
  return {
    status: SmartPicksProductGenerationStatus.Ready,
    reason: null,
    missingPickCount: 0,
    isProcessing: false,
    attemptedAt: null,
    retryAfter: null,
  };
}

function pendingProductGenerationState(
  missingPickCount: number,
): SmartPicksProductGenerationState {
  return {
    status: SmartPicksProductGenerationStatus.Pending,
    reason: null,
    missingPickCount,
    isProcessing: false,
    attemptedAt: null,
    retryAfter: null,
  };
}

function failedAiPlanningGenerationState(): SmartPicksProductGenerationState {
  return {
    status: SmartPicksProductGenerationStatus.Failed,
    reason: SmartPicksProductGenerationReason.ProviderFailed,
    missingPickCount: 0,
    isProcessing: false,
    attemptedAt: new Date().toISOString(),
    retryAfter: null,
  };
}

function productGenerationReason(
  diagnostics: SmartPicksAiGenerationDiagnostics,
): SmartPicksProductGenerationReason {
  if (
    diagnostics.providerSkippedReason ===
    SmartPicksAiProviderSkippedReason.MissingApiKey
  ) {
    return SmartPicksProductGenerationReason.MissingApiKey;
  }
  if (diagnostics.providerFailed) {
    return SmartPicksProductGenerationReason.ProviderFailed;
  }
  return SmartPicksProductGenerationReason.NoPick;
}

function productGenerationReasonFromJob(
  lastError: string | null,
): SmartPicksProductGenerationReason {
  if (lastError === SmartPicksProductGenerationReason.MissingApiKey) {
    return SmartPicksProductGenerationReason.MissingApiKey;
  }
  if (lastError === SmartPicksProductGenerationReason.NoPick) {
    return SmartPicksProductGenerationReason.NoPick;
  }
  return SmartPicksProductGenerationReason.ProviderFailed;
}

function chunkSmartPickGaps(
  gaps: SmartPicksGapSnapshot[],
  batchSize: number,
): SmartPicksGapSnapshot[][] {
  const chunks: SmartPicksGapSnapshot[][] = [];
  for (let index = 0; index < gaps.length; index += batchSize) {
    chunks.push(gaps.slice(index, index + batchSize));
  }
  return chunks;
}

function isFreshSnapshot(
  snapshot: SmartPickSnapshot | null,
  context: SmartPicksContext,
): boolean {
  return Boolean(
    snapshot &&
    snapshot.mode === context.mode &&
    snapshot.inputs_hash === context.inputsHash,
  );
}

function normalizeGapSnapshot(
  gap: SmartPicksGapSnapshot,
): SmartPicksGapSnapshot {
  return {
    ...gap,
    shortReason: gap.shortReason ?? buildShortGapReason(gap.reason),
    gapKind: gap.gapKind ?? SmartPicksGapKind.Missing,
    replacementFor: gap.replacementFor ?? null,
  };
}

export function buildShortGapReason(reason: string): string {
  const legacySkinProfileBudgetPrefix =
    /^Because\s+your\s+Skin\s+Profile\s+uses\s+an?\s+[a-z-]+\s+budget,\s*/i;
  const legacyBudgetPlanPrefix =
    /^because\s+your\s+budget\s+allows\s+a\s+more\s+complete\s+plan,\s*/i;
  const compact = normalizeReasonWhitespace(reason)
    .replace(legacySkinProfileBudgetPrefix, '')
    .replace(
      /^Best fit because (?:the )?profile is filtered to [a-z-]+ budget,\s*(?:and\s*)?/i,
      '',
    )
    .replace(legacyBudgetPlanPrefix, '')
    .replace(
      /\s+when\s+[a-z]+\s+and\s+safety\s+context\s+allow\s+it/gi,
      ' when the safety context allows it',
    )
    .replace(/^For\s+a\s+higher\s+[a-z]+,\s*/i, '')
    .replace(/^With\s+a\s+higher\s+[a-z]+,\s*/i, '')
    .replace(/^this is\s+/i, '');
  const firstSentence = firstReasonSentence(compact);
  return capitalizeFirst(trimReasonLength(firstSentence, 120));
}

function normalizeReasonWhitespace(reason: string): string {
  return reason.replace(/\s+/g, ' ').trim();
}

function firstReasonSentence(reason: string): string {
  const match = /^.*?[.!?](?:\s|$)/.exec(reason);
  return (match?.[0] ?? reason).trim();
}

function trimReasonLength(reason: string, maxLength: number): string {
  if (reason.length <= maxLength) return reason;
  const candidate = reason.slice(0, maxLength).trimEnd();
  const lastSpace = candidate.lastIndexOf(' ');
  const trimmed =
    lastSpace > Math.floor(maxLength * 0.6)
      ? candidate.slice(0, lastSpace)
      : candidate;
  return `${trimmed.replace(/[,.!?;:]+$/, '')}...`;
}

function capitalizeFirst(reason: string): string {
  return reason.charAt(0).toUpperCase() + reason.slice(1);
}

function buildRecap(context: SmartPicksContext): SmartPicksRecap {
  const profile = context.skinProfile;
  return {
    primaryGoal: profile?.primary_goal ?? null,
    skinType: profile?.skin_type ?? null,
    location: {
      city: profile?.city ?? null,
      countryCode: profile?.country_code ?? null,
    },
    budgetTier: context.budgetTier,
    ethnicity: profile?.ethnicity ?? null,
  };
}

function buildEmptyState(
  context: SmartPicksContext,
  input: {
    visibleGapCount: number;
    snapshotGapCount: number;
    dismissedGapCount: number;
    nextEligibleAt: Date | null;
    redundancy: SmartPicksRedundancyGroup[];
    productSuggestionsUnavailable: boolean;
  },
): SmartPicksEmptyState {
  const historyReadiness = buildHistoryReadiness(context);
  const reason = resolveEmptyReason(context, input, historyReadiness);

  return {
    reason,
    dismissedGapCount: input.dismissedGapCount,
    nextEligibleAt: toIsoStringOrNull(input.nextEligibleAt),
    missingProfileFields: context.missingProfileFields,
    activeProductCount: context.activeProducts.length,
    canAssessReplacements: historyReadiness.canAssessReplacements,
    historyReadiness,
  };
}

function emptyStarterKit(): SmartPicksStarterKit {
  return { summary: null, steps: [] };
}

function buildStarterKit(
  context: SmartPicksContext,
  coverage: SmartPicksCoverage,
  visibleGaps: SmartPicksGap[],
  language: AppLanguage,
): SmartPicksStarterKit {
  const starterGaps = visibleGaps.filter(
    (gap) => gap.gapKind === SmartPicksGapKind.Starter,
  );
  const usedGapKeys = new Set<string>();
  const steps: SmartPicksStarterKitStep[] = [];

  for (const slot of coverage.slots) {
    const gap =
      findStarterGapForRole(starterGaps, usedGapKeys, slot.role) ??
      (slot.state !== 'filled'
        ? findNextStarterGap(starterGaps, usedGapKeys)
        : null);
    if (gap) {
      usedGapKeys.add(gap.normalizedKey);
      steps.push(
        starterRecommendedStep(slot.role, steps.length + 1, gap, language),
      );
      continue;
    }
    if (slot.state === 'filled') {
      steps.push(
        starterCoveredStep(slot.role, steps.length + 1, slot, language),
      );
      continue;
    }
    if (slot.state === 'missing-priority') {
      steps.push(starterWaitStep(slot.role, steps.length + 1, language));
    }
  }

  for (const gap of starterGaps) {
    if (usedGapKeys.has(gap.normalizedKey)) continue;
    usedGapKeys.add(gap.normalizedKey);
    steps.push(
      starterRecommendedStep(
        starterRoleForGap(gap),
        steps.length + 1,
        gap,
        language,
      ),
    );
  }

  return {
    summary: smartPicksStarterKitSummary(
      context.activeProducts.length,
      language,
    ),
    steps,
  };
}

function findStarterGapForRole(
  gaps: SmartPicksGap[],
  usedGapKeys: ReadonlySet<string>,
  role: SmartPicksCoverage['slots'][number]['role'],
): SmartPicksGap | null {
  return (
    gaps.find(
      (gap) =>
        !usedGapKeys.has(gap.normalizedKey) && starterRoleForGap(gap) === role,
    ) ?? null
  );
}

function findNextStarterGap(
  gaps: SmartPicksGap[],
  usedGapKeys: ReadonlySet<string>,
): SmartPicksGap | null {
  return gaps.find((gap) => !usedGapKeys.has(gap.normalizedKey)) ?? null;
}

function starterCoveredStep(
  role: SmartPicksCoverage['slots'][number]['role'],
  order: number,
  slot: SmartPicksCoverage['slots'][number],
  language: AppLanguage,
): SmartPicksStarterKitStep {
  const title = smartPicksStarterStepTitle(role, language);
  return {
    order,
    role,
    title,
    ingredientOrCategory: title,
    normalizedKey: normalizeSuggestionGapKey(title),
    status: SmartPicksStarterKitStepStatus.Covered,
    ownedProductId: slot.filledByProductId,
    ownedProductName: slot.filledByName,
    reason: smartPicksStarterCoveredReason(slot.filledByName, language),
    pick: null,
    sourceIds: [],
  };
}

function starterRecommendedStep(
  role: SmartPicksCoverage['slots'][number]['role'],
  order: number,
  gap: SmartPicksGap,
  language: AppLanguage,
): SmartPicksStarterKitStep {
  return {
    order,
    role,
    title: smartPicksStarterStepTitle(role, language),
    ingredientOrCategory: gap.ingredientOrCategory,
    normalizedKey: gap.normalizedKey,
    status: SmartPicksStarterKitStepStatus.Recommended,
    ownedProductId: null,
    ownedProductName: null,
    reason: gap.reason,
    pick: gap.pick,
    sourceIds: gap.sourceIds,
  };
}

function starterWaitStep(
  role: SmartPicksCoverage['slots'][number]['role'],
  order: number,
  language: AppLanguage,
): SmartPicksStarterKitStep {
  const title = smartPicksStarterStepTitle(role, language);
  return {
    order,
    role,
    title,
    ingredientOrCategory: title,
    normalizedKey: normalizeSuggestionGapKey(title),
    status: SmartPicksStarterKitStepStatus.Wait,
    ownedProductId: null,
    ownedProductName: null,
    reason: smartPicksStarterWaitReason(role, language),
    pick: null,
    sourceIds: [],
  };
}

function starterRoleForGap(
  gap: SmartPicksGapSnapshot | SmartPicksGap,
): SmartPicksCoverage['slots'][number]['role'] {
  const key = gap.normalizedKey.toLowerCase();
  if (key.includes('cleanser') || key.includes('cleanse')) return 'cleanse';
  if (key.includes('moisturizer') || key.includes('moisturiser')) {
    return 'moisturise';
  }
  if (key.includes('sunscreen') || key.includes('spf')) return 'spf';
  return 'treat';
}

function resolveEmptyReason(
  context: SmartPicksContext,
  input: {
    visibleGapCount: number;
    snapshotGapCount: number;
    dismissedGapCount: number;
    redundancy: SmartPicksRedundancyGroup[];
    productSuggestionsUnavailable: boolean;
  },
  historyReadiness: SmartPicksHistoryReadiness,
): SmartPicksEmptyReason | null {
  if (context.skinProfileRequired) return SmartPicksEmptyReason.ProfileRequired;
  if (context.consentRequired) return SmartPicksEmptyReason.ConsentRequired;
  if (input.visibleGapCount > 0) return null;
  if (input.productSuggestionsUnavailable) {
    return SmartPicksEmptyReason.ProductGenerationUnavailable;
  }
  if (
    input.snapshotGapCount > 0 &&
    input.dismissedGapCount >= input.snapshotGapCount
  ) {
    return SmartPicksEmptyReason.AllGapsDismissed;
  }
  if (input.redundancy.length > 0) return SmartPicksEmptyReason.RedundancyOnly;
  if (
    context.mode === 'starter' &&
    context.activeProducts.length === 0 &&
    input.snapshotGapCount === 0
  ) {
    return SmartPicksEmptyReason.StarterNeedsShelf;
  }
  if (
    context.activeProducts.length > 0 &&
    !historyReadiness.canAssessReplacements
  ) {
    return SmartPicksEmptyReason.HistoryInsufficient;
  }
  return SmartPicksEmptyReason.FullyCovered;
}

function buildHistoryReadiness(
  context: SmartPicksContext,
): SmartPicksHistoryReadiness {
  const loggedUseDaysLast90 = Math.max(
    0,
    ...context.productPerformance.map((summary) => summary.usageDaysLast90),
  );
  const usablePhotoCheckpoints = Math.max(
    0,
    ...context.productPerformance.map((summary) => summary.photoCheckpoints),
  );
  const hasEnoughUsage = loggedUseDaysLast90 >= MIN_REPLACEMENT_USAGE_DAYS;
  const hasEnoughPhotos =
    usablePhotoCheckpoints >= MIN_REPLACEMENT_PHOTO_CHECKPOINTS;
  const canAssessReplacements = context.productPerformance.some(
    (summary) =>
      summary.replacementCandidate ||
      (summary.usageDaysLast90 >= MIN_REPLACEMENT_USAGE_DAYS &&
        summary.photoCheckpoints >= MIN_REPLACEMENT_PHOTO_CHECKPOINTS),
  );

  return {
    usablePhotoCheckpoints,
    loggedUseDaysLast90,
    canAssessReplacements,
    reason: historyReadinessReason(
      canAssessReplacements,
      hasEnoughUsage,
      hasEnoughPhotos,
    ),
  };
}

function historyReadinessReason(
  canAssessReplacements: boolean,
  hasEnoughUsage: boolean,
  hasEnoughPhotos: boolean,
): SmartPicksHistoryReadinessReason {
  if (canAssessReplacements) return SmartPicksHistoryReadinessReason.Ready;
  if (!hasEnoughUsage && !hasEnoughPhotos) {
    return SmartPicksHistoryReadinessReason.NeedsUsageAndPhotos;
  }
  if (!hasEnoughUsage) return SmartPicksHistoryReadinessReason.NeedsUsageLogs;
  return SmartPicksHistoryReadinessReason.NeedsClearPhotos;
}

export function buildGapSnapshots(
  context: SmartPicksContext,
  coverage: SmartPicksCoverage,
): SmartPicksGapSnapshot[] {
  const gaps: SmartPicksGapSnapshot[] = [];
  const missing = new Set(
    coverage.slots
      .filter((slot) => slot.state !== 'filled')
      .map((slot) => slot.role),
  );
  const missingPriority = new Set(
    coverage.slots
      .filter((slot) => slot.state === 'missing-priority')
      .map((slot) => slot.role),
  );
  const goal = context.skinProfile?.primary_goal ?? null;
  const add = (
    ingredientOrCategory: string,
    priority: SmartPicksGapSnapshot['priority'],
    reason: string,
    sourceIds: SuggestionEvidenceSourceId[],
    goalAlignment = goal,
    gapKind: SmartPicksGapKind = SmartPicksGapKind.Missing,
    replacementFor: SmartPicksProductPerformanceSummary | null = null,
  ) => {
    const normalizedKey = normalizeSuggestionGapKey(ingredientOrCategory);
    if (gaps.some((gap) => gap.normalizedKey === normalizedKey)) return;
    gaps.push({
      ingredientOrCategory,
      normalizedKey,
      priority,
      reason,
      shortReason: buildShortGapReason(reason),
      goalAlignment,
      sourceIds: mergeEvidenceSourceIds(sourceIds),
      gapKind,
      replacementFor,
    });
  };

  if (context.mode === 'starter') {
    if (missing.has('cleanse')) {
      add(
        'Gentle fragrance-free cleanser',
        'priority',
        'A sparse shelf needs a low-risk cleanse step before actives.',
        [SuggestionEvidenceSourceId.MayoDrySkinCare],
        'starter routine',
        SmartPicksGapKind.Starter,
      );
    }
    if (missing.has('moisturise')) {
      add(
        'Barrier-support moisturizer',
        'priority',
        'A basic moisturizer keeps the starter routine comfortable.',
        [SuggestionEvidenceSourceId.MayoDrySkinCare],
        'starter routine',
        SmartPicksGapKind.Starter,
      );
    }
    if (missing.has('spf')) {
      add(
        'Broad-spectrum sunscreen SPF 30+',
        'priority',
        'Daily sunscreen is the protection step a starter shelf should not skip.',
        [
          SuggestionEvidenceSourceId.AadSunscreenSelection,
          SuggestionEvidenceSourceId.FdaAhaSunSensitivity,
        ],
        'sun protection',
        SmartPicksGapKind.Starter,
      );
    }
    const treatmentDecision = starterTreatmentDecision(context.skinProfile);
    if (
      treatmentDecision &&
      !hasGoalAlignedStarterTreatment(context.activeProducts, treatmentDecision)
    ) {
      add(
        treatmentDecision.ingredientOrCategory,
        'priority',
        treatmentDecision.reason,
        treatmentDecision.sourceIds,
        treatmentDecision.goalAlignment,
        SmartPicksGapKind.Starter,
      );
    }
    return gaps;
  }

  if (missingPriority.has('spf')) {
    add(
      'Broad-spectrum sunscreen SPF 30+',
      'priority',
      'Your shelf has no sunscreen role, so goal progress is less protected during the day.',
      [
        SuggestionEvidenceSourceId.AadSunscreenSelection,
        SuggestionEvidenceSourceId.FdaAhaSunSensitivity,
      ],
      'sun protection',
      SmartPicksGapKind.Missing,
    );
  }
  for (const replacement of context.productPerformance
    .filter((summary) => summary.replacementCandidate)
    .slice(0, 2)) {
    add(
      `Replacement for ${replacement.productName}`,
      'priority',
      replacement.replacementReason ??
        'Your product history suggests this step may need a better-fitting replacement.',
      replacementSourceIds(replacement),
      goal,
      SmartPicksGapKind.Replacement,
      replacement,
    );
  }

  for (const candidate of buildGoalGapCandidates(context, coverage)) {
    add(
      candidate.ingredientOrCategory,
      candidate.priority,
      candidate.reason,
      candidate.sourceIds,
      candidate.goalAlignment,
      candidate.gapKind,
    );
  }

  if (missingPriority.has('moisturise')) {
    add(
      'Barrier-support moisturizer',
      'priority',
      'Your shelf is missing the product that seals hydration and buffers active use.',
      [SuggestionEvidenceSourceId.MayoDrySkinCare],
      'barrier support',
      SmartPicksGapKind.Missing,
    );
  }

  if (missingPriority.has('cleanse')) {
    add(
      'Gentle cleanser',
      'priority',
      'A cleanser gives the routine a safer baseline before treatment steps.',
      [SuggestionEvidenceSourceId.MayoDrySkinCare],
      'routine baseline',
      SmartPicksGapKind.Missing,
    );
  }
  if (
    missingPriority.has('treat') &&
    !gaps.some((gap) => gap.gapKind === SmartPicksGapKind.GoalSupport)
  ) {
    add(
      treatmentGapForGoal(goal),
      'priority',
      'Your stated goal has no clear treatment role on the active shelf.',
      [SuggestionEvidenceSourceId.AadAcneTreatment],
      goal,
      SmartPicksGapKind.Missing,
    );
  }
  if (missing.has('hydrate')) {
    add(
      'Hydrating serum or essence',
      'consider',
      'Hydration support could make the rest of your routine feel more comfortable.',
      [SuggestionEvidenceSourceId.MayoDrySkinCare],
      'hydration support',
      SmartPicksGapKind.Missing,
    );
  }

  for (const gap of buildEnvironmentAdaptationPolicy(context.environment)
    .gapRecommendations) {
    const covered =
      gap.ingredientOrCategory.toLowerCase().includes('sunscreen') &&
      !missing.has('spf');
    if (!covered) {
      add(
        gap.ingredientOrCategory,
        'consider',
        gap.reason,
        gap.sourceIds,
        gap.goalAlignment ?? goal,
        SmartPicksGapKind.Environment,
      );
    }
  }

  return limitGapSnapshots(context, gaps);
}

function limitGapSnapshots(
  context: SmartPicksContext,
  gaps: SmartPicksGapSnapshot[],
): SmartPicksGapSnapshot[] {
  const priorityLimit = context.mode === 'starter' ? 4 : 3;
  return [
    ...gaps
      .filter((gap) => gap.priority === 'priority')
      .slice(0, priorityLimit),
    ...gaps
      .filter((gap) => gap.priority === 'consider')
      .slice(0, considerGapLimit(context)),
  ];
}

function mergeUniqueGeneratedPicks(
  target: Map<string, GeneratedSmartPick>,
  incoming: ReadonlyMap<string, GeneratedSmartPick>,
): number {
  const existingProductKeys = new Set(
    [...target.values()].map(generatedPickIdentityKey),
  );
  let duplicatePickCount = 0;
  for (const [key, pick] of incoming) {
    const productKey = generatedPickIdentityKey(pick);
    if (existingProductKeys.has(productKey)) {
      duplicatePickCount += 1;
      continue;
    }
    target.set(key, pick);
    existingProductKeys.add(productKey);
  }
  return duplicatePickCount;
}

function generatedPickIdentityKey(pick: GeneratedSmartPick): string {
  return `${pick.brand} ${pick.productName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function withDuplicatePickDiagnostics(
  diagnostics: SmartPicksAiGenerationDiagnostics,
  duplicatePickCount: number,
): SmartPicksAiGenerationDiagnostics {
  if (duplicatePickCount === 0) return diagnostics;
  return {
    ...diagnostics,
    acceptedPickCount: Math.max(
      0,
      diagnostics.acceptedPickCount - duplicatePickCount,
    ),
    invalidPickCount: diagnostics.invalidPickCount + duplicatePickCount,
    missingPickCount: diagnostics.missingPickCount + duplicatePickCount,
  };
}

function replacementSourceIds(
  summary: SmartPicksProductPerformanceSummary,
): SuggestionEvidenceSourceId[] {
  if (
    summary.goalTrend === SmartPicksProductPerformanceSignal.IrritationSignal
  ) {
    return [
      SuggestionEvidenceSourceId.AadRetinoidRetinol,
      SuggestionEvidenceSourceId.DermNetTopicalRetinoids,
    ];
  }
  if (summary.concernTrend?.includes('dry')) {
    return [SuggestionEvidenceSourceId.MayoDrySkinCare];
  }
  if (summary.concernTrend?.includes('hyper')) {
    return [
      SuggestionEvidenceSourceId.AadAcneTreatment,
      SuggestionEvidenceSourceId.AadRetinoidRetinol,
    ];
  }
  return [SuggestionEvidenceSourceId.AadAcneTreatment];
}

function starterTreatmentDecision(
  profile: SkinProfile | null,
): StarterTreatmentDecision | null {
  return starterTreatmentDecisionFromInput({
    primaryGoal: profile?.primary_goal ?? null,
    currentConcerns: profile?.current_concerns ?? [],
    concernDetails: profile?.concern_details ?? null,
    pregnancyStatus: profile?.pregnancy_status ?? null,
  });
}

function starterTreatmentDecisionFromInput(
  input: StarterTreatmentDecisionInput,
): StarterTreatmentDecision | null {
  const text = [
    input.primaryGoal,
    ...input.currentConcerns,
    ...(input.concernDetails?.per_concern ?? []).map(
      (entry) => `${entry.concern} ${entry.severity ?? ''}`,
    ),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!text.trim()) return null;
  if (hasAnySignal(text, ['acne', 'breakout', 'blemish', 'pimple'])) {
    return {
      ingredientOrCategory:
        'Low-irritation acne treatment with azelaic acid or BHA',
      goalAlignment: 'breakout control',
      reason:
        'Your profile points to breakouts, so the starter kit needs one gentle acne treatment rather than several actives.',
      sourceIds: [
        SuggestionEvidenceSourceId.AadAcneTreatment,
        SuggestionEvidenceSourceId.FdaAhaSunSensitivity,
      ],
      alignmentSignals: [
        'azelaic',
        'salicylic',
        'bha',
        'benzoyl',
        'adapalene',
        'retinoid',
        'retinol',
      ],
    };
  }
  if (
    hasAnySignal(text, [
      'dark',
      'spot',
      'mark',
      'tone',
      'hyperpigmentation',
      'pih',
      'melasma',
      'uneven',
    ])
  ) {
    return {
      ingredientOrCategory: 'Azelaic acid or tranexamic acid dark-spot serum',
      goalAlignment: 'dark mark support',
      reason:
        'Your profile points to dark marks or uneven tone, so the starter kit needs one PIH-aware treatment after sunscreen is in place.',
      sourceIds: [
        SuggestionEvidenceSourceId.DermNetPostInflammatoryHyperpigmentation,
        SuggestionEvidenceSourceId.AadMelasmaTreatment,
        SuggestionEvidenceSourceId.AadAcneTreatment,
        SuggestionEvidenceSourceId.AadRetinoidRetinol,
      ],
      alignmentSignals: [
        'azelaic',
        'tranexamic',
        'vitamin c',
        'ascorbic',
        'kojic',
        'alpha arbutin',
        'arbutin',
        'retinoid',
        'retinol',
        'tretinoin',
      ],
    };
  }
  if (hasAnySignal(text, ['texture', 'rough', 'bump', 'clogged', 'pore'])) {
    return {
      ingredientOrCategory: 'Gentle AHA/PHA texture treatment',
      goalAlignment: 'texture support',
      reason:
        'Your profile points to rough texture or clogged pores, so the starter kit needs one slow-introduction texture treatment.',
      sourceIds: [
        SuggestionEvidenceSourceId.AadAcneTreatment,
        SuggestionEvidenceSourceId.FdaAhaSunSensitivity,
      ],
      alignmentSignals: [
        'aha',
        'pha',
        'glycolic',
        'lactic',
        'mandelic',
        'salicylic',
        'bha',
        'retinoid',
        'retinol',
      ],
    };
  }
  if (
    hasAnySignal(text, [
      'redness',
      'irritation',
      'sensitive',
      'barrier',
      'calm',
      'soothe',
      'rosacea',
    ])
  ) {
    return {
      ingredientOrCategory:
        'Barrier-calming serum with niacinamide or panthenol',
      goalAlignment: 'calm and barrier support',
      reason:
        'Your profile points to redness or irritation, so the starter kit should stay calming and barrier-focused.',
      sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
      alignmentSignals: [
        'niacinamide',
        'panthenol',
        'centella',
        'azelaic',
        'madecassoside',
        'allantoin',
      ],
    };
  }
  if (
    hasAnySignal(text, ['dry', 'dehydrat', 'hydration', 'hydrate', 'plump'])
  ) {
    return {
      ingredientOrCategory: 'Hydrating serum with glycerin or hyaluronic acid',
      goalAlignment: 'hydration support',
      reason:
        'Your profile points to hydration as a goal, so the starter kit can include one simple hydrating support step.',
      sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
      alignmentSignals: [
        'hyaluronic',
        'glycerin',
        'polyglutamic',
        'beta-glucan',
        'panthenol',
        'snail',
        'urea',
      ],
    };
  }
  if (hasAnySignal(text, ['fine', 'aging', 'ageing', 'wrinkle', 'firm'])) {
    if (isPregnancyCautionActive(input.pregnancyStatus)) {
      return {
        ingredientOrCategory:
          'Pregnancy-conscious peptide or bakuchiol night treatment',
        goalAlignment: 'early aging support',
        reason:
          'Your profile points to early aging support, but your safety context means the starter kit should avoid retinoid picks.',
        sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
        alignmentSignals: ['peptide', 'bakuchiol'],
      };
    }
    return {
      ingredientOrCategory: 'Beginner retinoid or retinal night treatment',
      goalAlignment: 'early aging support',
      reason:
        'Your profile points to early aging support, so the starter kit needs one gentle night treatment with moisturizer support.',
      sourceIds: [
        SuggestionEvidenceSourceId.AadRetinoidRetinol,
        SuggestionEvidenceSourceId.DermNetTopicalRetinoids,
      ],
      alignmentSignals: [
        'retinol',
        'retinal',
        'retinoid',
        'adapalene',
        'tretinoin',
      ],
    };
  }

  return null;
}

function hasAnySignal(text: string, signals: readonly string[]): boolean {
  return signals.some((signal) => text.includes(signal));
}

function hasGoalAlignedStarterTreatment(
  products: readonly InventoryProduct[],
  decision: StarterTreatmentDecision,
): boolean {
  return products.some((product) => {
    const text = productSearchText(product);
    if (!isStarterTreatmentProduct(product, text)) return false;
    return decision.alignmentSignals.some((signal) => text.includes(signal));
  });
}

function isStarterTreatmentProduct(
  product: InventoryProduct,
  text: string,
): boolean {
  if (
    [
      ProductCategory.Exfoliant,
      ProductCategory.Serum,
      ProductCategory.Treatment,
    ].includes(product.category)
  ) {
    return true;
  }
  return /\b(serum|treatment|retinol|retinal|retinoid|azelaic|tranexamic|salicylic|benzoyl|exfoliant|aha|bha|pha|vitamin c|ascorbic|niacinamide|panthenol|peptide|bakuchiol)\b/.test(
    text,
  );
}

function productSearchText(product: InventoryProduct): string {
  return [
    product.brand,
    product.name,
    product.category,
    ...(product.identity?.benefits ?? []),
    ...(product.identity?.inciIngredients ?? []),
  ]
    .join(' ')
    .toLowerCase();
}

function isPregnancyCautionActive(status: string | null): boolean {
  const normalized = status?.trim().toLowerCase();
  if (!normalized) return false;
  return ![
    'not_pregnant',
    'not pregnant',
    'none',
    'no',
    'unknown',
    'prefer_not_to_say',
  ].includes(normalized);
}

function treatmentGapForGoal(primaryGoal: string | null): string {
  return (
    starterTreatmentDecisionFromInput({
      primaryGoal,
      currentConcerns: [],
      concernDetails: null,
      pregnancyStatus: null,
    })?.ingredientOrCategory ?? 'Gentle targeted treatment'
  );
}

export function toProductPick(
  entity: SmartPickProductSuggestion,
  action: SuggestionGapActionKind | null = null,
): SmartPicksProductPick {
  return {
    id: entity.id,
    brand: entity.brand,
    productName: entity.product_name,
    budgetTier: entity.budget_tier,
    sellerNames: sanitizeSellerNames(entity.seller_names_json ?? []),
    reasoningChips: entity.reasoning_chips_json ?? [],
    reasoningFacts: entity.reasoning_facts_json ?? {},
    ruledOut: entity.ruled_out_json ?? [],
    sourceIds: entity.source_ids ?? [],
    alternatives: (entity.alternatives_json ?? []).map(
      (alternative, index) => ({
        id: `${entity.id}:alt:${index + 1}`,
        brand: alternative.brand,
        productName: alternative.productName,
        budgetTier: alternative.budgetTier,
        sellerNames: sanitizeSellerNames(alternative.sellerNames ?? []),
        reasoningChips: alternative.reasoningChips ?? [],
        reasoningFacts: alternative.reasoningFacts ?? {},
        ruledOut: alternative.ruledOut ?? [],
        sourceIds: alternative.sourceIds ?? [],
        alternatives: [],
        recommendationRankReason: alternative.recommendationRankReason
          ? buildShortGapReason(alternative.recommendationRankReason)
          : null,
        userAction: null,
        createdAt: toIsoString(entity.created_at),
      }),
    ),
    recommendationRankReason: entity.recommendation_rank_reason
      ? buildShortGapReason(entity.recommendation_rank_reason)
      : null,
    userAction: action,
    createdAt: toIsoString(entity.created_at),
  };
}

function sanitizeSellerNames(sellerNames: readonly string[]): string[] {
  const seenNames = new Set<string>();
  const guidance: string[] = [];
  for (const sellerName of sellerNames) {
    const name = sellerName.replace(/\s+/g, ' ').trim();
    const key = name?.toLowerCase() ?? null;
    if (!name || !key || seenNames.has(key)) continue;
    seenNames.add(key);
    guidance.push(name.slice(0, 80));
    if (guidance.length >= 3) break;
  }
  return guidance;
}

function toIsoStringOrNull(value: Date | null): string | null {
  return value ? toIsoString(value) : null;
}

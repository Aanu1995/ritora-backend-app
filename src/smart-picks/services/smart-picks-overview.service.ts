import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { toIsoString } from '../../common/utils/date';
import { buildEnvironmentAdaptationPolicy } from '../../environment-intelligence/environment-adaptation-policy';
import { NotificationsService } from '../../notifications/notifications.service';
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
  SmartPicksCoverage,
  SmartPicksEmptyReason,
  SmartPicksEmptyState,
  SmartPicksGap,
  SmartPicksGapKind,
  SmartPicksGapSnapshot,
  SmartPicksHistoryReadiness,
  SmartPicksHistoryReadinessReason,
  SmartPicksMode,
  SmartPicksOverview,
  SmartPicksProductPerformanceSignal,
  SmartPicksProductPerformanceSummary,
  SmartPicksProductPick,
  SmartPicksRecap,
  SmartPicksRedundancyGroup,
  SmartPicksSnapshotPayload,
} from '../smart-picks.types';
import {
  GeneratedSmartPick,
  SmartPicksAiGenerator,
} from './smart-picks-ai-generator';
import {
  SmartPicksContext,
  SmartPicksContextBuilder,
} from './smart-picks-context-builder';
import { SmartPicksCoverageService } from './smart-picks-coverage.service';
import { SmartPicksRedundancyService } from './smart-picks-redundancy.service';

const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
const DISMISSAL_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const RETAILER_DATA_FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_REPLACEMENT_USAGE_DAYS = 20;
const MIN_REPLACEMENT_PHOTO_CHECKPOINTS = 2;

type SmartPickActionSummary = {
  actionByKey: Map<string, SuggestionGapActionKind>;
  dismissedGapCount: number;
  nextEligibleAt: Date | null;
};

@Injectable()
export class SmartPicksOverviewService {
  constructor(
    private readonly contextBuilder: SmartPicksContextBuilder,
    private readonly coverageService: SmartPicksCoverageService,
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
  ) {}

  async getOverview(
    user: User,
    requestedMode: SmartPicksMode | null = null,
  ): Promise<SmartPicksOverview> {
    const context = await this.contextBuilder.build(user, requestedMode);
    if (context.skinProfileRequired || context.consentRequired) {
      return this.emptyOverview(context);
    }

    const cached = await this.snapshotRepo.findOne({
      where: { user_id: user.id },
    });
    if (cached && isFreshSnapshot(cached, context)) {
      return this.hydrateOverview(context, cached);
    }

    const previousPriorityKeys = new Set(
      (cached?.gaps_json ?? [])
        .filter((gap) => gap.priority === 'priority')
        .map((gap) => gap.normalizedKey),
    );
    const snapshotPayload = await this.generateSnapshotPayload(context);
    const snapshot = await this.saveSnapshot(context, snapshotPayload, cached);
    await this.maybeDispatchReadyNotification(
      context,
      previousPriorityKeys,
      snapshotPayload.priorityGaps,
    );
    return this.hydrateOverview(context, snapshot);
  }

  async updateBudget(
    user: User,
    budgetTier: SmartPicksBudgetTier,
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
    return this.getOverview(user, null);
  }

  private async generateSnapshotPayload(
    context: SmartPicksContext,
  ): Promise<SmartPicksSnapshotPayload> {
    const coverage = this.coverageService.compute(
      context.activeProducts,
      context.skinProfile?.primary_goal ?? null,
    );
    const dismissedKeys = await this.loadRecentlyDismissedKeys(context.user.id);
    const gaps = buildGapSnapshots(context, coverage);
    const gapsForGeneration = gaps.filter(
      (gap) => !dismissedKeys.has(gap.normalizedKey),
    );
    const generatedPicks = await this.aiGenerator.generate(
      context,
      gapsForGeneration,
    );
    await this.persistGeneratedPicks(
      context,
      gapsForGeneration,
      generatedPicks,
    );
    await this.recordGenerationMetrics(
      context,
      gapsForGeneration,
      generatedPicks,
    );
    const recap = buildRecap(context);

    return {
      recap,
      coverage,
      priorityGaps: gaps
        .filter((gap) => gap.priority === 'priority')
        .slice(0, 3),
      considerGaps: gaps
        .filter((gap) => gap.priority === 'consider')
        .slice(0, 2),
      covered: coverage.slots
        .filter((slot) => slot.state === 'filled' && slot.filledByName)
        .map((slot) => ({
          role: slot.role,
          productName: slot.filledByName as string,
          reason: `Covers your ${slot.role.replace('-', ' ')} role.`,
        })),
      redundancy: this.redundancyService.detect(context.activeProducts),
    };
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
      expires_at: new Date(now.getTime() + SNAPSHOT_TTL_MS),
    });
    return this.snapshotRepo.save(snapshot);
  }

  private async hydrateOverview(
    context: SmartPicksContext,
    snapshot: SmartPickSnapshot,
  ): Promise<SmartPicksOverview> {
    const gaps = (snapshot.gaps_json ?? []).map(normalizeGapSnapshot);
    const suggestions = await this.productSuggestionRepo.find({
      where: { user_id: context.user.id },
    });
    const suggestionsByKey = new Map(
      suggestions.map((suggestion) => [suggestion.normalized_key, suggestion]),
    );
    const actionSummary = await this.loadActionSummary(
      context.user.id,
      gaps.map((gap) => gap.normalizedKey),
    );
    const toGap = (gap: SmartPicksGapSnapshot): SmartPicksGap | null => {
      const action = actionSummary.actionByKey.get(gap.normalizedKey) ?? null;
      if (action === 'dismissed') return null;
      const suggestion = suggestionsByKey.get(gap.normalizedKey) ?? null;
      return {
        ...gap,
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

    return {
      mode: snapshot.mode,
      generatedAt: toIsoString(snapshot.generated_at),
      inputsHash: snapshot.inputs_hash,
      recap: snapshot.recap_json,
      coverage: snapshot.coverage_json,
      priorityGaps,
      considerGaps,
      covered: snapshot.covered_json ?? [],
      redundancy: snapshot.redundancy_json ?? [],
      consentRequired: false,
      skinProfileRequired: false,
      productSuggestionsUnavailable,
      emptyState: buildEmptyState(context, {
        visibleGapCount: visibleGaps.length,
        snapshotGapCount: gaps.length,
        dismissedGapCount: actionSummary.dismissedGapCount,
        nextEligibleAt: actionSummary.nextEligibleAt,
        redundancy: snapshot.redundancy_json ?? [],
        productSuggestionsUnavailable,
      }),
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
      emptyState: buildEmptyState(context, {
        visibleGapCount: 0,
        snapshotGapCount: 0,
        dismissedGapCount: 0,
        nextEligibleAt: null,
        redundancy: [],
        productSuggestionsUnavailable: false,
      }),
    };
  }

  private async persistGeneratedPicks(
    context: SmartPicksContext,
    gaps: SmartPicksGapSnapshot[],
    generatedPicks: Map<string, GeneratedSmartPick>,
  ): Promise<void> {
    const now = new Date();
    const retailerDataExpiresAt = new Date(
      now.getTime() + RETAILER_DATA_FRESHNESS_MS,
    );
    for (const gap of gaps) {
      const pick = generatedPicks.get(gap.normalizedKey);
      if (!pick) continue;
      const existing = await this.productSuggestionRepo.findOne({
        where: { user_id: context.user.id, normalized_key: gap.normalizedKey },
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
          price_cents: pick.priceCents,
          currency: pick.currency,
          retailers_json: pick.retailers,
          reasoning_chips_json: pick.reasoningChips,
          reasoning_facts_json: pick.reasoningFacts,
          ruled_out_json: pick.ruledOut,
          alternatives_json: pick.alternatives.map((alternative) => ({
            brand: alternative.brand,
            productName: alternative.productName,
            budgetTier: alternative.budgetTier,
            priceCents: alternative.priceCents,
            currency: alternative.currency,
            retailers: alternative.retailers,
            reasoningChips: alternative.reasoningChips,
            reasoningFacts: alternative.reasoningFacts,
            ruledOut: alternative.ruledOut,
            sourceIds: alternative.sourceIds,
            availabilityStatus: alternative.availabilityStatus,
            recommendationRankReason: alternative.recommendationRankReason,
            localAlternativeReason: alternative.localAlternativeReason,
          })),
          source_ids: pick.sourceIds,
          verification_status: pick.verificationStatus,
          availability_status: pick.availabilityStatus,
          recommendation_rank_reason: pick.recommendationRankReason,
          local_alternative_reason: pick.localAlternativeReason,
          retailer_data_checked_at: now,
          retailer_data_expires_at: retailerDataExpiresAt,
          inputs_hash: context.inputsHash,
          gap_reason: gap.reason,
          goal_alignment: gap.goalAlignment,
        }),
      );
    }
  }

  private async recordGenerationMetrics(
    context: SmartPicksContext,
    gaps: SmartPicksGapSnapshot[],
    generatedPicks: ReadonlyMap<string, GeneratedSmartPick>,
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
        importOnlyPickCount: picks.filter(
          (pick) => pick.availabilityStatus === 'import_only',
        ).length,
        unavailablePickCount: picks.filter(
          (pick) => pick.availabilityStatus === 'unavailable',
        ).length,
        localAlternativeCount: picks.filter((pick) =>
          pick.alternatives.some(
            (alternative) => alternative.availabilityStatus === 'local',
          ),
        ).length,
        mode: context.mode,
      },
    });
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
    for (const row of rows) {
      if (!keySet.has(row.normalized_key)) continue;
      const existing = latestByKey.get(row.normalized_key);
      if (
        !existing ||
        existing.updated_at.getTime() < row.updated_at.getTime()
      ) {
        latestByKey.set(row.normalized_key, row);
      }
    }

    const actionByKey = new Map<string, SuggestionGapActionKind>();
    let dismissedGapCount = 0;
    let nextEligibleAt: Date | null = null;
    const cutoff = Date.now() - DISMISSAL_LOOKBACK_MS;
    for (const row of latestByKey.values()) {
      if (row.action !== 'dismissed') {
        actionByKey.set(row.normalized_key, row.action);
        continue;
      }
      if (row.updated_at.getTime() <= cutoff) continue;
      const eligibleAt = new Date(
        row.updated_at.getTime() + DISMISSAL_LOOKBACK_MS,
      );
      dismissedGapCount += 1;
      actionByKey.set(row.normalized_key, row.action);
      if (!nextEligibleAt || eligibleAt.getTime() < nextEligibleAt.getTime()) {
        nextEligibleAt = eligibleAt;
      }
    }

    return { actionByKey, dismissedGapCount, nextEligibleAt };
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
}

function isFreshSnapshot(
  snapshot: SmartPickSnapshot | null,
  context: SmartPicksContext,
): boolean {
  return Boolean(
    snapshot &&
    snapshot.mode === context.mode &&
    snapshot.inputs_hash === context.inputsHash &&
    snapshot.expires_at.getTime() > Date.now(),
  );
}

function normalizeGapSnapshot(
  gap: SmartPicksGapSnapshot,
): SmartPicksGapSnapshot {
  return {
    ...gap,
    gapKind: gap.gapKind ?? SmartPicksGapKind.Missing,
    replacementFor: gap.replacementFor ?? null,
  };
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
    if (missing.has('treat')) {
      add(
        treatmentGapForGoal(goal),
        'priority',
        'One gentle treatment is enough while your routine is still sparse.',
        [SuggestionEvidenceSourceId.AadAcneTreatment],
        goal,
        SmartPicksGapKind.Starter,
      );
    }
    return gaps;
  }

  if (missing.has('spf')) {
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
  if (missing.has('moisturise')) {
    add(
      'Barrier-support moisturizer',
      'priority',
      'Your shelf is missing the product that seals hydration and buffers active use.',
      [SuggestionEvidenceSourceId.MayoDrySkinCare],
      'barrier support',
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

  if (missing.has('cleanse')) {
    add(
      'Gentle cleanser',
      'priority',
      'A cleanser gives the routine a safer baseline before treatment steps.',
      [SuggestionEvidenceSourceId.MayoDrySkinCare],
      'routine baseline',
      SmartPicksGapKind.Missing,
    );
  }
  if (missing.has('treat')) {
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

  return gaps.slice(0, 5);
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

function treatmentGapForGoal(primaryGoal: string | null): string {
  const goal = primaryGoal?.toLowerCase() ?? '';
  if (goal.includes('dark') || goal.includes('tone')) {
    return 'PIH-aware brightening serum';
  }
  if (goal.includes('acne') || goal.includes('breakout')) {
    return 'Low-irritation acne treatment';
  }
  if (goal.includes('texture')) {
    return 'Gentle texture treatment';
  }
  if (goal.includes('fine') || goal.includes('aging')) {
    return 'Beginner retinoid alternative';
  }
  return 'Gentle targeted treatment';
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
    priceCents: entity.price_cents,
    currency: entity.currency,
    retailers: entity.retailers_json ?? [],
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
        priceCents: alternative.priceCents,
        currency: alternative.currency,
        retailers: alternative.retailers ?? [],
        reasoningChips: alternative.reasoningChips ?? [],
        reasoningFacts: alternative.reasoningFacts ?? {},
        ruledOut: alternative.ruledOut ?? [],
        sourceIds: alternative.sourceIds ?? [],
        alternatives: [],
        verificationStatus: entity.verification_status,
        availabilityStatus: alternative.availabilityStatus ?? 'unknown',
        recommendationRankReason: alternative.recommendationRankReason ?? null,
        localAlternativeReason: alternative.localAlternativeReason ?? null,
        retailerDataCheckedAt: toIsoStringOrNull(
          entity.retailer_data_checked_at,
        ),
        retailerDataStale: isRetailerDataStale(entity),
        userAction: null,
        createdAt: toIsoString(entity.created_at),
      }),
    ),
    verificationStatus: entity.verification_status,
    availabilityStatus: entity.availability_status,
    recommendationRankReason: entity.recommendation_rank_reason,
    localAlternativeReason: entity.local_alternative_reason,
    retailerDataCheckedAt: toIsoStringOrNull(entity.retailer_data_checked_at),
    retailerDataStale: isRetailerDataStale(entity),
    userAction: action,
    createdAt: toIsoString(entity.created_at),
  };
}

function toIsoStringOrNull(value: Date | null): string | null {
  return value ? toIsoString(value) : null;
}

function isRetailerDataStale(entity: SmartPickProductSuggestion): boolean {
  return Boolean(
    entity.retailer_data_expires_at &&
    entity.retailer_data_expires_at.getTime() <= Date.now(),
  );
}

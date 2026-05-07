import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { ShelfStatus } from '../../shelf/shelf.types';
import { SkinJournalEntry } from '../../skin-journal/entities/skin-journal-entry.entity';
import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import { User } from '../../users/entities/user.entity';
import { UserDataAccessLogService } from '../../users/user-data-access-log.service';
import {
  SensitiveSkinProfileConsentType,
  UserDataAccessActorType,
  UserDataAccessPurpose,
} from '../../users/user-consent.constants';
import { SuggestionGenerationJob } from '../entities/suggestion-generation-job.entity';
import { RoutineBreak } from '../entities/routine-break.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { SuggestionRequestSource } from '../suggestions.constants';
import { SuggestionGenerationInputs } from './suggestion-ai-generator';
import { SuggestionAiUsageGuard } from './suggestion-ai-usage-guard.service';
import { SuggestionConsentService } from './suggestion-consent.service';
import { SuggestionContextBuilder } from './suggestion-context-builder.service';
import { normalizeJournalEntriesForSuggestions } from './suggestion-journal-context';
import { SuggestionObservabilityService } from './suggestion-observability.service';
import { SuggestionTodayActionService } from './suggestion-today-action.service';
import { deriveSuggestionDaypart } from './suggestion-helpers';

type SuggestionConsentDecision = Awaited<
  ReturnType<SuggestionConsentService['evaluate']>
>;
type SuggestionUsageDecision = Awaited<
  ReturnType<SuggestionAiUsageGuard['evaluate']>
>;

type PersonalizationDecision = {
  consentDecision: SuggestionConsentDecision;
  aiPersonalizationAllowed: boolean;
  blockedReason: string | null;
};

type GenerationContextData = {
  skinProfile: SkinProfile | null;
  activeProducts: InventoryProduct[];
  finishedProductIds: string[];
  recentJournal: SkinJournalEntry[];
  recentApplications: ApplicationLog[];
  recentRoutineBreaks: RoutineBreak[];
};

export type ScheduledSuggestionGenerationContextBuildInput = {
  user: User;
  job: SuggestionGenerationJob;
  slot: ScheduleSlot;
  targetDate: string;
  targetTime: string;
};

export type OnDemandSuggestionGenerationContextBuildInput = {
  user: User;
  job: SuggestionGenerationJob;
  suggestion: SuggestionInstance;
  targetDate: string;
  targetTime: string;
};

@Injectable()
export class SuggestionGenerationContextService {
  constructor(
    private readonly usageGuard: SuggestionAiUsageGuard,
    private readonly consentService: SuggestionConsentService,
    private readonly contextBuilder: SuggestionContextBuilder,
    private readonly todayActionService: SuggestionTodayActionService,
    private readonly observability: SuggestionObservabilityService,
    private readonly dataAccessLog: UserDataAccessLogService,
    @InjectRepository(InventoryProduct)
    private readonly inventoryRepo: Repository<InventoryProduct>,
    @InjectRepository(SkinJournalEntry)
    private readonly journalRepo: Repository<SkinJournalEntry>,
    @InjectRepository(SkinProfile)
    private readonly skinProfileRepo: Repository<SkinProfile>,
    @InjectRepository(ApplicationLog)
    private readonly applicationLogRepo: Repository<ApplicationLog>,
    @InjectRepository(RoutineBreak)
    private readonly routineBreakRepo: Repository<RoutineBreak>,
  ) {}

  async buildScheduled(
    input: ScheduledSuggestionGenerationContextBuildInput,
  ): Promise<SuggestionGenerationInputs> {
    const { user, job, slot, targetDate, targetTime } = input;
    const personalization = await this.evaluatePersonalization(user.id, job.id);
    const contextData = await this.loadGenerationContextData(
      user.id,
      targetDate,
      job.last_error,
      personalization.consentDecision,
    );
    await this.recordRecommendationDataAccess(
      user.id,
      personalization.consentDecision.activeSensitiveConsentTypes,
    );

    const daypart = deriveSuggestionDaypart(slot.slot_time);
    const contextSummary = await this.contextBuilder.build({
      userId: user.id,
      targetDate,
      targetTime,
      daypart,
      requestSource: SuggestionRequestSource.Scheduled,
      requestContext: null,
      skinProfile: contextData.skinProfile,
      shelfActiveProducts: contextData.activeProducts,
      routineSteps: slot.steps ?? [],
      recentJournalEntries: contextData.recentJournal,
      recentApplications: contextData.recentApplications,
      recentRoutineBreaks: contextData.recentRoutineBreaks,
      aiPersonalizationAllowed: personalization.aiPersonalizationAllowed,
      aiPersonalizationBlockedReason: personalization.blockedReason,
    });

    return {
      slotId: slot.id,
      requestSource: SuggestionRequestSource.Scheduled,
      requestContext: null,
      scheduledSlotContext: {
        slotNotes: slot.slot_notes ?? null,
        specialistSafetyNotes: slot.specialist_safety_notes ?? null,
      },
      targetDate,
      targetTime,
      daypart,
      skinProfile: contextData.skinProfile,
      shelfActiveProducts: contextData.activeProducts,
      shelfFinishedProductIds: contextData.finishedProductIds,
      routineSteps: slot.steps ?? [],
      recentJournalEntries: contextData.recentJournal,
      recentApplications: contextData.recentApplications,
      contextSummary,
      aiPersonalizationAllowed: personalization.aiPersonalizationAllowed,
      aiPersonalizationBlockedReason: personalization.blockedReason,
    };
  }

  async buildOnDemand(
    input: OnDemandSuggestionGenerationContextBuildInput,
  ): Promise<SuggestionGenerationInputs> {
    const { user, job, suggestion, targetDate, targetTime } = input;
    const personalization = await this.evaluatePersonalization(user.id, job.id);
    const contextData = await this.loadGenerationContextData(
      user.id,
      targetDate,
      job.last_error,
      personalization.consentDecision,
    );
    await this.recordRecommendationDataAccess(
      user.id,
      personalization.consentDecision.activeSensitiveConsentTypes,
    );

    const daypart = deriveSuggestionDaypart(targetTime);
    const contextSummary = await this.contextBuilder.build({
      userId: user.id,
      targetDate,
      targetTime,
      daypart,
      requestSource: SuggestionRequestSource.OnDemand,
      requestContext: suggestion.request_context,
      skinProfile: contextData.skinProfile,
      shelfActiveProducts: contextData.activeProducts,
      routineSteps: [],
      recentJournalEntries: contextData.recentJournal,
      recentApplications: contextData.recentApplications,
      recentRoutineBreaks: contextData.recentRoutineBreaks,
      aiPersonalizationAllowed: personalization.aiPersonalizationAllowed,
      aiPersonalizationBlockedReason: personalization.blockedReason,
    });

    return {
      slotId: null,
      requestSource: SuggestionRequestSource.OnDemand,
      requestContext: suggestion.request_context,
      scheduledSlotContext: null,
      targetDate,
      targetTime,
      daypart,
      skinProfile: contextData.skinProfile,
      shelfActiveProducts: contextData.activeProducts,
      shelfFinishedProductIds: contextData.finishedProductIds,
      routineSteps: [],
      recentJournalEntries: contextData.recentJournal,
      recentApplications: contextData.recentApplications,
      contextSummary,
      aiPersonalizationAllowed: personalization.aiPersonalizationAllowed,
      aiPersonalizationBlockedReason: personalization.blockedReason,
    };
  }

  private async evaluatePersonalization(
    userId: string,
    jobId: string,
  ): Promise<PersonalizationDecision> {
    const consentDecision = await this.consentService.evaluate(userId);
    const usageDecision = consentDecision.aiPersonalizationAllowed
      ? await this.usageGuard.evaluate(userId)
      : null;
    const aiPersonalizationAllowed =
      consentDecision.aiPersonalizationAllowed &&
      (usageDecision?.allowed ?? true);
    const blockedReason = !consentDecision.aiPersonalizationAllowed
      ? consentDecision.blockedReason
      : (usageDecision?.blockedReason ?? consentDecision.blockedReason);

    await this.recordPersonalizationObservability(
      userId,
      jobId,
      consentDecision,
      usageDecision,
    );

    return {
      consentDecision,
      aiPersonalizationAllowed,
      blockedReason,
    };
  }

  private async recordPersonalizationObservability(
    userId: string,
    jobId: string,
    consentDecision: SuggestionConsentDecision,
    usageDecision: SuggestionUsageDecision | null,
  ): Promise<void> {
    if (!consentDecision.aiPersonalizationAllowed) {
      await this.observability.record({
        kind: 'consent_degraded',
        severity: 'warning',
        userId,
        jobId,
        metadata: { reason: consentDecision.blockedReason },
      });
    }

    if (usageDecision && !usageDecision.allowed) {
      await this.observability.record({
        kind: 'ai_budget_blocked',
        severity: 'warning',
        userId,
        jobId,
        metadata: {
          reason: usageDecision.blockedReason,
          generationCountToday: usageDecision.generationCountToday,
          regenerationCountToday: usageDecision.regenerationCountToday,
          estimatedCostTodayUsd: usageDecision.estimatedCostTodayUsd,
        },
      });
    }
  }

  private async loadGenerationContextData(
    userId: string,
    targetDate: string,
    lastError: string | null,
    consentDecision: SuggestionConsentDecision,
  ): Promise<GenerationContextData> {
    const canReadSensitiveContext = consentDecision.canReadSensitiveContext;
    const skinProfile = canReadSensitiveContext
      ? await this.skinProfileRepo.findOne({
          where: { user_id: userId },
        })
      : null;
    const activeProducts = await this.inventoryRepo.find({
      where: { user_id: userId, status: ShelfStatus.Active },
    });
    const finishedProducts = await this.inventoryRepo.find({
      where: { user_id: userId, status: ShelfStatus.FinishedUp },
      select: ['id'],
    });
    const ignoreReactionContext =
      await this.todayActionService.shouldIgnoreReactionContext(
        userId,
        targetDate,
        lastError,
      );
    const recentJournalRows =
      canReadSensitiveContext && !ignoreReactionContext
        ? await this.journalRepo.find({
            where: { user_id: userId },
            order: { entry_date: 'DESC' },
            take: 7,
          })
        : [];
    const recentJournal =
      normalizeJournalEntriesForSuggestions(recentJournalRows);
    const recentApplications = canReadSensitiveContext
      ? await this.applicationLogRepo.find({
          where: { user_id: userId },
          relations: ['items'],
          order: { target_date: 'DESC' },
          take: 30,
        })
      : [];
    const recentRoutineBreaks = await this.routineBreakRepo.find({
      where: { user_id: userId },
      order: { starts_at: 'DESC' },
      take: 3,
    });

    return {
      skinProfile,
      activeProducts,
      finishedProductIds: finishedProducts.map((product) => product.id),
      recentJournal,
      recentApplications,
      recentRoutineBreaks,
    };
  }

  private async recordRecommendationDataAccess(
    userId: string,
    consentTypes: SensitiveSkinProfileConsentType[],
  ): Promise<void> {
    if (consentTypes.length === 0) return;
    await this.dataAccessLog.recordDataAccess(
      userId,
      consentTypes,
      UserDataAccessPurpose.RecommendationAnalysis,
      UserDataAccessActorType.System,
    );
  }
}

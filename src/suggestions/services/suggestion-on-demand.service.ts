import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, Repository } from 'typeorm';
import { toDateOnlyString, toTimeOnlyString } from '../../common/utils/date';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ShelfStatus } from '../../shelf/shelf.types';
import { User } from '../../users/entities/user.entity';
import { CreateOnDemandSuggestionDto } from '../dto/on-demand-suggestion.dto';
import { SuggestionInstanceResponseDto } from '../dto/suggestion-instance-response.dto';
import { SuggestionGenerationJob } from '../entities/suggestion-generation-job.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import {
  SUGGESTION_ON_DEMAND_COOLDOWN_MINUTES,
  SUGGESTION_ON_DEMAND_DAILY_USER_LIMIT,
  SuggestionGenerationJobStatus,
  SuggestionGenerationStatus,
  SuggestionMode,
  SuggestionRequestContextJson,
  SuggestionRequestSource,
} from '../suggestions.constants';
import {
  deriveSuggestionDaypart,
  formatDateInTimeZone,
  formatTimeInTimeZone,
} from './suggestion-helpers';
import { insertSuggestionGenerationJob } from './suggestion-generation-job-queue';
import { SuggestionAiUsageGuard } from './suggestion-ai-usage-guard.service';
import { SuggestionConsentService } from './suggestion-consent.service';
import { SuggestionObservabilityService } from './suggestion-observability.service';
import { RoutineBreakService } from './routine-break.service';
import {
  buildRequestContext,
  isUniqueConstraintError,
  normalizeRequestId,
} from './suggestion-on-demand.utils';

@Injectable()
export class SuggestionOnDemandService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SuggestionInstance)
    private readonly suggestionRepo: Repository<SuggestionInstance>,
    @InjectRepository(InventoryProduct)
    private readonly inventoryRepo: Repository<InventoryProduct>,
    private readonly routineBreakService: RoutineBreakService,
    private readonly usageGuard: SuggestionAiUsageGuard,
    private readonly consentService: SuggestionConsentService,
    private readonly observability: SuggestionObservabilityService,
  ) {}

  async create(
    user: User,
    requestTimeZone: string | null,
    payload: CreateOnDemandSuggestionDto,
  ): Promise<SuggestionInstanceResponseDto> {
    const requestId = normalizeRequestId(payload.requestId);
    const existing = requestId
      ? await this.findExistingRequest(user.id, requestId)
      : null;
    if (existing) {
      await this.recordDuplicateRequest(user.id, existing.id);
      return SuggestionInstanceResponseDto.fromEntity(existing);
    }

    if (await this.routineBreakService.isRoutineBreakActive(user.id)) {
      throw new ConflictException(
        'Routine is paused. Resume before requesting a quick suggestion.',
      );
    }

    await this.assertAiConsent(user.id);
    await this.assertAiBudget(user.id);
    const now = new Date();
    const timeZone = requestTimeZone ?? user.time_zone ?? 'UTC';
    const targetDate = formatDateInTimeZone(timeZone, now);
    await this.assertOnDemandRateLimit(user.id, targetDate, now);
    await this.assertShelfHasActiveProducts(user.id);

    const targetTime = formatTimeInTimeZone(timeZone, now);
    const requestContext = buildRequestContext(payload, now);
    let suggestion: SuggestionInstance;
    try {
      suggestion = await this.createQueuedSuggestion({
        user,
        requestId,
        requestContext,
        targetDate,
        targetTime,
        now,
      });
    } catch (error) {
      if (requestId && isUniqueConstraintError(error)) {
        const duplicate = await this.findExistingRequest(user.id, requestId);
        if (duplicate) {
          await this.recordDuplicateRequest(user.id, duplicate.id);
          return SuggestionInstanceResponseDto.fromEntity(duplicate);
        }
      }
      throw error;
    }

    await this.observability.record({
      kind: 'on_demand_requested',
      severity: 'info',
      userId: user.id,
      suggestionInstanceId: suggestion.id,
      metadata: {
        requestIdPresent: requestId !== null,
        intent: requestContext.intent,
        intensity: requestContext.intensity,
      },
    });
    return SuggestionInstanceResponseDto.fromEntity(suggestion);
  }

  async retryFailed(
    user: User,
    suggestionId: string,
  ): Promise<SuggestionInstanceResponseDto> {
    const suggestion = await this.suggestionRepo.findOne({
      where: {
        id: suggestionId,
        user_id: user.id,
        request_source: SuggestionRequestSource.OnDemand,
      },
      relations: ['steps'],
    });
    if (!suggestion) {
      throw new NotFoundException('On-demand suggestion not found.');
    }
    if (suggestion.generation_status !== SuggestionGenerationStatus.Failed) {
      return SuggestionInstanceResponseDto.fromEntity(suggestion);
    }

    if (await this.routineBreakService.isRoutineBreakActive(user.id)) {
      throw new ConflictException(
        'Routine is paused. Resume before retrying this suggestion.',
      );
    }
    await this.assertAiConsent(user.id);
    await this.assertAiBudget(user.id);
    await this.assertShelfHasActiveProducts(user.id);

    const now = new Date();
    const queued = await this.requeueFailedSuggestion(user.id, suggestion, now);
    await this.observability.record({
      kind: 'on_demand_retry_requested',
      severity: 'info',
      userId: user.id,
      suggestionInstanceId: queued.id,
      metadata: {
        intent: queued.request_context?.intent ?? null,
        retryFromStatus: SuggestionGenerationStatus.Failed,
      },
    });
    return SuggestionInstanceResponseDto.fromEntity(queued);
  }

  private async findExistingRequest(
    userId: string,
    requestId: string,
  ): Promise<SuggestionInstance | null> {
    return this.suggestionRepo.findOne({
      where: {
        user_id: userId,
        request_source: SuggestionRequestSource.OnDemand,
        request_id: requestId,
      },
      relations: ['steps'],
    });
  }

  private async createQueuedSuggestion(inputs: {
    user: User;
    requestId: string | null;
    requestContext: SuggestionRequestContextJson;
    targetDate: string;
    targetTime: string;
    now: Date;
  }): Promise<SuggestionInstance> {
    return this.dataSource.transaction(async (manager) => {
      const suggestionRepo = manager.getRepository(SuggestionInstance);
      const jobRepo = manager.getRepository(SuggestionGenerationJob);
      const suggestion = await suggestionRepo.save(
        suggestionRepo.create({
          user_id: inputs.user.id,
          slot_id: null,
          request_source: SuggestionRequestSource.OnDemand,
          request_id: inputs.requestId,
          request_context: inputs.requestContext,
          target_date: inputs.targetDate,
          target_time: inputs.targetTime,
          daypart: deriveSuggestionDaypart(inputs.targetTime),
          mode: SuggestionMode.Ai,
          generation_status: SuggestionGenerationStatus.Generating,
          visible_at: inputs.now,
          generated_at: null,
          ai_model: null,
          ai_prompt_version: null,
          ai_input_tokens: null,
          ai_output_tokens: null,
          ai_total_tokens: null,
          ai_estimated_cost_usd: null,
          ai_duration_ms: null,
          ai_explanation: null,
          generation_context: null,
          gap_recommendations: null,
          safety_flags: null,
          has_reaction_signal: false,
          simplified_for_reaction: false,
          supersedes_id: null,
          ai_error: null,
          ai_retry_count: 0,
        }),
      );

      await insertSuggestionGenerationJob(jobRepo, {
        user_id: inputs.user.id,
        slot_id: null,
        suggestion_instance_id: suggestion.id,
        request_source: SuggestionRequestSource.OnDemand,
        target_date: inputs.targetDate,
        target_time: inputs.targetTime,
        visible_at: inputs.now,
        status: SuggestionGenerationJobStatus.Queued,
        attempt_count: 0,
        run_after: inputs.now,
        last_error: null,
      });

      return suggestion;
    });
  }

  private async requeueFailedSuggestion(
    userId: string,
    suggestion: SuggestionInstance,
    now: Date,
  ): Promise<SuggestionInstance> {
    return this.dataSource.transaction(async (manager) => {
      const suggestionRepo = manager.getRepository(SuggestionInstance);
      const jobRepo = manager.getRepository(SuggestionGenerationJob);
      const queued = await suggestionRepo.save({
        ...suggestion,
        generation_status: SuggestionGenerationStatus.Generating,
        ai_error: null,
        ai_retry_count: 0,
      });
      const job = await jobRepo.findOne({
        where: {
          user_id: userId,
          suggestion_instance_id: suggestion.id,
          request_source: SuggestionRequestSource.OnDemand,
        },
      });
      if (job) {
        await jobRepo.update(
          { id: job.id },
          {
            status: SuggestionGenerationJobStatus.Queued,
            attempt_count: 0,
            run_after: now,
            locked_at: null,
            locked_by: null,
            last_error: null,
          },
        );
      } else {
        await insertSuggestionGenerationJob(jobRepo, {
          user_id: userId,
          slot_id: null,
          suggestion_instance_id: suggestion.id,
          request_source: SuggestionRequestSource.OnDemand,
          target_date: toDateOnlyString(suggestion.target_date),
          target_time: toTimeOnlyString(suggestion.target_time),
          visible_at: suggestion.visible_at ?? now,
          status: SuggestionGenerationJobStatus.Queued,
          attempt_count: 0,
          run_after: now,
          last_error: null,
        });
      }
      return queued;
    });
  }

  private async assertAiConsent(userId: string): Promise<void> {
    const consent = await this.consentService.evaluate(userId);
    if (consent.aiPersonalizationAllowed) return;
    await this.observability.record({
      kind: 'consent_degraded',
      severity: 'warning',
      userId,
      metadata: {
        reason: consent.blockedReason,
      },
    });
    throw new ForbiddenException(
      'AI suggestion consent is required before requesting a quick suggestion.',
    );
  }

  private async assertAiBudget(userId: string): Promise<void> {
    const usageDecision = await this.usageGuard.evaluate(userId);
    if (usageDecision.allowed) return;
    await this.observability.record({
      kind: 'ai_budget_blocked',
      severity: 'warning',
      userId,
      metadata: {
        reason: usageDecision.blockedReason,
        generationCountToday: usageDecision.generationCountToday,
        regenerationCountToday: usageDecision.regenerationCountToday,
        estimatedCostTodayUsd: usageDecision.estimatedCostTodayUsd,
      },
    });
    throw new HttpException(
      'Daily AI suggestion budget reached. Try again tomorrow.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private async assertOnDemandRateLimit(
    userId: string,
    targetDate: string,
    now: Date,
  ): Promise<void> {
    const countToday = await this.suggestionRepo.count({
      where: {
        user_id: userId,
        request_source: SuggestionRequestSource.OnDemand,
        target_date: targetDate,
        generation_status: Not(SuggestionGenerationStatus.Superseded),
      },
    });
    if (countToday >= SUGGESTION_ON_DEMAND_DAILY_USER_LIMIT) {
      throw new HttpException(
        'Daily quick suggestion limit reached. Try again tomorrow.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const latest = await this.suggestionRepo.findOne({
      where: {
        user_id: userId,
        request_source: SuggestionRequestSource.OnDemand,
        generation_status: Not(SuggestionGenerationStatus.Superseded),
      },
      select: ['id', 'created_at'],
      order: { created_at: 'DESC' },
    });
    const latestCreatedAt = latest?.created_at?.getTime();
    if (
      typeof latestCreatedAt === 'number' &&
      now.getTime() - latestCreatedAt <
        SUGGESTION_ON_DEMAND_COOLDOWN_MINUTES * 60_000
    ) {
      throw new HttpException(
        'Wait a moment before requesting another quick suggestion.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async assertShelfHasActiveProducts(userId: string): Promise<void> {
    const activeProductCount = await this.inventoryRepo.count({
      where: { user_id: userId, status: ShelfStatus.Active },
    });
    if (activeProductCount > 0) return;
    throw new BadRequestException(
      'Add at least one active shelf product before requesting a suggestion.',
    );
  }

  private async recordDuplicateRequest(
    userId: string,
    suggestionInstanceId: string,
  ): Promise<void> {
    await this.observability.record({
      kind: 'on_demand_duplicate_request',
      severity: 'info',
      userId,
      suggestionInstanceId,
      metadata: {
        reusedExistingSuggestion: true,
      },
    });
  }
}

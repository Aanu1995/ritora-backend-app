import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { CataloguePhotoStorageService } from '../../catalogue/catalogue-photo-storage.service';
import { toDateOnlyString, toTimeOnlyString } from '../../common/utils/date';
import { resolveEffectiveTimeZone } from '../../common/timezone/timezone.utils';
import { ProductImageUrlResolverOptions } from '../../inventory/product-image-url-resolver';
import { ScheduleSlot } from '../../schedule/entities/schedule-slot.entity';
import { User } from '../../users/entities/user.entity';
import { RegenerateSuggestionDto } from '../dto/suggestion-history.dto';
import { SuggestionInstanceResponseDto } from '../dto/suggestion-instance-response.dto';
import { SuggestionGenerationJob } from '../entities/suggestion-generation-job.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import {
  SuggestionGenerationJobStatus,
  SuggestionGenerationStatus,
  SuggestionRequestSource,
} from '../suggestions.constants';
import { requeueSuggestionGenerationJob } from './suggestion-generation-job-queue';
import { SuggestionAiUsageGuard } from './suggestion-ai-usage-guard.service';
import { SuggestionObservabilityService } from './suggestion-observability.service';
import { RoutineBreakService } from './routine-break.service';
import { hasScheduledSlotElapsed } from './suggestion-scheduled-job-guards';

@Injectable()
export class SuggestionRegenerationService {
  constructor(
    @InjectRepository(SuggestionInstance)
    private readonly suggestionRepo: Repository<SuggestionInstance>,
    @InjectRepository(SuggestionGenerationJob)
    private readonly jobRepo: Repository<SuggestionGenerationJob>,
    @InjectRepository(ScheduleSlot)
    private readonly slotRepo: Repository<ScheduleSlot>,
    private readonly usageGuard: SuggestionAiUsageGuard,
    private readonly observability: SuggestionObservabilityService,
    private readonly routineBreakService: RoutineBreakService,
    private readonly cataloguePhotoStorageService: CataloguePhotoStorageService,
  ) {}

  async regenerateSuggestion(
    user: User,
    suggestionId: string,
    payload: RegenerateSuggestionDto,
  ): Promise<SuggestionInstanceResponseDto> {
    const existing = await this.suggestionRepo.findOne({
      where: { id: suggestionId },
    });
    if (!existing) {
      throw new NotFoundException('Suggestion not found.');
    }
    if (existing.user_id !== user.id) {
      throw new ForbiddenException('Suggestion belongs to another user.');
    }
    if (!existing.slot_id) {
      throw new ConflictException(
        'This suggestion is no longer linked to a schedule.',
      );
    }
    if (await this.routineBreakService.isRoutineBreakActive(user.id)) {
      throw new ConflictException(
        'Routine is paused. Resume before regenerating suggestions.',
      );
    }

    const activeSlot = await this.slotRepo.findOne({
      where: {
        id: existing.slot_id,
        user_id: user.id,
        deleted_at: IsNull(),
      },
      select: ['id'],
    });
    if (!activeSlot) {
      throw new ConflictException(
        'This suggestion is linked to a schedule that was removed.',
      );
    }

    const targetDate = toDateOnlyString(existing.target_date);
    const targetTime = toTimeOnlyString(existing.target_time);
    const timeZone = resolveEffectiveTimeZone(user.time_zone, null);
    if (
      hasScheduledSlotElapsed({
        targetDate,
        targetTime,
        timeZone,
      })
    ) {
      throw new ConflictException('This suggestion time has already passed.');
    }

    const usageDecision = await this.usageGuard.evaluateRegeneration(user.id);
    if (!usageDecision.allowed) {
      await this.observability.record({
        kind: 'ai_budget_blocked',
        severity: 'warning',
        userId: user.id,
        suggestionInstanceId: existing.id,
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

    existing.generation_status = SuggestionGenerationStatus.Superseded;
    await this.suggestionRepo.save(existing);

    const now = new Date();
    const replacement = await this.suggestionRepo.save(
      this.suggestionRepo.create({
        user_id: user.id,
        slot_id: existing.slot_id,
        request_source: SuggestionRequestSource.Scheduled,
        request_id: null,
        request_context: null,
        target_date: targetDate,
        target_time: targetTime,
        daypart: existing.daypart,
        mode: existing.mode,
        generation_status: SuggestionGenerationStatus.Pending,
        visible_at: now,
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
        has_reaction_signal: existing.has_reaction_signal,
        simplified_for_reaction: existing.simplified_for_reaction,
        supersedes_id: existing.id,
        ai_error: null,
        ai_retry_count: 0,
      }),
    );

    await requeueSuggestionGenerationJob(this.jobRepo, {
      user_id: user.id,
      slot_id: existing.slot_id,
      target_date: targetDate,
      target_time: targetTime,
      visible_at: now,
      status: SuggestionGenerationJobStatus.Queued,
      attempt_count: 0,
      run_after: now,
      last_error: payload.reason ? `regenerate:${payload.reason}` : null,
    });

    return SuggestionInstanceResponseDto.fromEntity(
      replacement,
      this.productImageOptions(),
    );
  }

  private productImageOptions(): ProductImageUrlResolverOptions {
    return {
      resolveProductImageUrls: (imageUrls) =>
        this.cataloguePhotoStorageService.resolvePublicImageUrls(imageUrls),
    };
  }
}

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeleteResult, LessThan, Repository, UpdateResult } from 'typeorm';
import { SuggestionContextCache } from '../entities/suggestion-context-cache.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { SuggestionGapAction } from '../entities/suggestion-gap-action.entity';
import { SuggestionReactionOverride } from '../entities/suggestion-reaction-override.entity';
import { SuggestionRecordingReminderSnooze } from '../entities/suggestion-recording-reminder-snooze.entity';
import {
  SUGGESTION_CONTEXT_CACHE_RETENTION_DAYS,
  SUGGESTION_GENERATION_CONTEXT_RETENTION_DAYS,
  SUGGESTION_RETENTION_INITIAL_DELAY_MS,
  SUGGESTION_RETENTION_SWEEP_INTERVAL_MS,
} from '../suggestions.constants';
import { SuggestionObservabilityService } from './suggestion-observability.service';

@Injectable()
export class SuggestionRetentionService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SuggestionRetentionService.name);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;

  constructor(
    @InjectRepository(SuggestionContextCache)
    private readonly contextCacheRepo: Repository<SuggestionContextCache>,
    @InjectRepository(SuggestionInstance)
    private readonly suggestionRepo: Repository<SuggestionInstance>,
    @InjectRepository(SuggestionGapAction)
    private readonly gapActionRepo: Repository<SuggestionGapAction>,
    @InjectRepository(SuggestionReactionOverride)
    private readonly overrideRepo: Repository<SuggestionReactionOverride>,
    @InjectRepository(SuggestionRecordingReminderSnooze)
    private readonly reminderSnoozeRepo: Repository<SuggestionRecordingReminderSnooze>,
    private readonly observability: SuggestionObservabilityService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.stopped = false;
    this.schedule(SUGGESTION_RETENTION_INITIAL_DELAY_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async purgeExpiredSensitiveData(now = new Date()): Promise<{
    contextCachesDeleted: number;
    sensitiveSuggestionFieldsCleared: number;
  }> {
    const cacheCutoff = subtractDays(
      now,
      SUGGESTION_CONTEXT_CACHE_RETENTION_DAYS,
    );
    const contextCutoff = subtractDays(
      now,
      SUGGESTION_GENERATION_CONTEXT_RETENTION_DAYS,
    );

    const cacheResult = await this.contextCacheRepo.delete({
      updated_at: LessThan(cacheCutoff),
    });
    await this.overrideRepo.delete({ expires_at: LessThan(now) });
    await this.reminderSnoozeRepo.delete({ snoozed_until: LessThan(now) });
    const contextResult = await this.suggestionRepo
      .createQueryBuilder()
      .update()
      .set({
        ai_explanation: null,
        generation_context: null,
        request_context: null,
      })
      .where(
        '(ai_explanation IS NOT NULL OR generation_context IS NOT NULL OR request_context IS NOT NULL)',
      )
      .andWhere('generated_at IS NOT NULL')
      .andWhere('generated_at < :contextCutoff', { contextCutoff })
      .execute();

    const contextCachesDeleted = affected(cacheResult);
    const sensitiveSuggestionFieldsCleared = affected(contextResult);
    if (contextCachesDeleted > 0 || sensitiveSuggestionFieldsCleared > 0) {
      await this.observability.record({
        kind: 'retention_purged',
        metadata: {
          contextCachesDeleted,
          sensitiveSuggestionFieldsCleared,
        },
      });
    }

    return { contextCachesDeleted, sensitiveSuggestionFieldsCleared };
  }

  async purgeUserSuggestionData(userId: string): Promise<void> {
    await this.contextCacheRepo.delete({ user_id: userId });
    await this.gapActionRepo.delete({ user_id: userId });
    await this.overrideRepo.delete({ user_id: userId });
    await this.reminderSnoozeRepo.delete({ user_id: userId });
    await this.suggestionRepo
      .createQueryBuilder()
      .update()
      .set({
        ai_explanation: null,
        generation_context: null,
        request_context: null,
        gap_recommendations: null,
        safety_flags: null,
        ai_error: null,
      })
      .where('user_id = :userId', { userId })
      .execute();
    await this.observability.record({
      kind: 'retention_purged',
      userId,
      metadata: { userScopedPurge: true },
    });
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.purgeExpiredSensitiveData()
        .catch((error) => {
          this.logger.warn(
            `Suggestion retention sweep failed: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          );
        })
        .finally(() => {
          if (!this.stopped) {
            this.schedule(SUGGESTION_RETENTION_SWEEP_INTERVAL_MS);
          }
        });
    }, delayMs);
    this.timer.unref?.();
  }
}

function subtractDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 86_400_000);
}

function affected(result: DeleteResult | UpdateResult): number {
  return result.affected ?? 0;
}

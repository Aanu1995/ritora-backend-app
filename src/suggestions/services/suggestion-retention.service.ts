import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DeleteResult,
  LessThan,
  QueryDeepPartialEntity,
  Repository,
  UpdateResult,
} from 'typeorm';
import {
  ENVIRONMENT_LOCATION_CACHE_TTL_DAYS,
  ENVIRONMENT_SNAPSHOT_RETENTION_DAYS,
} from '../../environment-intelligence/environment-intelligence.constants';
import { EnvironmentLocationCache } from '../../environment-intelligence/entities/environment-location-cache.entity';
import { EnvironmentSnapshot } from '../../environment-intelligence/entities/environment-snapshot.entity';
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

const EXPIRED_SUGGESTION_SENSITIVE_FIELD_CLEAR: QueryDeepPartialEntity<SuggestionInstance> =
  {
    ai_explanation: () => 'NULL',
    generation_context: () => 'NULL',
    request_context: () => 'NULL',
  };

const USER_SUGGESTION_SENSITIVE_FIELD_CLEAR: QueryDeepPartialEntity<SuggestionInstance> =
  {
    ...EXPIRED_SUGGESTION_SENSITIVE_FIELD_CLEAR,
    gap_recommendations: () => 'NULL',
    safety_flags: () => 'NULL',
    ai_error: () => 'NULL',
  };

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
    @InjectRepository(EnvironmentLocationCache)
    private readonly environmentLocationRepo: Repository<EnvironmentLocationCache>,
    @InjectRepository(EnvironmentSnapshot)
    private readonly environmentSnapshotRepo: Repository<EnvironmentSnapshot>,
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
    environmentSnapshotsDeleted: number;
    environmentLocationCachesDeleted: number;
  }> {
    const cacheCutoff = subtractDays(
      now,
      SUGGESTION_CONTEXT_CACHE_RETENTION_DAYS,
    );
    const contextCutoff = subtractDays(
      now,
      SUGGESTION_GENERATION_CONTEXT_RETENTION_DAYS,
    );
    const environmentSnapshotCutoff = subtractDays(
      now,
      ENVIRONMENT_SNAPSHOT_RETENTION_DAYS,
    );
    const locationCutoff = subtractDays(
      now,
      ENVIRONMENT_LOCATION_CACHE_TTL_DAYS,
    );

    const cacheResult = await this.contextCacheRepo.delete({
      updated_at: LessThan(cacheCutoff),
    });
    await this.overrideRepo.delete({ expires_at: LessThan(now) });
    await this.reminderSnoozeRepo.delete({ snoozed_until: LessThan(now) });
    const environmentSnapshotResult = await this.environmentSnapshotRepo.delete(
      {
        created_at: LessThan(environmentSnapshotCutoff),
      },
    );
    const environmentLocationResult = await this.environmentLocationRepo.delete(
      {
        refreshed_at: LessThan(locationCutoff),
      },
    );
    const contextResult = await this.suggestionRepo
      .createQueryBuilder()
      .update()
      .set(EXPIRED_SUGGESTION_SENSITIVE_FIELD_CLEAR)
      .where(
        '(ai_explanation IS NOT NULL OR generation_context IS NOT NULL OR request_context IS NOT NULL)',
      )
      .andWhere('generated_at IS NOT NULL')
      .andWhere('generated_at < :contextCutoff', { contextCutoff })
      .execute();

    const contextCachesDeleted = affected(cacheResult);
    const sensitiveSuggestionFieldsCleared = affected(contextResult);
    const environmentSnapshotsDeleted = affected(environmentSnapshotResult);
    const environmentLocationCachesDeleted = affected(
      environmentLocationResult,
    );
    if (
      contextCachesDeleted > 0 ||
      sensitiveSuggestionFieldsCleared > 0 ||
      environmentSnapshotsDeleted > 0 ||
      environmentLocationCachesDeleted > 0
    ) {
      await this.observability.record({
        kind: 'retention_purged',
        metadata: {
          contextCachesDeleted,
          sensitiveSuggestionFieldsCleared,
          environmentSnapshotsDeleted,
          environmentLocationCachesDeleted,
        },
      });
    }

    return {
      contextCachesDeleted,
      sensitiveSuggestionFieldsCleared,
      environmentSnapshotsDeleted,
      environmentLocationCachesDeleted,
    };
  }

  async purgeUserSuggestionData(userId: string): Promise<{
    contextCachesDeleted: number;
    gapActionsDeleted: number;
    reactionOverridesDeleted: number;
    reminderSnoozesDeleted: number;
    environmentSnapshotsDeleted: number;
    environmentLocationCachesDeleted: number;
    suggestionFieldsCleared: number;
  }> {
    const cacheResult = await this.contextCacheRepo.delete({ user_id: userId });
    const gapActionResult = await this.gapActionRepo.delete({
      user_id: userId,
    });
    const overrideResult = await this.overrideRepo.delete({ user_id: userId });
    const reminderSnoozeResult = await this.reminderSnoozeRepo.delete({
      user_id: userId,
    });
    const environmentSnapshotResult = await this.environmentSnapshotRepo.delete(
      {
        user_id: userId,
      },
    );
    const environmentLocationResult = await this.environmentLocationRepo.delete(
      {
        user_id: userId,
      },
    );
    const suggestionResult = await this.suggestionRepo
      .createQueryBuilder()
      .update()
      .set(USER_SUGGESTION_SENSITIVE_FIELD_CLEAR)
      .where('user_id = :userId', { userId })
      .execute();
    const result = {
      contextCachesDeleted: affected(cacheResult),
      gapActionsDeleted: affected(gapActionResult),
      reactionOverridesDeleted: affected(overrideResult),
      reminderSnoozesDeleted: affected(reminderSnoozeResult),
      environmentSnapshotsDeleted: affected(environmentSnapshotResult),
      environmentLocationCachesDeleted: affected(environmentLocationResult),
      suggestionFieldsCleared: affected(suggestionResult),
    };
    await this.observability.record({
      kind: 'retention_purged',
      userId,
      metadata: { userScopedPurge: true, ...result },
    });
    return result;
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

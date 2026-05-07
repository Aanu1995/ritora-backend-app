import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, LessThan, Not, Repository } from 'typeorm';
import { ulid } from 'ulid';
import { toDateOnlyString, toTimeOnlyString } from '../../common/utils/date';
import { SuggestionGenerationJob } from '../entities/suggestion-generation-job.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import {
  SUGGESTION_GENERATION_MAX_ATTEMPTS,
  SUGGESTION_GENERATION_POLL_INTERVAL_MS,
  SUGGESTION_JOB_LOCK_TIMEOUT_MINUTES,
  SUGGESTION_STALE_JOB_REAPER_BATCH_SIZE,
  ROUTINE_BREAK_SUPPRESSED_JOB_REASON,
  SuggestionGenerationJobStatus,
  SuggestionGenerationStatus,
  SuggestionRequestSource,
} from '../suggestions.constants';
import { RoutineBreakService } from './routine-break.service';
import { SuggestionGenerationService } from './suggestion-generation.service';
import { SuggestionObservabilityService } from './suggestion-observability.service';

@Injectable()
export class SuggestionGenerationWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SuggestionGenerationWorker.name);
  private readonly workerId = `suggestion-${ulid()}`;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private stopped = true;
  private readonly enabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly generationService: SuggestionGenerationService,
    @InjectRepository(SuggestionGenerationJob)
    private readonly jobRepo: Repository<SuggestionGenerationJob>,
    @InjectRepository(SuggestionInstance)
    private readonly suggestionRepo: Repository<SuggestionInstance>,
    private readonly observability: SuggestionObservabilityService,
    private readonly routineBreakService: RoutineBreakService,
  ) {
    this.enabled = this.configService.get<string>('NODE_ENV') !== 'test';
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log(
        'Suggestion generation worker disabled in test environment.',
      );
      return;
    }
    this.stopped = false;
    this.schedulePoll(0);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async pollOnce(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      await this.recoverStaleRunningJobs();
      const job = await this.claimNextJob();
      if (!job) return;
      try {
        if (await this.routineBreakService.isRoutineBreakActive(job.user_id)) {
          await this.cancelJobForRoutineBreak(job);
          return;
        }
        await this.markSuggestionGenerating(job);
        await this.generationService.generateForJob(job);
        await this.jobRepo.update(
          { id: job.id },
          {
            status: SuggestionGenerationJobStatus.Completed,
            last_error: null,
            locked_at: null,
            locked_by: null,
          },
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'unknown error';
        this.logger.error(
          `Job ${job.id} failed for ${formatJobTarget(job)} on ${job.target_date}: ${message}`,
        );
        const nextAttemptCount = job.attempt_count + 1;
        const nextStatus =
          nextAttemptCount >= SUGGESTION_GENERATION_MAX_ATTEMPTS
            ? SuggestionGenerationJobStatus.Failed
            : SuggestionGenerationJobStatus.Queued;
        if (nextStatus === SuggestionGenerationJobStatus.Failed) {
          await this.markSuggestionFailed(job, message);
          await this.observability.record({
            kind: 'generation_failed',
            severity: 'critical',
            userId: job.user_id,
            jobId: job.id,
            suggestionInstanceId: job.suggestion_instance_id ?? null,
            metadata: {
              message,
              attemptCount: nextAttemptCount,
              requestSource: job.request_source,
            },
          });
        }
        await this.jobRepo.update(
          { id: job.id },
          {
            status: nextStatus,
            attempt_count: nextAttemptCount,
            run_after: new Date(Date.now() + retryDelayMs(nextAttemptCount)),
            last_error: message,
            locked_at: null,
            locked_by: null,
          },
        );
      }
    } finally {
      this.polling = false;
    }
  }

  private async markSuggestionFailed(
    job: SuggestionGenerationJob,
    message: string,
  ): Promise<void> {
    if (job.request_source === SuggestionRequestSource.OnDemand) {
      await this.suggestionRepo.update(
        {
          user_id: job.user_id,
          id: job.suggestion_instance_id ?? '',
          generation_status: Not(SuggestionGenerationStatus.Superseded),
        },
        {
          generation_status: SuggestionGenerationStatus.Failed,
          ai_error: message,
          ai_retry_count: job.attempt_count + 1,
        },
      );
      return;
    }

    const where = scheduledSuggestionWhere(
      job,
      Not(SuggestionGenerationStatus.Superseded),
    );
    if (!where) return;
    await this.suggestionRepo.update(where, {
      generation_status: SuggestionGenerationStatus.Failed,
      ai_error: message,
      ai_retry_count: job.attempt_count + 1,
    });
  }

  private async cancelJobForRoutineBreak(
    job: SuggestionGenerationJob,
  ): Promise<void> {
    if (job.request_source === SuggestionRequestSource.OnDemand) {
      await this.suggestionRepo.update(
        {
          user_id: job.user_id,
          id: job.suggestion_instance_id ?? '',
          generation_status: Not(SuggestionGenerationStatus.Ready),
        },
        {
          generation_status: SuggestionGenerationStatus.Failed,
          ai_error: ROUTINE_BREAK_SUPPRESSED_JOB_REASON,
        },
      );
      await this.jobRepo.update(
        { id: job.id },
        {
          status: SuggestionGenerationJobStatus.Cancelled,
          last_error: ROUTINE_BREAK_SUPPRESSED_JOB_REASON,
          locked_at: null,
          locked_by: null,
        },
      );
      return;
    }

    const where = scheduledSuggestionWhere(
      job,
      SuggestionGenerationStatus.Pending,
    );
    if (!where) return;
    await this.suggestionRepo.update(where, {
      generation_status: SuggestionGenerationStatus.Superseded,
      ai_error: ROUTINE_BREAK_SUPPRESSED_JOB_REASON,
    });
    await this.jobRepo.update(
      { id: job.id },
      {
        status: SuggestionGenerationJobStatus.Cancelled,
        last_error: ROUTINE_BREAK_SUPPRESSED_JOB_REASON,
        locked_at: null,
        locked_by: null,
      },
    );
  }

  private async recoverStaleRunningJobs(now = new Date()): Promise<void> {
    const cutoff = new Date(
      now.getTime() - SUGGESTION_JOB_LOCK_TIMEOUT_MINUTES * 60_000,
    );
    const staleJobs = await this.jobRepo.find({
      where: {
        status: SuggestionGenerationJobStatus.Running,
        locked_at: LessThan(cutoff),
      },
      order: { locked_at: 'ASC' },
      take: SUGGESTION_STALE_JOB_REAPER_BATCH_SIZE,
    });
    for (const staleJob of staleJobs) {
      const job = normalizeClaimedJob(staleJob);
      const nextAttemptCount = job.attempt_count + 1;
      const message = `stale lock recovered after ${SUGGESTION_JOB_LOCK_TIMEOUT_MINUTES} minutes`;
      if (nextAttemptCount >= SUGGESTION_GENERATION_MAX_ATTEMPTS) {
        await this.markSuggestionFailed(job, message);
        await this.jobRepo.update(
          { id: job.id },
          {
            status: SuggestionGenerationJobStatus.Failed,
            attempt_count: nextAttemptCount,
            last_error: message,
            locked_at: null,
            locked_by: null,
          },
        );
        await this.observability.record({
          kind: 'job_dead_lettered',
          severity: 'critical',
          userId: job.user_id,
          jobId: job.id,
          metadata: { attemptCount: nextAttemptCount, reason: message },
        });
        continue;
      }

      await this.jobRepo.update(
        { id: job.id },
        {
          status: SuggestionGenerationJobStatus.Queued,
          attempt_count: nextAttemptCount,
          run_after: now,
          last_error: message,
          locked_at: null,
          locked_by: null,
        },
      );
      await this.observability.record({
        kind: 'job_recovered',
        severity: 'warning',
        userId: job.user_id,
        jobId: job.id,
        metadata: { attemptCount: nextAttemptCount, reason: message },
      });
    }
  }

  private async markSuggestionGenerating(
    job: SuggestionGenerationJob,
  ): Promise<void> {
    if (job.request_source === SuggestionRequestSource.OnDemand) {
      await this.suggestionRepo.update(
        {
          user_id: job.user_id,
          id: job.suggestion_instance_id ?? '',
          generation_status: Not(SuggestionGenerationStatus.Ready),
        },
        {
          generation_status: SuggestionGenerationStatus.Generating,
          ai_error: null,
        },
      );
      return;
    }

    const where = scheduledSuggestionWhere(
      job,
      SuggestionGenerationStatus.Pending,
    );
    if (!where) return;
    await this.suggestionRepo.update(where, {
      generation_status: SuggestionGenerationStatus.Generating,
      ai_error: null,
    });
  }

  private async claimNextJob(): Promise<SuggestionGenerationJob | null> {
    const now = new Date();
    // Atomic claim: only one worker can pick a job up at a time.
    const result = await this.jobRepo
      .createQueryBuilder()
      .update()
      .set({
        status: SuggestionGenerationJobStatus.Running,
        locked_at: now,
        locked_by: this.workerId,
      })
      .where(
        `id = ( SELECT "id" FROM suggestion_generation_jobs WHERE status = :queuedStatus AND run_after <= :now ORDER BY run_after ASC LIMIT 1 FOR UPDATE SKIP LOCKED )`,
        { now, queuedStatus: SuggestionGenerationJobStatus.Queued },
      )
      .returning('*')
      .execute();

    const raw = result.raw as SuggestionGenerationJobRaw[] | undefined;
    if (!raw || raw.length === 0) return null;
    return normalizeClaimedJob(raw[0]);
  }

  private schedulePoll(delayMs: number): void {
    if (this.stopped) return;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.pollTimer = setTimeout(() => {
      void this.pollOnce()
        .catch((error) => {
          this.logger.error(
            'Suggestion generation worker poll failed',
            error instanceof Error ? error.stack : String(error),
          );
        })
        .finally(() => {
          if (this.enabled && !this.stopped) {
            this.schedulePoll(SUGGESTION_GENERATION_POLL_INTERVAL_MS);
          }
        });
    }, delayMs);
    this.pollTimer.unref?.();
  }
}

type SuggestionGenerationJobRaw = Omit<
  SuggestionGenerationJob,
  'target_date' | 'target_time'
> & {
  target_date: string | Date;
  target_time: string | Date;
};

function normalizeClaimedJob(
  raw: SuggestionGenerationJobRaw,
): SuggestionGenerationJob {
  return {
    ...raw,
    target_date: toDateOnlyString(raw.target_date),
    target_time: toTimeOnlyString(raw.target_time),
  };
}

function formatJobTarget(job: SuggestionGenerationJob): string {
  return job.request_source === SuggestionRequestSource.OnDemand
    ? `on-demand suggestion ${job.suggestion_instance_id ?? 'unknown'}`
    : `slot ${job.slot_id ?? 'unknown'}`;
}

function scheduledSuggestionWhere(
  job: SuggestionGenerationJob,
  generationStatus: FindOptionsWhere<SuggestionInstance>['generation_status'],
): FindOptionsWhere<SuggestionInstance> | null {
  if (job.slot_id) {
    return {
      user_id: job.user_id,
      slot_id: job.slot_id,
      target_date: job.target_date,
      generation_status: generationStatus,
    };
  }
  if (job.suggestion_instance_id) {
    return {
      user_id: job.user_id,
      id: job.suggestion_instance_id,
      generation_status: generationStatus,
    };
  }
  return null;
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, attemptCount - 1));
}

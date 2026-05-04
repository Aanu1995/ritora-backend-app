import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { ulid } from 'ulid';
import { toDateOnlyString, toTimeOnlyString } from '../../common/utils/date';
import { SuggestionGenerationJob } from '../entities/suggestion-generation-job.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { SUGGESTION_GENERATION_POLL_INTERVAL_MS } from '../suggestions.constants';
import { SuggestionGenerationService } from './suggestion-generation.service';

/**
 * Polls `suggestion_generation_jobs` and runs them. Mirrors the existing
 * skin-journal-analysis worker pattern: at-most-one in-flight poll per
 * instance, atomic claim via an UPDATE that sets locked_at + locked_by,
 * retry up to 3 times then mark failed.
 *
 * Disabled only in tests. The scheduler in this same process inserts new jobs
 * as visibility windows open.
 */
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

  /**
   * Public for tests + manual triggering. Claims at most one job and
   * processes it. Idempotent: concurrent calls are serialised via the
   * `polling` flag.
   */
  async pollOnce(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const job = await this.claimNextJob();
      if (!job) return;
      try {
        await this.markSuggestionGenerating(job);
        await this.generationService.generateForJob(job);
        await this.jobRepo.update(
          { id: job.id },
          { status: 'completed', last_error: null },
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'unknown error';
        this.logger.error(
          `Job ${job.id} failed for slot ${job.slot_id} on ${job.target_date}: ${message}`,
        );
        const nextStatus = job.attempt_count + 1 >= 3 ? 'failed' : 'queued';
        if (nextStatus === 'failed') {
          await this.markSuggestionFailed(job, message);
        }
        await this.jobRepo.update(
          { id: job.id },
          {
            status: nextStatus,
            attempt_count: job.attempt_count + 1,
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
    await this.suggestionRepo.update(
      {
        user_id: job.user_id,
        slot_id: job.slot_id,
        target_date: job.target_date,
        generation_status: Not('superseded' as const),
      },
      {
        generation_status: 'failed',
        ai_error: message,
        ai_retry_count: job.attempt_count + 1,
      },
    );
  }

  private async markSuggestionGenerating(
    job: SuggestionGenerationJob,
  ): Promise<void> {
    await this.suggestionRepo.update(
      {
        user_id: job.user_id,
        slot_id: job.slot_id,
        target_date: job.target_date,
        generation_status: 'pending',
      },
      {
        generation_status: 'generating',
        ai_error: null,
      },
    );
  }

  private async claimNextJob(): Promise<SuggestionGenerationJob | null> {
    const now = new Date();
    // Atomic claim: only one worker can pick a job up at a time.
    const result = await this.jobRepo
      .createQueryBuilder()
      .update()
      .set({
        status: 'running',
        locked_at: now,
        locked_by: this.workerId,
      })
      .where(
        `id = ( SELECT "id" FROM suggestion_generation_jobs WHERE status = 'queued' AND run_after <= :now ORDER BY run_after ASC LIMIT 1 FOR UPDATE SKIP LOCKED )`,
        { now },
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

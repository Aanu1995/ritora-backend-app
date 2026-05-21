import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ulid } from 'ulid';
import { User } from '../../users/entities/user.entity';
import { SmartPickGenerationJob } from '../entities/smart-pick-generation-job.entity';
import {
  SmartPicksGenerationJobStatus,
  SmartPicksProductGenerationReason,
  SmartPicksProductGenerationState,
  SmartPicksProductGenerationStatus,
} from '../smart-picks.types';
import {
  SmartPicksGenerationQueueService,
  type SmartPicksQueueMessage,
} from './smart-picks-generation-queue.service';
import { SmartPicksOverviewService } from './smart-picks-overview.service';

const SMART_PICKS_GENERATION_POLL_INTERVAL_MS = 10_000;

@Injectable()
export class SmartPicksGenerationWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SmartPicksGenerationWorker.name);
  private readonly workerId = `smart-picks-${ulid()}`;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private stopped = true;
  private readonly enabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly queue: SmartPicksGenerationQueueService,
    @InjectRepository(SmartPickGenerationJob)
    private readonly jobRepo: Repository<SmartPickGenerationJob>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly overviewService: SmartPicksOverviewService,
  ) {
    this.enabled = this.configService.get<string>('NODE_ENV') !== 'test';
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log(
        'Smart Picks generation worker disabled in test environment.',
      );
      return;
    }
    this.stopped = false;
    this.queue.scheduleDispatch();
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
      await this.queue.recoverStaleRunningJobs();
      if (this.queue.getDriver() === 'sqs') {
        await this.queue.dispatchDueJobs();
        const messages = await this.queue.receiveMessages();
        await Promise.all(
          messages.map((message) => this.processSqsMessage(message)),
        );
        return;
      }

      const job = await this.queue.claimNextDatabaseJob(this.workerId);
      if (!job) return;
      await this.processJob(job, false);
    } finally {
      this.polling = false;
    }
  }

  private async processSqsMessage(
    message: SmartPicksQueueMessage,
  ): Promise<void> {
    const heartbeat = this.startVisibilityHeartbeat(message.receiptHandle);
    try {
      const job = await this.queue.claimJob(message.jobId, this.workerId);
      if (job) {
        await this.processJob(job, true);
      }
      await this.queue.deleteMessage(message.receiptHandle);
    } catch (error) {
      this.logger.error(
        `Failed to process Smart Picks generation job ${message.jobId}`,
        error,
      );
    } finally {
      if (heartbeat) {
        clearInterval(heartbeat);
      }
    }
  }

  private async processJob(
    job: SmartPickGenerationJob,
    rethrow: boolean,
  ): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: job.user_id } });
    if (!user) {
      await this.completeJob(job);
      return;
    }

    try {
      const outcome = await this.overviewService.generateProductPicksForJob(
        user,
        job.mode,
        job.inputs_hash,
      );
      if (outcome.status === SmartPicksProductGenerationStatus.Ready) {
        await this.completeJob(job, outcome);
        return;
      }
      await this.retryOrFailJob(job, outcome);
    } catch (error) {
      await this.retryOrFailJob(job, {
        status: SmartPicksProductGenerationStatus.Failed,
        reason: null,
        missingPickCount: 0,
        isProcessing: false,
        attemptedAt: new Date().toISOString(),
        retryAfter: null,
      });
      this.logger.warn(
        `Smart Picks generation job ${job.id} failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      if (rethrow) {
        throw error;
      }
    }
  }

  private async completeJob(
    job: SmartPickGenerationJob,
    outcome?: SmartPicksProductGenerationState,
  ): Promise<void> {
    const criteria = ownedRunningJobCriteria(job);
    if (!criteria) {
      this.logger.warn(
        `Smart Picks generation job ${job.id} cannot be completed without an owning worker lock.`,
      );
      return;
    }

    const result = await this.jobRepo.update(criteria, {
      status: SmartPicksGenerationJobStatus.Completed,
      last_error: null,
      locked_at: null,
      locked_by: null,
      ai_model: outcome?.aiUsage?.model ?? null,
      ai_input_tokens: outcome?.aiUsage?.inputTokens ?? null,
      ai_output_tokens: outcome?.aiUsage?.outputTokens ?? null,
      ai_total_tokens: outcome?.aiUsage?.totalTokens ?? null,
      ai_estimated_cost_usd: outcome?.aiUsage?.estimatedCostUsd ?? null,
    });
    if (result.affected) {
      this.queue.scheduleDispatch();
    }
  }

  private async retryOrFailJob(
    job: SmartPickGenerationJob,
    outcome: SmartPicksProductGenerationState,
  ): Promise<void> {
    const currentAttemptCount = Math.max(1, job.attempt_count);
    const terminal =
      currentAttemptCount >= job.max_attempts ||
      outcome.status === SmartPicksProductGenerationStatus.Skipped ||
      outcome.reason === SmartPicksProductGenerationReason.NoPick ||
      outcome.reason === SmartPicksProductGenerationReason.MissingApiKey;
    const status = terminal
      ? SmartPicksGenerationJobStatus.Failed
      : SmartPicksGenerationJobStatus.Queued;
    const criteria = ownedRunningJobCriteria(job);
    if (!criteria) {
      this.logger.warn(
        `Smart Picks generation job ${job.id} cannot be retried without an owning worker lock.`,
      );
      return;
    }

    const result = await this.jobRepo.update(criteria, {
      status,
      attempt_count: currentAttemptCount,
      run_after: terminal
        ? job.run_after
        : new Date(Date.now() + retryDelayMs(currentAttemptCount)),
      last_error: outcome.reason ?? 'smart_pick_generation_failed',
      locked_at: null,
      locked_by: null,
      ai_model: outcome.aiUsage?.model ?? null,
      ai_input_tokens: outcome.aiUsage?.inputTokens ?? null,
      ai_output_tokens: outcome.aiUsage?.outputTokens ?? null,
      ai_total_tokens: outcome.aiUsage?.totalTokens ?? null,
      ai_estimated_cost_usd: outcome.aiUsage?.estimatedCostUsd ?? null,
    });
    if (result.affected) {
      this.queue.scheduleDispatch();
    }
  }

  private startVisibilityHeartbeat(
    receiptHandle: string,
  ): ReturnType<typeof setInterval> | null {
    if (this.queue.getDriver() !== 'sqs') {
      return null;
    }
    const heartbeat = setInterval(() => {
      void this.queue.extendMessageVisibility(receiptHandle).catch((error) => {
        this.logger.warn(
          `Failed to extend Smart Picks message visibility: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      });
    }, this.queue.getVisibilityHeartbeatMs());
    heartbeat.unref?.();
    return heartbeat;
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
            'Smart Picks generation worker poll failed',
            error instanceof Error ? error.stack : String(error),
          );
        })
        .finally(() => {
          if (this.enabled && !this.stopped) {
            this.schedulePoll(SMART_PICKS_GENERATION_POLL_INTERVAL_MS);
          }
        });
    }, delayMs);
  }
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(10 * 60_000, 30_000 * 2 ** Math.max(0, attemptCount - 1));
}

function ownedRunningJobCriteria(job: SmartPickGenerationJob): {
  id: string;
  status: typeof SmartPicksGenerationJobStatus.Running;
  locked_by: string;
} | null {
  if (!job.locked_by) {
    return null;
  }
  return {
    id: job.id,
    status: SmartPicksGenerationJobStatus.Running,
    locked_by: job.locked_by,
  };
}

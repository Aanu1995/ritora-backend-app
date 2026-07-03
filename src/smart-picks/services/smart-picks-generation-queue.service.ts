import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, LessThanOrEqual, Repository } from 'typeorm';
import { mapWithConcurrency } from '../../common/utils/concurrency';
import { SmartPickGenerationJob } from '../entities/smart-pick-generation-job.entity';
import {
  SmartPicksGenerationJobStatus,
  SmartPicksMode,
  SmartPicksQueueDriver,
} from '../smart-picks.types';
import { SmartPicksContext } from './smart-picks-context-builder';

const SMART_PICKS_GENERATION_MAX_ATTEMPTS = 3;
const SMART_PICKS_SQS_WAIT_TIME_SECONDS = 10;
const SMART_PICKS_SQS_VISIBILITY_TIMEOUT_SECONDS = 180;
const SMART_PICKS_SQS_VISIBILITY_HEARTBEAT_MS = 60_000;
const SMART_PICKS_JOB_LOCK_TIMEOUT_MINUTES = 10;
const SMART_PICKS_STALE_JOB_REAPER_BATCH_SIZE = 25;
const SMART_PICKS_JOB_DISPATCH_INTERVAL_MS = 5000;
const SQS_DISPATCH_CONCURRENCY = 8;

const ACTIVE_JOB_STATUSES: readonly SmartPicksGenerationJobStatus[] = [
  SmartPicksGenerationJobStatus.Queued,
  SmartPicksGenerationJobStatus.Sent,
  SmartPicksGenerationJobStatus.Running,
] as const;

const CLAIMABLE_JOB_STATUSES: readonly SmartPicksGenerationJobStatus[] = [
  SmartPicksGenerationJobStatus.Queued,
  SmartPicksGenerationJobStatus.Sent,
] as const;

export type SmartPicksQueueMessage = {
  jobId: string;
  receiptHandle: string;
};

@Injectable()
export class SmartPicksGenerationQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(SmartPicksGenerationQueueService.name);
  private readonly driver: SmartPicksQueueDriver;
  private readonly queueUrl: string;
  private readonly sqsClient: SQSClient | null;
  private dispatchTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    @InjectRepository(SmartPickGenerationJob)
    private readonly jobRepo: Repository<SmartPickGenerationJob>,
    private readonly config: ConfigService,
  ) {
    this.driver = this.readQueueDriver();
    this.queueUrl = this.config.get<string>('SMART_PICKS_SQS_QUEUE_URL') ?? '';
    this.sqsClient =
      this.driver === 'sqs'
        ? new SQSClient({
            region: this.config.getOrThrow<string>('AWS_REGION'),
          })
        : null;
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.dispatchTimer) {
      clearTimeout(this.dispatchTimer);
      this.dispatchTimer = null;
    }
    this.sqsClient?.destroy?.();
  }

  getDriver(): SmartPicksQueueDriver {
    return this.driver;
  }

  getVisibilityHeartbeatMs(): number {
    return SMART_PICKS_SQS_VISIBILITY_HEARTBEAT_MS;
  }

  async enqueueForContext(
    context: SmartPicksContext,
    missingPickCount: number,
    runAfter = new Date(),
  ): Promise<SmartPickGenerationJob | null> {
    if (missingPickCount === 0) return null;

    const activeJob = await this.findActiveJob(
      context.user.id,
      context.mode,
      context.inputsHash,
    );
    if (activeJob) {
      this.scheduleDispatchForJob(activeJob);
      return activeJob;
    }

    const job = this.jobRepo.create({
      user_id: context.user.id,
      mode: context.mode,
      inputs_hash: context.inputsHash,
      status: SmartPicksGenerationJobStatus.Queued,
      attempt_count: 0,
      max_attempts: SMART_PICKS_GENERATION_MAX_ATTEMPTS,
      run_after: runAfter,
      locked_at: null,
      locked_by: null,
      last_error: null,
    });

    let saved: SmartPickGenerationJob;
    try {
      saved = await this.jobRepo.save(job);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const duplicateJob = await this.findActiveJob(
        context.user.id,
        context.mode,
        context.inputsHash,
      );
      if (duplicateJob) {
        this.scheduleDispatchForJob(duplicateJob);
      }
      return duplicateJob;
    }

    this.scheduleDispatchForJob(saved);
    return saved;
  }

  async latestForContext(
    context: SmartPicksContext,
  ): Promise<SmartPickGenerationJob | null> {
    return this.jobRepo.findOne({
      where: {
        user_id: context.user.id,
        mode: context.mode,
        inputs_hash: context.inputsHash,
      },
      order: { updated_at: 'DESC', created_at: 'DESC' },
    });
  }

  async dispatchDueJobs(limit = 25): Promise<number> {
    if (this.driver !== 'sqs') return 0;
    const now = new Date();
    const dueJobs = await this.jobRepo.find({
      where: {
        status: SmartPicksGenerationJobStatus.Queued,
        run_after: LessThanOrEqual(now),
      },
      order: { run_after: 'ASC' },
      take: limit,
    });
    let sent = 0;
    const results = await mapWithConcurrency(
      dueJobs,
      SQS_DISPATCH_CONCURRENCY,
      async (job) => {
        const claimed = await this.jobRepo.update(
          {
            id: job.id,
            status: SmartPicksGenerationJobStatus.Queued,
            run_after: LessThanOrEqual(now),
          },
          {
            status: SmartPicksGenerationJobStatus.Sent,
            last_error: null,
            updated_at: now,
          },
        );
        if (!claimed.affected) return;
        try {
          await this.sendSqsJob(job.id);
          sent += 1;
        } catch (error) {
          await this.jobRepo.update(
            { id: job.id, status: SmartPicksGenerationJobStatus.Sent },
            {
              status: SmartPicksGenerationJobStatus.Queued,
              last_error: errorMessage(error),
              updated_at: new Date(),
            },
          );
          this.logger.error(
            `Failed to send Smart Picks generation job ${job.id} to SQS`,
            error,
          );
        }
      },
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.error(
          'Failed to dispatch Smart Picks generation job',
          result.reason,
        );
      }
    }
    return sent;
  }

  async receiveMessages(): Promise<SmartPicksQueueMessage[]> {
    if (this.driver !== 'sqs' || !this.sqsClient || !this.queueUrl) {
      return [];
    }
    const response = await this.sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: 5,
        WaitTimeSeconds: SMART_PICKS_SQS_WAIT_TIME_SECONDS,
        VisibilityTimeout: SMART_PICKS_SQS_VISIBILITY_TIMEOUT_SECONDS,
      }),
    );
    const messages: SmartPicksQueueMessage[] = [];
    for (const rawMessage of response.Messages ?? []) {
      const parsed = this.toQueueMessage(rawMessage);
      if (parsed) {
        messages.push(parsed);
        continue;
      }
      if (rawMessage.ReceiptHandle) {
        await this.deleteMalformedMessage(rawMessage.ReceiptHandle);
      }
    }
    return messages;
  }

  async deleteMessage(receiptHandle: string): Promise<void> {
    if (this.driver !== 'sqs' || !this.sqsClient || !this.queueUrl) {
      return;
    }
    await this.sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  async extendMessageVisibility(receiptHandle: string): Promise<void> {
    if (this.driver !== 'sqs' || !this.sqsClient || !this.queueUrl) {
      return;
    }
    await this.sqsClient.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: SMART_PICKS_SQS_VISIBILITY_TIMEOUT_SECONDS,
      }),
    );
  }

  async claimJob(
    jobId: string,
    workerId: string,
  ): Promise<SmartPickGenerationJob | null> {
    return this.jobRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(SmartPickGenerationJob);
      const job = await repo
        .createQueryBuilder('job')
        .setLock('pessimistic_write')
        .where('job.id = :jobId', { jobId })
        .getOne();
      if (!job || !CLAIMABLE_JOB_STATUSES.includes(job.status)) {
        return null;
      }
      if (job.run_after.getTime() > Date.now()) {
        job.status = SmartPicksGenerationJobStatus.Queued;
        job.locked_at = null;
        job.locked_by = null;
        await repo.save(job);
        this.scheduleDispatch();
        return null;
      }
      job.status = SmartPicksGenerationJobStatus.Running;
      job.locked_at = new Date();
      job.locked_by = workerId;
      job.attempt_count += 1;
      return repo.save(job);
    });
  }

  async claimNextDatabaseJob(
    workerId: string,
  ): Promise<SmartPickGenerationJob | null> {
    if (this.driver !== 'database') {
      return null;
    }
    return this.jobRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(SmartPickGenerationJob);
      const job = await repo
        .createQueryBuilder('job')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('job.status = :status', {
          status: SmartPicksGenerationJobStatus.Queued,
        })
        .andWhere('job.run_after <= :now', { now: new Date() })
        .orderBy('job.run_after', 'ASC')
        .getOne();
      if (!job) return null;
      job.status = SmartPicksGenerationJobStatus.Running;
      job.locked_at = new Date();
      job.locked_by = workerId;
      job.attempt_count += 1;
      return repo.save(job);
    });
  }

  async recoverStaleRunningJobs(now = new Date()): Promise<void> {
    const cutoff = new Date(
      now.getTime() - SMART_PICKS_JOB_LOCK_TIMEOUT_MINUTES * 60_000,
    );
    const staleJobs = await this.jobRepo.find({
      where: {
        status: SmartPicksGenerationJobStatus.Running,
        locked_at: LessThan(cutoff),
      },
      order: { locked_at: 'ASC' },
      take: SMART_PICKS_STALE_JOB_REAPER_BATCH_SIZE,
    });
    for (const staleJob of staleJobs) {
      const currentAttemptCount = Math.max(1, staleJob.attempt_count);
      const terminal = currentAttemptCount >= staleJob.max_attempts;
      const recoveryCriteria = staleJob.locked_by
        ? {
            id: staleJob.id,
            status: SmartPicksGenerationJobStatus.Running,
            locked_by: staleJob.locked_by,
          }
        : {
            id: staleJob.id,
            status: SmartPicksGenerationJobStatus.Running,
            locked_by: IsNull(),
          };
      await this.jobRepo.update(recoveryCriteria, {
        status: terminal
          ? SmartPicksGenerationJobStatus.Failed
          : SmartPicksGenerationJobStatus.Queued,
        attempt_count: currentAttemptCount,
        run_after: now,
        last_error: `stale lock recovered after ${SMART_PICKS_JOB_LOCK_TIMEOUT_MINUTES} minutes`,
        locked_at: null,
        locked_by: null,
      });
    }
    const staleSentJobs = await this.jobRepo.find({
      where: {
        status: SmartPicksGenerationJobStatus.Sent,
        updated_at: LessThan(cutoff),
      },
      order: { updated_at: 'ASC' },
      take: SMART_PICKS_STALE_JOB_REAPER_BATCH_SIZE,
    });
    for (const staleJob of staleSentJobs) {
      await this.jobRepo.update(
        { id: staleJob.id, status: SmartPicksGenerationJobStatus.Sent },
        {
          status: SmartPicksGenerationJobStatus.Queued,
          run_after: now,
          last_error: `stale SQS dispatch recovered after ${SMART_PICKS_JOB_LOCK_TIMEOUT_MINUTES} minutes`,
          locked_at: null,
          locked_by: null,
        },
      );
    }
    this.scheduleDispatch();
  }

  scheduleDispatch(): void {
    if (this.stopped || this.driver !== 'sqs') return;
    if (this.dispatchTimer) {
      clearTimeout(this.dispatchTimer);
      this.dispatchTimer = null;
    }
    this.dispatchTimer = setTimeout(() => {
      this.dispatchTimer = null;
      void this.dispatchDueJobs().catch((error) => {
        this.logger.error(
          'Failed to dispatch Smart Picks generation jobs',
          error,
        );
        this.scheduleDispatch();
      });
    }, SMART_PICKS_JOB_DISPATCH_INTERVAL_MS);
    this.dispatchTimer.unref?.();
  }

  private scheduleDispatchForJob(job: SmartPickGenerationJob): void {
    if (job.status !== SmartPicksGenerationJobStatus.Queued) return;
    if (job.run_after.getTime() > Date.now()) return;
    this.scheduleDispatch();
  }

  private findActiveJob(
    userId: string,
    mode: SmartPicksMode,
    inputsHash: string,
  ): Promise<SmartPickGenerationJob | null> {
    return this.jobRepo.findOne({
      where: {
        user_id: userId,
        mode,
        inputs_hash: inputsHash,
        status: In([...ACTIVE_JOB_STATUSES]),
      },
    });
  }

  private async sendSqsJob(jobId: string): Promise<void> {
    if (!this.sqsClient || !this.queueUrl) {
      throw new Error('Smart Picks SQS queue is not configured');
    }
    await this.sqsClient.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify({ job_id: jobId }),
      }),
    );
  }

  private toQueueMessage(message: Message): SmartPicksQueueMessage | null {
    if (!message.Body || !message.ReceiptHandle) {
      return null;
    }
    try {
      const payload = JSON.parse(message.Body) as { job_id?: unknown };
      if (typeof payload.job_id !== 'string' || payload.job_id.length === 0) {
        return null;
      }
      return {
        jobId: payload.job_id,
        receiptHandle: message.ReceiptHandle,
      };
    } catch {
      return null;
    }
  }

  private async deleteMalformedMessage(receiptHandle: string): Promise<void> {
    try {
      await this.deleteMessage(receiptHandle);
    } catch (error) {
      this.logger.warn(
        `Failed to delete malformed Smart Picks SQS message: ${errorMessage(
          error,
        )}`,
      );
    }
  }

  private readQueueDriver(): SmartPicksQueueDriver {
    const configured =
      this.config.get<SmartPicksQueueDriver>('SMART_PICKS_QUEUE_DRIVER') ??
      'database';
    return configured === 'sqs' ? 'sqs' : 'database';
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybeError = error as { code?: unknown };
  return maybeError.code === '23505';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown queue error';
}

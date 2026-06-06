import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, LessThanOrEqual, Repository } from 'typeorm';
import { DEFAULT_LANGUAGE, type AppLanguage } from '../common/i18n/i18n';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import {
  IngredientProductAnalysisJob,
  IngredientProductAnalysisJobStatus,
} from './entities/ingredient-product-analysis-job.entity';
import {
  INGREDIENT_PRODUCT_ANALYSIS_LOCK_TIMEOUT_MINUTES,
  INGREDIENT_PRODUCT_ANALYSIS_SQS_VISIBILITY_HEARTBEAT_MS,
  INGREDIENT_PRODUCT_ANALYSIS_SQS_VISIBILITY_TIMEOUT_SECONDS,
} from './ingredient-analysis-runtime.constants';
import { buildProductIngredientAnalysisHash } from './ingredient-product-analysis-snapshot.service';

const INGREDIENT_PRODUCT_ANALYSIS_MAX_ATTEMPTS = 3;
const INGREDIENT_PRODUCT_ANALYSIS_SQS_WAIT_TIME_SECONDS = 10;
const INGREDIENT_PRODUCT_ANALYSIS_STALE_JOB_BATCH_SIZE = 25;
const ACTIVE_JOB_STATUSES: readonly IngredientProductAnalysisJobStatus[] = [
  IngredientProductAnalysisJobStatus.Queued,
  IngredientProductAnalysisJobStatus.Sent,
  IngredientProductAnalysisJobStatus.Running,
] as const;
const CLAIMABLE_JOB_STATUSES: readonly IngredientProductAnalysisJobStatus[] = [
  IngredientProductAnalysisJobStatus.Queued,
  IngredientProductAnalysisJobStatus.Sent,
] as const;

export type IngredientProductAnalysisQueueDriver = 'sqs' | 'database';

export type IngredientProductAnalysisQueueMessage = {
  jobId: string;
  receiptHandle: string;
};

@Injectable()
export class IngredientProductAnalysisQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(
    IngredientProductAnalysisQueueService.name,
  );
  private readonly driver: IngredientProductAnalysisQueueDriver;
  private readonly queueUrl: string;
  private readonly sqsClient: SQSClient | null;

  constructor(
    @InjectRepository(IngredientProductAnalysisJob)
    private readonly jobRepo: Repository<IngredientProductAnalysisJob>,
    @InjectRepository(InventoryProduct)
    private readonly inventoryRepo: Repository<InventoryProduct>,
    private readonly config: ConfigService,
  ) {
    this.driver = this.readQueueDriver();
    this.queueUrl =
      this.config.get<string>('INGREDIENT_ANALYSIS_SQS_QUEUE_URL') ?? '';
    this.sqsClient =
      this.driver === 'sqs'
        ? new SQSClient({
            region: this.config.getOrThrow<string>('AWS_REGION'),
          })
        : null;
  }

  onModuleDestroy(): void {
    this.sqsClient?.destroy?.();
  }

  getDriver(): IngredientProductAnalysisQueueDriver {
    return this.driver;
  }

  getVisibilityHeartbeatMs(): number {
    return INGREDIENT_PRODUCT_ANALYSIS_SQS_VISIBILITY_HEARTBEAT_MS;
  }

  async enqueueForProduct(
    userId: string,
    productId: string,
    language: AppLanguage = DEFAULT_LANGUAGE,
    withExplanations = false,
    runAfter = new Date(),
  ): Promise<IngredientProductAnalysisJob | null> {
    const product = await this.inventoryRepo.findOne({
      where: { id: productId, user_id: userId },
    });
    if (!product) {
      return null;
    }

    const jobInput = {
      user_id: userId,
      product_id: productId,
      language,
      with_explanations: withExplanations,
      inci_hash: buildProductIngredientAnalysisHash(product),
      product_updated_at: productVersionDate(product),
    };

    const activeJob = await this.findActiveJob(jobInput);
    if (activeJob) {
      return activeJob;
    }

    const job = this.jobRepo.create({
      ...jobInput,
      status: IngredientProductAnalysisJobStatus.Queued,
      attempt_count: 0,
      max_attempts: INGREDIENT_PRODUCT_ANALYSIS_MAX_ATTEMPTS,
      run_after: runAfter,
      locked_at: null,
      locked_by: null,
      last_error: null,
      completed_at: null,
    });

    try {
      return await this.jobRepo.save(job);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      return this.findActiveJob(jobInput);
    }
  }

  async claimNextJob(
    workerId: string,
  ): Promise<IngredientProductAnalysisJob | null> {
    if (this.driver !== 'database') {
      return null;
    }
    return this.jobRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(IngredientProductAnalysisJob);
      const job = await repo
        .createQueryBuilder('job')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('job.status = :status', {
          status: IngredientProductAnalysisJobStatus.Queued,
        })
        .andWhere('job.run_after <= :now', { now: new Date() })
        .orderBy('job.run_after', 'ASC')
        .getOne();
      if (!job) {
        return null;
      }

      job.status = IngredientProductAnalysisJobStatus.Running;
      job.locked_at = new Date();
      job.locked_by = workerId;
      job.attempt_count += 1;
      return repo.save(job);
    });
  }

  async dispatchDueJobs(limit = 25): Promise<number> {
    if (this.driver !== 'sqs') {
      return 0;
    }
    const now = new Date();
    const dueJobs = await this.jobRepo.find({
      where: {
        status: IngredientProductAnalysisJobStatus.Queued,
        run_after: LessThanOrEqual(now),
      },
      order: { run_after: 'ASC' },
      take: limit,
    });
    let sent = 0;
    for (const job of dueJobs) {
      const claimed = await this.jobRepo.update(
        {
          id: job.id,
          status: IngredientProductAnalysisJobStatus.Queued,
          run_after: LessThanOrEqual(now),
        },
        {
          status: IngredientProductAnalysisJobStatus.Sent,
          last_error: null,
          updated_at: now,
        },
      );
      if (!claimed.affected) {
        continue;
      }

      try {
        await this.sendSqsJob(job.id);
        sent += 1;
      } catch (error) {
        await this.jobRepo.update(
          { id: job.id, status: IngredientProductAnalysisJobStatus.Sent },
          {
            status: IngredientProductAnalysisJobStatus.Queued,
            last_error: errorMessage(error),
            updated_at: new Date(),
          },
        );
        this.logger.error(
          `Failed to send ingredient product analysis job ${job.id} to SQS`,
          error,
        );
      }
    }
    return sent;
  }

  async receiveMessages(): Promise<IngredientProductAnalysisQueueMessage[]> {
    if (this.driver !== 'sqs' || !this.sqsClient || !this.queueUrl) {
      return [];
    }
    const response = await this.sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: 5,
        WaitTimeSeconds: INGREDIENT_PRODUCT_ANALYSIS_SQS_WAIT_TIME_SECONDS,
        VisibilityTimeout:
          INGREDIENT_PRODUCT_ANALYSIS_SQS_VISIBILITY_TIMEOUT_SECONDS,
      }),
    );
    const messages: IngredientProductAnalysisQueueMessage[] = [];
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
        VisibilityTimeout:
          INGREDIENT_PRODUCT_ANALYSIS_SQS_VISIBILITY_TIMEOUT_SECONDS,
      }),
    );
  }

  async claimJob(
    jobId: string,
    workerId: string,
  ): Promise<IngredientProductAnalysisJob | null> {
    return this.jobRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(IngredientProductAnalysisJob);
      const job = await repo
        .createQueryBuilder('job')
        .setLock('pessimistic_write')
        .where('job.id = :jobId', { jobId })
        .getOne();
      if (!job || !CLAIMABLE_JOB_STATUSES.includes(job.status)) {
        return null;
      }
      if (job.run_after.getTime() > Date.now()) {
        job.status = IngredientProductAnalysisJobStatus.Queued;
        job.locked_at = null;
        job.locked_by = null;
        await repo.save(job);
        return null;
      }
      job.status = IngredientProductAnalysisJobStatus.Running;
      job.locked_at = new Date();
      job.locked_by = workerId;
      job.attempt_count += 1;
      return repo.save(job);
    });
  }

  async recoverStaleRunningJobs(now = new Date()): Promise<void> {
    const cutoff = new Date(
      now.getTime() - INGREDIENT_PRODUCT_ANALYSIS_LOCK_TIMEOUT_MINUTES * 60_000,
    );
    const staleJobs = await this.jobRepo.find({
      where: {
        status: IngredientProductAnalysisJobStatus.Running,
        locked_at: LessThan(cutoff),
      },
      order: { locked_at: 'ASC' },
      take: INGREDIENT_PRODUCT_ANALYSIS_STALE_JOB_BATCH_SIZE,
    });

    for (const staleJob of staleJobs) {
      const currentAttemptCount = Math.max(1, staleJob.attempt_count);
      const terminal = currentAttemptCount >= staleJob.max_attempts;
      await this.jobRepo.update(lockedJobCriteria(staleJob), {
        status: terminal
          ? IngredientProductAnalysisJobStatus.Failed
          : IngredientProductAnalysisJobStatus.Queued,
        attempt_count: currentAttemptCount,
        run_after: now,
        last_error: `stale lock recovered after ${INGREDIENT_PRODUCT_ANALYSIS_LOCK_TIMEOUT_MINUTES} minutes`,
        locked_at: null,
        locked_by: null,
        updated_at: now,
      });
    }

    const staleSentJobs = await this.jobRepo.find({
      where: {
        status: IngredientProductAnalysisJobStatus.Sent,
        updated_at: LessThan(cutoff),
      },
      order: { updated_at: 'ASC' },
      take: INGREDIENT_PRODUCT_ANALYSIS_STALE_JOB_BATCH_SIZE,
    });
    for (const staleJob of staleSentJobs) {
      await this.jobRepo.update(
        { id: staleJob.id, status: IngredientProductAnalysisJobStatus.Sent },
        {
          status: IngredientProductAnalysisJobStatus.Queued,
          run_after: now,
          last_error: `stale SQS dispatch recovered after ${INGREDIENT_PRODUCT_ANALYSIS_LOCK_TIMEOUT_MINUTES} minutes`,
          locked_at: null,
          locked_by: null,
          updated_at: now,
        },
      );
    }
  }

  async completeJob(job: IngredientProductAnalysisJob): Promise<void> {
    await this.jobRepo.update(ownedRunningJobCriteria(job), {
      status: IngredientProductAnalysisJobStatus.Completed,
      last_error: null,
      locked_at: null,
      locked_by: null,
      completed_at: new Date(),
      updated_at: new Date(),
    });
  }

  async retryOrFailJob(
    job: IngredientProductAnalysisJob,
    errorMessage: string,
  ): Promise<void> {
    const currentAttemptCount = Math.max(1, job.attempt_count);
    const terminal = currentAttemptCount >= job.max_attempts;
    await this.jobRepo.update(ownedRunningJobCriteria(job), {
      status: terminal
        ? IngredientProductAnalysisJobStatus.Failed
        : IngredientProductAnalysisJobStatus.Queued,
      attempt_count: currentAttemptCount,
      run_after: terminal
        ? job.run_after
        : new Date(Date.now() + retryDelayMs(currentAttemptCount)),
      last_error: errorMessage.slice(0, 500),
      locked_at: null,
      locked_by: null,
      updated_at: new Date(),
    });
  }

  private findActiveJob(input: {
    user_id: string;
    product_id: string;
    language: AppLanguage;
    with_explanations: boolean;
    inci_hash: string;
    product_updated_at: Date;
  }): Promise<IngredientProductAnalysisJob | null> {
    return this.jobRepo.findOne({
      where: {
        ...input,
        status: In([...ACTIVE_JOB_STATUSES]),
      },
    });
  }

  private async sendSqsJob(jobId: string): Promise<void> {
    if (!this.sqsClient || !this.queueUrl) {
      throw new Error('Ingredient analysis SQS queue is not configured');
    }
    await this.sqsClient.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify({ job_id: jobId }),
      }),
    );
  }

  private toQueueMessage(
    message: Message,
  ): IngredientProductAnalysisQueueMessage | null {
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
    } catch {
      return;
    }
  }

  private readQueueDriver(): IngredientProductAnalysisQueueDriver {
    const configured =
      this.config.get<IngredientProductAnalysisQueueDriver>(
        'INGREDIENT_ANALYSIS_QUEUE_DRIVER',
      ) ?? 'database';
    return configured === 'sqs' ? 'sqs' : 'database';
  }
}

function ownedRunningJobCriteria(job: IngredientProductAnalysisJob): {
  id: string;
  status: typeof IngredientProductAnalysisJobStatus.Running;
  locked_by: string;
} {
  return {
    id: job.id,
    status: IngredientProductAnalysisJobStatus.Running,
    locked_by: job.locked_by ?? '',
  };
}

function lockedJobCriteria(job: IngredientProductAnalysisJob):
  | {
      id: string;
      status: typeof IngredientProductAnalysisJobStatus.Running;
      locked_by: string;
    }
  | {
      id: string;
      status: typeof IngredientProductAnalysisJobStatus.Running;
      locked_by: ReturnType<typeof IsNull>;
    } {
  if (job.locked_by) {
    return {
      id: job.id,
      status: IngredientProductAnalysisJobStatus.Running,
      locked_by: job.locked_by,
    };
  }

  return {
    id: job.id,
    status: IngredientProductAnalysisJobStatus.Running,
    locked_by: IsNull(),
  };
}

function productVersionDate(product: InventoryProduct): Date {
  return product.updated_at ?? product.created_at ?? new Date(0);
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(10 * 60_000, 30_000 * 2 ** Math.max(0, attemptCount - 1));
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybeError = error as { code?: unknown };
  return maybeError.code === '23505';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown queue error';
}

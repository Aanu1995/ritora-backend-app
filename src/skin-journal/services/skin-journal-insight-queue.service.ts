import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, Repository } from 'typeorm';
import { SkinJournalInsightJob } from '../entities/skin-journal-insight-job.entity';
import {
  SKIN_JOURNAL_INSIGHT_JOB_BACKOFF_BASE_SECONDS,
  SKIN_JOURNAL_INSIGHT_JOB_BACKOFF_MAX_SECONDS,
  SKIN_JOURNAL_INSIGHT_JOB_DISPATCH_INTERVAL_MS,
  SKIN_JOURNAL_INSIGHT_JOB_LOCK_TTL_SECONDS,
  SKIN_JOURNAL_INSIGHT_JOB_MAX_ATTEMPTS,
  SKIN_JOURNAL_INSIGHT_SQS_VISIBILITY_TIMEOUT_SECONDS,
  SKIN_JOURNAL_INSIGHT_SQS_WAIT_TIME_SECONDS,
  InsightJobStatusValue,
  type InsightGenerationTrigger,
  type InsightJobStatus,
  type InsightQueueDriver,
} from '../skin-journal.constants';

const ACTIVE_JOB_STATUSES: InsightJobStatus[] = [
  InsightJobStatusValue.Queued,
  InsightJobStatusValue.Sent,
  InsightJobStatusValue.Running,
];
const COALESCIBLE_JOB_STATUSES: InsightJobStatus[] = [
  InsightJobStatusValue.Queued,
  InsightJobStatusValue.Sent,
];
const CLAIMABLE_JOB_STATUSES: InsightJobStatus[] = [
  InsightJobStatusValue.Queued,
  InsightJobStatusValue.Sent,
];
const INSIGHT_JOB_TABLE_NAME = 'skin_journal_insight_jobs';

export type InsightQueueMessage = {
  jobId: string;
  receiptHandle: string;
};

export type InsightQueueMetrics = {
  driver: InsightQueueDriver;
  queued_count: number;
  sent_count: number;
  running_count: number;
  failed_count: number;
  completed_count: number;
  cancelled_count: number;
  oldest_queued_age_seconds: number | null;
  retrying_count: number;
  sqs_visible_count: number | null;
  sqs_not_visible_count: number | null;
  sqs_redrive_policy_configured: boolean | null;
  dlq_visible_count: number | null;
};

@Injectable()
export class SkinJournalInsightQueueService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SkinJournalInsightQueueService.name);
  private readonly driver: InsightQueueDriver;
  private readonly queueUrl: string;
  private readonly dlqUrl: string;
  private readonly sqsClient: SQSClient | null;
  private readonly waitTimeSeconds = SKIN_JOURNAL_INSIGHT_SQS_WAIT_TIME_SECONDS;
  private readonly visibilityTimeoutSeconds =
    SKIN_JOURNAL_INSIGHT_SQS_VISIBILITY_TIMEOUT_SECONDS;
  private readonly lockTtlSeconds = SKIN_JOURNAL_INSIGHT_JOB_LOCK_TTL_SECONDS;
  private readonly maxAttempts = SKIN_JOURNAL_INSIGHT_JOB_MAX_ATTEMPTS;
  private readonly backoffBaseSeconds =
    SKIN_JOURNAL_INSIGHT_JOB_BACKOFF_BASE_SECONDS;
  private readonly backoffMaxSeconds =
    SKIN_JOURNAL_INSIGHT_JOB_BACKOFF_MAX_SECONDS;
  private dispatchTimer: ReturnType<typeof setTimeout> | null = null;
  private insightJobTableReady: boolean | null = null;
  private stopped = false;

  constructor(
    @InjectRepository(SkinJournalInsightJob)
    private readonly jobs: Repository<SkinJournalInsightJob>,
    private readonly config: ConfigService,
  ) {
    this.driver = this.readQueueDriver();
    this.queueUrl = this.config.getOrThrow<string>(
      'SKIN_JOURNAL_INSIGHT_SQS_QUEUE_URL',
    );
    this.dlqUrl = this.config.getOrThrow<string>(
      'SKIN_JOURNAL_INSIGHT_SQS_DLQ_URL',
    );
    this.sqsClient =
      this.driver === 'sqs'
        ? new SQSClient({
            region: this.config.getOrThrow<string>('AWS_REGION'),
          })
        : null;
  }

  async onModuleInit(): Promise<void> {
    this.stopped = false;
    if (!(await this.ensureInsightJobTableReady())) {
      return;
    }
    await this.recoverExpiredLocks();
    await this.assertSqsConfiguration();
    this.scheduleDispatch();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.dispatchTimer) {
      clearTimeout(this.dispatchTimer);
      this.dispatchTimer = null;
    }
    this.sqsClient?.destroy?.();
  }

  getDriver(): InsightQueueDriver {
    return this.driver;
  }

  getMaxAttempts(): number {
    return this.maxAttempts;
  }

  async isReady(): Promise<boolean> {
    return this.ensureInsightJobTableReady();
  }

  nextRetryAt(attemptCount: number, now = new Date()): Date {
    const backoffSeconds = Math.min(
      this.backoffMaxSeconds,
      this.backoffBaseSeconds * 2 ** Math.max(0, attemptCount - 1),
    );
    return new Date(now.getTime() + backoffSeconds * 1000);
  }

  async enqueueInsightJob(params: {
    userId: string;
    trigger: InsightGenerationTrigger;
    locale: string;
    inputSignature: string;
    reason?: string | null;
    runAfter?: Date;
  }): Promise<SkinJournalInsightJob> {
    await this.assertInsightJobTableReady();
    const runAfter = params.runAfter ?? new Date();
    const existing = await this.jobs.findOne({
      where: {
        user_id: params.userId,
        status: In(COALESCIBLE_JOB_STATUSES),
      },
    });
    if (!existing) {
      const runningJob = await this.jobs.findOne({
        where: {
          user_id: params.userId,
          status: InsightJobStatusValue.Running,
        },
      });
      if (runningJob) {
        return runningJob;
      }
    }
    const job =
      existing ??
      this.jobs.create({
        user_id: params.userId,
        attempt_count: 0,
        max_attempts: this.maxAttempts,
      });

    job.user_id = params.userId;
    job.trigger = params.trigger;
    job.locale = params.locale;
    job.input_signature = params.inputSignature;
    job.run_after = runAfter;
    job.max_attempts = job.max_attempts || this.maxAttempts;
    job.completed_at = null;
    job.last_error = params.reason ?? job.last_error ?? null;
    if (job.status !== InsightJobStatusValue.Running) {
      job.status = InsightJobStatusValue.Queued;
      job.locked_at = null;
      job.locked_by = null;
    }

    const saved = await this.jobs.save(job);
    this.scheduleDispatch();
    if (this.driver === 'sqs' && runAfter.getTime() <= Date.now()) {
      await this.dispatchDueJobs(10);
    }
    return saved;
  }

  async dispatchDueJobs(limit = 25): Promise<number> {
    if (this.driver !== 'sqs') {
      return 0;
    }
    if (!(await this.ensureInsightJobTableReady())) {
      return 0;
    }
    const dueJobs = await this.jobs.find({
      where: {
        status: InsightJobStatusValue.Queued,
        run_after: LessThanOrEqual(new Date()),
      },
      order: { run_after: 'ASC' },
      take: limit,
    });
    let sent = 0;
    for (const job of dueJobs) {
      try {
        await this.sendSqsJob(job.id);
        job.status = InsightJobStatusValue.Sent;
        job.last_error = null;
        await this.jobs.save(job);
        sent += 1;
      } catch (error) {
        job.status = InsightJobStatusValue.Queued;
        job.last_error = this.errorMessage(error);
        await this.jobs.save(job);
        this.logger.error(
          `Failed to send skin journal insight job ${job.id} to SQS`,
          error,
        );
      }
    }
    this.scheduleDispatch();
    return sent;
  }

  async receiveMessages(): Promise<InsightQueueMessage[]> {
    if (this.driver !== 'sqs' || !this.sqsClient || !this.queueUrl) {
      return [];
    }
    const response = await this.sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: 5,
        WaitTimeSeconds: this.waitTimeSeconds,
        VisibilityTimeout: this.visibilityTimeoutSeconds,
      }),
    );
    const messages: InsightQueueMessage[] = [];
    for (const rawMessage of response.Messages ?? []) {
      const parsed = this.toQueueMessage(rawMessage);
      if (parsed) {
        messages.push(parsed);
        continue;
      }
      if (rawMessage.ReceiptHandle) {
        await this.deleteMessage(rawMessage.ReceiptHandle);
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
        VisibilityTimeout: this.visibilityTimeoutSeconds,
      }),
    );
  }

  async claimJob(
    jobId: string,
    workerId: string,
  ): Promise<SkinJournalInsightJob | null> {
    await this.assertInsightJobTableReady();
    return this.jobs.manager.transaction(async (manager) => {
      const repo = manager.getRepository(SkinJournalInsightJob);
      await this.lockGenerationGate(manager);
      const job = await repo
        .createQueryBuilder('job')
        .setLock('pessimistic_write')
        .where('job.id = :jobId', { jobId })
        .getOne();
      if (!job || !CLAIMABLE_JOB_STATUSES.includes(job.status)) {
        return null;
      }
      if (job.run_after.getTime() > Date.now()) {
        job.status = InsightJobStatusValue.Queued;
        job.locked_at = null;
        job.locked_by = null;
        await repo.save(job);
        this.scheduleDispatch();
        return null;
      }
      job.status = InsightJobStatusValue.Running;
      job.locked_at = new Date();
      job.locked_by = workerId;
      job.attempt_count += 1;
      return repo.save(job);
    });
  }

  async claimNextDatabaseJob(
    workerId: string,
  ): Promise<SkinJournalInsightJob | null> {
    if (this.driver !== 'database') {
      return null;
    }
    if (!(await this.ensureInsightJobTableReady())) {
      return null;
    }
    return this.jobs.manager.transaction(async (manager) => {
      const repo = manager.getRepository(SkinJournalInsightJob);
      await this.lockGenerationGate(manager);
      const job = await repo
        .createQueryBuilder('job')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('job.status IN (:...statuses)', {
          statuses: CLAIMABLE_JOB_STATUSES,
        })
        .andWhere('job.run_after <= :now', { now: new Date() })
        .orderBy('job.run_after', 'ASC')
        .getOne();
      if (!job) {
        return null;
      }
      job.status = InsightJobStatusValue.Running;
      job.locked_at = new Date();
      job.locked_by = workerId;
      job.attempt_count += 1;
      return repo.save(job);
    });
  }

  async getJob(jobId: string): Promise<SkinJournalInsightJob | null> {
    await this.assertInsightJobTableReady();
    return this.jobs.findOne({ where: { id: jobId } });
  }

  async completeJob(job: SkinJournalInsightJob): Promise<void> {
    job.status = InsightJobStatusValue.Completed;
    job.locked_at = null;
    job.locked_by = null;
    job.last_error = null;
    job.completed_at = new Date();
    await this.jobs.save(job);
  }

  async failJob(job: SkinJournalInsightJob, error: string): Promise<void> {
    job.status = InsightJobStatusValue.Failed;
    job.locked_at = null;
    job.locked_by = null;
    job.last_error = error;
    job.completed_at = new Date();
    await this.jobs.save(job);
  }

  async cancelJob(job: SkinJournalInsightJob, reason: string): Promise<void> {
    job.status = InsightJobStatusValue.Cancelled;
    job.locked_at = null;
    job.locked_by = null;
    job.last_error = reason;
    job.completed_at = new Date();
    await this.jobs.save(job);
  }

  async rescheduleJob(
    job: SkinJournalInsightJob,
    params: {
      reason: string;
      runAfter: Date;
      inputSignature?: string;
      trigger?: InsightGenerationTrigger;
    },
  ): Promise<void> {
    job.status = InsightJobStatusValue.Queued;
    job.run_after = params.runAfter;
    job.locked_at = null;
    job.locked_by = null;
    job.last_error = params.reason;
    job.completed_at = null;
    if (params.inputSignature) {
      job.input_signature = params.inputSignature;
    }
    if (params.trigger) {
      job.trigger = params.trigger;
    }
    await this.jobs.save(job);
    this.scheduleDispatch();
  }

  async recoverExpiredLocks(): Promise<number> {
    if (!(await this.ensureInsightJobTableReady())) {
      return 0;
    }
    const cutoff = new Date(Date.now() - this.lockTtlSeconds * 1000);
    const candidates = await this.jobs.find({
      where: {
        status: In([InsightJobStatusValue.Sent, InsightJobStatusValue.Running]),
      },
      take: 100,
    });
    const expiredJobIds = candidates.flatMap((job) => {
      const referenceDate =
        job.status === InsightJobStatusValue.Running
          ? job.locked_at
          : job.updated_at;
      if (referenceDate && referenceDate.getTime() > cutoff.getTime()) {
        return [];
      }
      return [job.id];
    });
    if (expiredJobIds.length > 0) {
      await this.jobs.update(
        { id: In(expiredJobIds) },
        {
          status: InsightJobStatusValue.Queued,
          locked_at: null,
          locked_by: null,
          last_error:
            'Insight job recovered after worker interruption or message loss.',
          run_after: new Date(),
        },
      );
    }
    if (expiredJobIds.length > 0) {
      this.scheduleDispatch();
    }
    return expiredJobIds.length;
  }

  async getActiveJobForUser(
    userId: string,
  ): Promise<SkinJournalInsightJob | null> {
    if (!(await this.ensureInsightJobTableReady())) {
      return null;
    }
    return this.jobs.findOne({
      where: { user_id: userId, status: In(ACTIVE_JOB_STATUSES) },
      order: { run_after: 'ASC' },
    });
  }

  async getQueueMetrics(): Promise<InsightQueueMetrics> {
    if (!(await this.ensureInsightJobTableReady())) {
      return this.emptyQueueMetrics();
    }
    const [
      queued,
      sent,
      running,
      failed,
      completed,
      cancelled,
      oldestQueued,
      retrying,
    ] = await Promise.all([
      this.jobs.count({ where: { status: InsightJobStatusValue.Queued } }),
      this.jobs.count({ where: { status: InsightJobStatusValue.Sent } }),
      this.jobs.count({ where: { status: InsightJobStatusValue.Running } }),
      this.jobs.count({ where: { status: InsightJobStatusValue.Failed } }),
      this.jobs.count({ where: { status: InsightJobStatusValue.Completed } }),
      this.jobs.count({ where: { status: InsightJobStatusValue.Cancelled } }),
      this.jobs.findOne({
        where: {
          status: In([
            InsightJobStatusValue.Queued,
            InsightJobStatusValue.Sent,
          ]),
        },
        order: { run_after: 'ASC' },
      }),
      this.jobs
        .createQueryBuilder('job')
        .where('job.status IN (:...statuses)', {
          statuses: ACTIVE_JOB_STATUSES,
        })
        .andWhere('job.attempt_count > 0')
        .getCount(),
    ]);
    const [mainQueue, deadLetterQueue] = await Promise.all([
      this.getSqsQueueMetrics(this.queueUrl),
      this.getSqsQueueMetrics(this.dlqUrl),
    ]);
    return {
      driver: this.driver,
      queued_count: queued,
      sent_count: sent,
      running_count: running,
      failed_count: failed,
      completed_count: completed,
      cancelled_count: cancelled,
      oldest_queued_age_seconds: oldestQueued
        ? Math.max(
            0,
            Math.floor((Date.now() - oldestQueued.run_after.getTime()) / 1000),
          )
        : null,
      retrying_count: retrying,
      sqs_visible_count: mainQueue.visible,
      sqs_not_visible_count: mainQueue.notVisible,
      sqs_redrive_policy_configured: mainQueue.redrivePolicyConfigured,
      dlq_visible_count: deadLetterQueue.visible,
    };
  }

  private scheduleDispatch(): void {
    if (this.stopped) {
      return;
    }
    if (this.driver !== 'sqs') {
      return;
    }
    if (this.insightJobTableReady === false) {
      return;
    }
    if (this.dispatchTimer) {
      clearTimeout(this.dispatchTimer);
      this.dispatchTimer = null;
    }
    this.dispatchTimer = setTimeout(() => {
      this.dispatchTimer = null;
      void this.dispatchDueJobs().catch((error) => {
        this.logger.error(
          'Failed to dispatch skin journal insight jobs',
          error,
        );
        this.scheduleDispatch();
      });
    }, SKIN_JOURNAL_INSIGHT_JOB_DISPATCH_INTERVAL_MS);
    this.dispatchTimer.unref?.();
  }

  private async sendSqsJob(jobId: string): Promise<void> {
    if (!this.sqsClient || !this.queueUrl) {
      throw new Error('Skin Journal insight SQS queue is not configured');
    }
    await this.sqsClient.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify({ job_id: jobId }),
      }),
    );
  }

  private async assertInsightJobTableReady(): Promise<void> {
    if (!(await this.ensureInsightJobTableReady())) {
      throw new Error(this.insightJobTableMissingMessage());
    }
  }

  private async ensureInsightJobTableReady(): Promise<boolean> {
    if (this.insightJobTableReady !== null) {
      return this.insightJobTableReady;
    }

    const manager = this.jobs.manager as
      | {
          query?: (
            query: string,
            parameters?: unknown[],
          ) => Promise<Array<{ relation: string | null }>>;
        }
      | undefined;
    if (typeof manager?.query !== 'function') {
      this.insightJobTableReady = true;
      return true;
    }

    try {
      const rows = await manager.query('SELECT to_regclass($1) AS relation', [
        INSIGHT_JOB_TABLE_NAME,
      ]);
      const exists = rows.some((row) => row.relation !== null);
      this.insightJobTableReady = exists;
      if (!exists) {
        this.handleMissingInsightJobTable();
      }
      return exists;
    } catch (error) {
      if (!isUndefinedTableError(error)) {
        throw error;
      }
      this.insightJobTableReady = false;
      this.handleMissingInsightJobTable();
      return false;
    }
  }

  private handleMissingInsightJobTable(): void {
    const message = this.insightJobTableMissingMessage();
    if (process.env.NODE_ENV === 'production') {
      throw new Error(message);
    }
    this.logger.warn(message);
  }

  private insightJobTableMissingMessage(): string {
    return `${INSIGHT_JOB_TABLE_NAME} is missing. Run backend migrations or reset the local pre-deploy database so the Skin Journal insight queue schema is created.`;
  }

  private emptyQueueMetrics(): InsightQueueMetrics {
    return {
      driver: this.driver,
      queued_count: 0,
      sent_count: 0,
      running_count: 0,
      failed_count: 0,
      completed_count: 0,
      cancelled_count: 0,
      oldest_queued_age_seconds: null,
      retrying_count: 0,
      sqs_visible_count: null,
      sqs_not_visible_count: null,
      sqs_redrive_policy_configured: null,
      dlq_visible_count: null,
    };
  }

  private async lockGenerationGate(manager: {
    query?: (query: string, parameters?: unknown[]) => Promise<unknown>;
  }): Promise<void> {
    if (typeof manager.query !== 'function') {
      return;
    }
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      'skin-journal-insight-generation',
    ]);
  }

  private async assertSqsConfiguration(): Promise<void> {
    if (this.driver !== 'sqs' || !this.sqsClient || !this.queueUrl) {
      return;
    }
    try {
      const attributes = await this.getSqsAttributes(this.queueUrl);
      if (process.env.NODE_ENV === 'production' && !attributes.RedrivePolicy) {
        throw new Error(
          'Skin Journal insight SQS queue must configure a dead-letter queue redrive policy in production.',
        );
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'production') {
        throw error;
      }
      this.logger.warn(
        `Skin Journal insight SQS configuration check skipped: ${this.errorMessage(error)}`,
      );
    }
  }

  private async getSqsQueueMetrics(queueUrl: string): Promise<{
    visible: number | null;
    notVisible: number | null;
    redrivePolicyConfigured: boolean | null;
  }> {
    if (this.driver !== 'sqs' || !queueUrl) {
      return {
        visible: null,
        notVisible: null,
        redrivePolicyConfigured: null,
      };
    }
    try {
      const attributes = await this.getSqsAttributes(queueUrl);
      return {
        visible: this.parseSqsNumber(attributes.ApproximateNumberOfMessages),
        notVisible: this.parseSqsNumber(
          attributes.ApproximateNumberOfMessagesNotVisible,
        ),
        redrivePolicyConfigured: !!attributes.RedrivePolicy,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to read Skin Journal insight SQS metrics: ${this.errorMessage(error)}`,
      );
      return {
        visible: null,
        notVisible: null,
        redrivePolicyConfigured: null,
      };
    }
  }

  private async getSqsAttributes(
    queueUrl: string,
  ): Promise<Record<string, string | undefined>> {
    if (!this.sqsClient) {
      return {};
    }
    const response = await this.sqsClient.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: [
          'ApproximateNumberOfMessages',
          'ApproximateNumberOfMessagesNotVisible',
          'RedrivePolicy',
        ],
      }),
    );
    return response.Attributes ?? {};
  }

  private toQueueMessage(message: Message): InsightQueueMessage | null {
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

  private readQueueDriver(): InsightQueueDriver {
    const configured = this.config.getOrThrow<InsightQueueDriver>(
      'SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER',
    );
    return configured === 'sqs' ? 'sqs' : 'database';
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown queue error';
  }

  private parseSqsNumber(value: string | undefined): number | null {
    if (value === undefined) {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
}

function isUndefinedTableError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '42P01'
  );
}

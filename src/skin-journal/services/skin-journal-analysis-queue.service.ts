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
import { In, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { SkinJournalAnalysisJob } from '../entities/skin-journal-analysis-job.entity';
import {
  SKIN_JOURNAL_ANALYSIS_ASSUMED_RUN_COST_USD,
  SKIN_JOURNAL_ANALYSIS_CAPACITY_RETRY_DELAY_MS,
  SKIN_JOURNAL_ANALYSIS_DAILY_BUDGET_USD,
  SKIN_JOURNAL_ANALYSIS_JOB_BACKOFF_BASE_SECONDS,
  SKIN_JOURNAL_ANALYSIS_JOB_BACKOFF_MAX_SECONDS,
  SKIN_JOURNAL_ANALYSIS_JOB_DISPATCH_INTERVAL_MS,
  SKIN_JOURNAL_ANALYSIS_JOB_LOCK_TTL_SECONDS,
  SKIN_JOURNAL_ANALYSIS_JOB_MAX_ATTEMPTS,
  SKIN_JOURNAL_ANALYSIS_MAX_CONCURRENT,
  SKIN_JOURNAL_ANALYSIS_MAX_CONCURRENT_PER_USER,
  SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER,
  SKIN_JOURNAL_ANALYSIS_SQS_VISIBILITY_TIMEOUT_SECONDS,
  SKIN_JOURNAL_ANALYSIS_SQS_WAIT_TIME_SECONDS,
  type AnalysisJobStatus,
  type AnalysisQueueDriver,
} from '../skin-journal.constants';

const ACTIVE_JOB_STATUSES: AnalysisJobStatus[] = ['queued', 'sent', 'running'];
const CLAIMABLE_JOB_STATUSES: AnalysisJobStatus[] = ['queued', 'sent'];
const ANALYSIS_JOB_TABLE_NAME = 'skin_journal_analysis_jobs';

export type AnalysisQueueMessage = {
  jobId: string;
  receiptHandle: string;
};

export type AnalysisQueueMetrics = {
  driver: AnalysisQueueDriver;
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
  sqs_oldest_message_age_seconds: number | null;
  sqs_redrive_policy_configured: boolean | null;
  dlq_visible_count: number | null;
  dlq_oldest_message_age_seconds: number | null;
};

@Injectable()
export class SkinJournalAnalysisQueueService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SkinJournalAnalysisQueueService.name);
  private readonly driver: AnalysisQueueDriver;
  private readonly queueUrl: string;
  private readonly dlqUrl: string;
  private readonly sqsClient: SQSClient | null;
  private readonly waitTimeSeconds: number;
  private readonly visibilityTimeoutSeconds: number;
  private readonly lockTtlSeconds: number;
  private readonly maxAttempts: number;
  private readonly backoffBaseSeconds: number;
  private readonly backoffMaxSeconds: number;
  private dispatchTimer: ReturnType<typeof setTimeout> | null = null;
  private analysisJobTableReady: boolean | null = null;
  private stopped = false;

  constructor(
    @InjectRepository(SkinJournalAnalysisJob)
    private readonly jobs: Repository<SkinJournalAnalysisJob>,
    private readonly config: ConfigService,
  ) {
    this.driver = this.readQueueDriver();
    this.queueUrl = this.config.get<string>(
      'SKIN_JOURNAL_ANALYSIS_SQS_QUEUE_URL',
      '',
    );
    this.dlqUrl = this.config.get<string>(
      'SKIN_JOURNAL_ANALYSIS_SQS_DLQ_URL',
      '',
    );
    this.waitTimeSeconds = SKIN_JOURNAL_ANALYSIS_SQS_WAIT_TIME_SECONDS;
    this.visibilityTimeoutSeconds =
      SKIN_JOURNAL_ANALYSIS_SQS_VISIBILITY_TIMEOUT_SECONDS;
    this.lockTtlSeconds = SKIN_JOURNAL_ANALYSIS_JOB_LOCK_TTL_SECONDS;
    this.maxAttempts = SKIN_JOURNAL_ANALYSIS_JOB_MAX_ATTEMPTS;
    this.backoffBaseSeconds = SKIN_JOURNAL_ANALYSIS_JOB_BACKOFF_BASE_SECONDS;
    this.backoffMaxSeconds = SKIN_JOURNAL_ANALYSIS_JOB_BACKOFF_MAX_SECONDS;
    this.sqsClient =
      this.driver === 'sqs'
        ? new SQSClient({
            region: this.config.get<string>('AWS_REGION', 'eu-west-1'),
          })
        : null;
  }

  async onModuleInit(): Promise<void> {
    this.stopped = false;
    if (!(await this.ensureAnalysisJobTableReady())) {
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
  }

  getDriver(): AnalysisQueueDriver {
    return this.driver;
  }

  getMaxAttempts(): number {
    return this.maxAttempts;
  }

  async isReady(): Promise<boolean> {
    return this.ensureAnalysisJobTableReady();
  }

  nextRetryAt(attemptCount: number, now = new Date()): Date {
    const backoffSeconds = Math.min(
      this.backoffMaxSeconds,
      this.backoffBaseSeconds * 2 ** Math.max(0, attemptCount - 1),
    );
    return new Date(now.getTime() + backoffSeconds * 1000);
  }

  async enqueueAnalysisJob(params: {
    userId: string;
    entryId: string;
    photoObjectKey: string;
    reason?: string | null;
    runAfter?: Date;
  }): Promise<SkinJournalAnalysisJob> {
    await this.assertAnalysisJobTableReady();
    const runAfter = params.runAfter ?? new Date();
    const existing = await this.jobs.findOne({
      where: {
        entry_id: params.entryId,
        photo_object_key: params.photoObjectKey,
        status: In(ACTIVE_JOB_STATUSES),
      },
    });
    const job =
      existing ??
      this.jobs.create({
        user_id: params.userId,
        entry_id: params.entryId,
        photo_object_key: params.photoObjectKey,
        attempt_count: 0,
        max_attempts: this.maxAttempts,
      });

    job.user_id = params.userId;
    job.entry_id = params.entryId;
    job.photo_object_key = params.photoObjectKey;
    job.run_after = runAfter;
    job.max_attempts = job.max_attempts || this.maxAttempts;
    job.completed_at = null;
    job.last_error = params.reason ?? job.last_error ?? null;
    if (job.status !== 'running') {
      job.status = 'queued';
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
    if (!(await this.ensureAnalysisJobTableReady())) {
      return 0;
    }
    const dueJobs = await this.jobs.find({
      where: {
        status: 'queued',
        run_after: LessThanOrEqual(new Date()),
      },
      order: { run_after: 'ASC' },
      take: limit,
    });
    let sent = 0;
    for (const job of dueJobs) {
      try {
        await this.sendSqsJob(job.id);
        job.status = 'sent';
        job.last_error = null;
        await this.jobs.save(job);
        sent += 1;
      } catch (error) {
        job.status = 'queued';
        job.last_error = this.errorMessage(error);
        await this.jobs.save(job);
        this.logger.error(
          `Failed to send skin journal analysis job ${job.id} to SQS`,
          error,
        );
      }
    }
    this.scheduleDispatch();
    return sent;
  }

  async receiveMessages(): Promise<AnalysisQueueMessage[]> {
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
    const messages: AnalysisQueueMessage[] = [];
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
  ): Promise<SkinJournalAnalysisJob | null> {
    await this.assertAnalysisJobTableReady();
    return this.jobs.manager.transaction(async (manager) => {
      const repo = manager.getRepository(SkinJournalAnalysisJob);
      await this.lockCapacityGate(manager);
      const job = await repo
        .createQueryBuilder('job')
        .setLock('pessimistic_write')
        .where('job.id = :jobId', { jobId })
        .getOne();
      if (!job || !CLAIMABLE_JOB_STATUSES.includes(job.status)) {
        return null;
      }
      if (job.run_after.getTime() > Date.now()) {
        job.status = 'queued';
        job.locked_at = null;
        job.locked_by = null;
        await repo.save(job);
        this.scheduleDispatch();
        return null;
      }
      const capacity = await this.canClaimDistributedCapacity(repo, job);
      if (!capacity.ok) {
        job.status = 'queued';
        job.locked_at = null;
        job.locked_by = null;
        job.last_error = capacity.reason;
        job.run_after = capacity.runAfter;
        await repo.save(job);
        this.scheduleDispatch();
        return null;
      }
      job.status = 'running';
      job.locked_at = new Date();
      job.locked_by = workerId;
      job.attempt_count += 1;
      return repo.save(job);
    });
  }

  async claimNextDatabaseJob(
    workerId: string,
  ): Promise<SkinJournalAnalysisJob | null> {
    if (this.driver !== 'database') {
      return null;
    }
    if (!(await this.ensureAnalysisJobTableReady())) {
      return null;
    }
    return this.jobs.manager.transaction(async (manager) => {
      const repo = manager.getRepository(SkinJournalAnalysisJob);
      await this.lockCapacityGate(manager);
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
      const capacity = await this.canClaimDistributedCapacity(repo, job);
      if (!capacity.ok) {
        job.status = 'queued';
        job.locked_at = null;
        job.locked_by = null;
        job.last_error = capacity.reason;
        job.run_after = capacity.runAfter;
        await repo.save(job);
        this.scheduleDispatch();
        return null;
      }
      job.status = 'running';
      job.locked_at = new Date();
      job.locked_by = workerId;
      job.attempt_count += 1;
      return repo.save(job);
    });
  }

  async getJob(jobId: string): Promise<SkinJournalAnalysisJob | null> {
    await this.assertAnalysisJobTableReady();
    return this.jobs.findOne({ where: { id: jobId } });
  }

  async completeJob(job: SkinJournalAnalysisJob): Promise<void> {
    job.status = 'completed';
    job.locked_at = null;
    job.locked_by = null;
    job.last_error = null;
    job.completed_at = new Date();
    await this.jobs.save(job);
  }

  async failJob(job: SkinJournalAnalysisJob, error: string): Promise<void> {
    job.status = 'failed';
    job.locked_at = null;
    job.locked_by = null;
    job.last_error = error;
    job.completed_at = new Date();
    await this.jobs.save(job);
  }

  async cancelJob(job: SkinJournalAnalysisJob, reason: string): Promise<void> {
    job.status = 'cancelled';
    job.locked_at = null;
    job.locked_by = null;
    job.last_error = reason;
    job.completed_at = new Date();
    await this.jobs.save(job);
  }

  async rescheduleJob(
    job: SkinJournalAnalysisJob,
    params: { reason: string; runAfter: Date },
  ): Promise<void> {
    job.status = 'queued';
    job.run_after = params.runAfter;
    job.locked_at = null;
    job.locked_by = null;
    job.last_error = params.reason;
    job.completed_at = null;
    await this.jobs.save(job);
    this.scheduleDispatch();
  }

  async cancelActiveJobsForEntry(
    entryId: string,
    reason: string,
  ): Promise<void> {
    if (!(await this.ensureAnalysisJobTableReady())) {
      return;
    }
    const jobs = await this.jobs.find({
      where: { entry_id: entryId, status: In(ACTIVE_JOB_STATUSES) },
    });
    for (const job of jobs) {
      await this.cancelJob(job, reason);
    }
  }

  async recoverExpiredLocks(): Promise<number> {
    if (!(await this.ensureAnalysisJobTableReady())) {
      return 0;
    }
    const cutoff = new Date(Date.now() - this.lockTtlSeconds * 1000);
    const candidates = await this.jobs.find({
      where: { status: In(['sent', 'running']) },
      take: 100,
    });
    let recovered = 0;
    for (const job of candidates) {
      const referenceDate =
        job.status === 'running' ? job.locked_at : job.updated_at;
      if (referenceDate && referenceDate.getTime() > cutoff.getTime()) {
        continue;
      }
      job.status = 'queued';
      job.locked_at = null;
      job.locked_by = null;
      job.last_error =
        'Analysis job recovered after worker interruption or message loss.';
      job.run_after = new Date();
      await this.jobs.save(job);
      recovered += 1;
    }
    if (recovered > 0) {
      this.scheduleDispatch();
    }
    return recovered;
  }

  async getQueueMetrics(): Promise<AnalysisQueueMetrics> {
    if (!(await this.ensureAnalysisJobTableReady())) {
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
      this.jobs.count({ where: { status: 'queued' } }),
      this.jobs.count({ where: { status: 'sent' } }),
      this.jobs.count({ where: { status: 'running' } }),
      this.jobs.count({ where: { status: 'failed' } }),
      this.jobs.count({ where: { status: 'completed' } }),
      this.jobs.count({ where: { status: 'cancelled' } }),
      this.jobs.findOne({
        where: { status: In(['queued', 'sent']) },
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
      sqs_oldest_message_age_seconds: mainQueue.oldestAgeSeconds,
      sqs_redrive_policy_configured: mainQueue.redrivePolicyConfigured,
      dlq_visible_count: deadLetterQueue.visible,
      dlq_oldest_message_age_seconds: deadLetterQueue.oldestAgeSeconds,
    };
  }

  private scheduleDispatch(): void {
    if (this.stopped) {
      return;
    }
    if (this.driver !== 'sqs') {
      return;
    }
    if (this.analysisJobTableReady === false) {
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
          'Failed to dispatch skin journal analysis jobs',
          error,
        );
        this.scheduleDispatch();
      });
    }, SKIN_JOURNAL_ANALYSIS_JOB_DISPATCH_INTERVAL_MS);
    this.dispatchTimer.unref?.();
  }

  private async sendSqsJob(jobId: string): Promise<void> {
    if (!this.sqsClient || !this.queueUrl) {
      throw new Error('Skin Journal analysis SQS queue is not configured');
    }
    await this.sqsClient.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify({ job_id: jobId }),
      }),
    );
  }

  private async assertAnalysisJobTableReady(): Promise<void> {
    if (!(await this.ensureAnalysisJobTableReady())) {
      throw new Error(this.analysisJobTableMissingMessage());
    }
  }

  private async ensureAnalysisJobTableReady(): Promise<boolean> {
    if (this.analysisJobTableReady !== null) {
      return this.analysisJobTableReady;
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
      this.analysisJobTableReady = true;
      return true;
    }

    try {
      const rows = await manager.query('SELECT to_regclass($1) AS relation', [
        ANALYSIS_JOB_TABLE_NAME,
      ]);
      const exists = rows.some((row) => row.relation !== null);
      this.analysisJobTableReady = exists;
      if (!exists) {
        this.handleMissingAnalysisJobTable();
      }
      return exists;
    } catch (error) {
      if (!isUndefinedTableError(error)) {
        throw error;
      }
      this.analysisJobTableReady = false;
      this.handleMissingAnalysisJobTable();
      return false;
    }
  }

  private handleMissingAnalysisJobTable(): void {
    const message = this.analysisJobTableMissingMessage();
    if (process.env.NODE_ENV === 'production') {
      throw new Error(message);
    }
    this.logger.warn(message);
  }

  private analysisJobTableMissingMessage(): string {
    return `${ANALYSIS_JOB_TABLE_NAME} is missing. Run backend migrations or reset the local pre-deploy database so the Skin Journal queue schema is created.`;
  }

  private emptyQueueMetrics(): AnalysisQueueMetrics {
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
      sqs_oldest_message_age_seconds: null,
      sqs_redrive_policy_configured: null,
      dlq_visible_count: null,
      dlq_oldest_message_age_seconds: null,
    };
  }

  private async lockCapacityGate(manager: {
    query?: (query: string, parameters?: unknown[]) => Promise<unknown>;
  }): Promise<void> {
    if (typeof manager.query !== 'function') {
      return;
    }
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      'skin-journal-analysis-capacity',
    ]);
  }

  private async canClaimDistributedCapacity(
    repo: Repository<SkinJournalAnalysisJob>,
    job: SkinJournalAnalysisJob,
  ): Promise<{ ok: true } | { ok: false; reason: string; runAfter: Date }> {
    const cutoff = new Date(Date.now() - this.lockTtlSeconds * 1000);
    const [globalRunning, userRunning, userAttemptsToday] = await Promise.all([
      repo.count({
        where: {
          status: 'running',
          locked_at: MoreThanOrEqual(cutoff),
        },
      }),
      repo.count({
        where: {
          user_id: job.user_id,
          status: 'running',
          locked_at: MoreThanOrEqual(cutoff),
        },
      }),
      this.countUserAnalysisAttemptsToday(repo, job.user_id),
    ]);

    if (globalRunning >= SKIN_JOURNAL_ANALYSIS_MAX_CONCURRENT) {
      return {
        ok: false,
        reason:
          'Analysis queued because current global analysis capacity is full.',
        runAfter: this.nextCapacityRetryAt(),
      };
    }
    if (userRunning >= SKIN_JOURNAL_ANALYSIS_MAX_CONCURRENT_PER_USER) {
      return {
        ok: false,
        reason:
          'Analysis queued because current user analysis capacity is full.',
        runAfter: this.nextCapacityRetryAt(),
      };
    }
    if (userAttemptsToday >= this.maxDailyAnalysisRuns()) {
      return {
        ok: false,
        reason:
          'Analysis queued because the daily analysis budget has been reached.',
        runAfter: this.nextBudgetRetryAt(),
      };
    }

    return { ok: true };
  }

  private async countUserAnalysisAttemptsToday(
    repo: Repository<SkinJournalAnalysisJob>,
    userId: string,
  ): Promise<number> {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const row = await repo
      .createQueryBuilder('job')
      .select('COALESCE(SUM(job.attempt_count), 0)', 'attempts')
      .where('job.user_id = :userId', { userId })
      .andWhere('job.updated_at >= :dayStart', { dayStart })
      .andWhere('job.attempt_count > 0')
      .getRawOne<{ attempts?: string | number | null }>();
    const parsed = Number(row?.attempts ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private maxDailyAnalysisRuns(): number {
    if (SKIN_JOURNAL_ANALYSIS_DAILY_BUDGET_USD <= 0) {
      return 0;
    }
    return Math.max(
      1,
      Math.floor(
        SKIN_JOURNAL_ANALYSIS_DAILY_BUDGET_USD /
          SKIN_JOURNAL_ANALYSIS_ASSUMED_RUN_COST_USD,
      ),
    );
  }

  private nextCapacityRetryAt(): Date {
    return new Date(Date.now() + SKIN_JOURNAL_ANALYSIS_CAPACITY_RETRY_DELAY_MS);
  }

  private nextBudgetRetryAt(now = new Date()): Date {
    const nextWindow = new Date(now);
    nextWindow.setUTCDate(nextWindow.getUTCDate() + 1);
    nextWindow.setUTCHours(0, 1, 0, 0);
    return nextWindow;
  }

  private async assertSqsConfiguration(): Promise<void> {
    if (this.driver !== 'sqs' || !this.sqsClient || !this.queueUrl) {
      return;
    }
    try {
      const attributes = await this.getSqsAttributes(this.queueUrl);
      if (process.env.NODE_ENV === 'production' && !attributes.RedrivePolicy) {
        throw new Error(
          'Skin Journal analysis SQS queue must configure a dead-letter queue redrive policy in production.',
        );
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'production') {
        throw error;
      }
      this.logger.warn(
        `Skin Journal analysis SQS configuration check skipped: ${this.errorMessage(error)}`,
      );
    }
  }

  private async getSqsQueueMetrics(queueUrl: string): Promise<{
    visible: number | null;
    notVisible: number | null;
    oldestAgeSeconds: number | null;
    redrivePolicyConfigured: boolean | null;
  }> {
    if (this.driver !== 'sqs' || !queueUrl) {
      return {
        visible: null,
        notVisible: null,
        oldestAgeSeconds: null,
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
        oldestAgeSeconds: this.parseSqsNumber(
          attributes.ApproximateAgeOfOldestMessage,
        ),
        redrivePolicyConfigured: !!attributes.RedrivePolicy,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to read Skin Journal SQS metrics: ${this.errorMessage(error)}`,
      );
      return {
        visible: null,
        notVisible: null,
        oldestAgeSeconds: null,
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

  private toQueueMessage(message: Message): AnalysisQueueMessage | null {
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

  private readQueueDriver(): AnalysisQueueDriver {
    const configured = this.config.get<AnalysisQueueDriver>(
      'SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER',
      SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER,
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

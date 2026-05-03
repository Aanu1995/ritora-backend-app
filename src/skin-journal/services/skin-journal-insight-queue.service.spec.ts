import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { SkinJournalInsightQueueService } from './skin-journal-insight-queue.service';
import { SkinJournalInsightJob } from '../entities/skin-journal-insight-job.entity';

type MockInsightJob = SkinJournalInsightJob;

const now = new Date('2026-05-01T10:00:00.000Z');

const makeJob = (overrides: Partial<MockInsightJob> = {}): MockInsightJob =>
  ({
    id: 'insight-job-1',
    user_id: 'user-1',
    trigger: 'scheduled_refresh',
    status: 'queued',
    locale: 'en',
    input_signature: 'signature-1',
    attempt_count: 0,
    max_attempts: 5,
    run_after: new Date(now),
    locked_at: null,
    locked_by: null,
    last_error: null,
    completed_at: null,
    created_at: new Date(now),
    updated_at: new Date(now),
    ...overrides,
  }) as MockInsightJob;

const repo = () => ({
  create: jest.fn((data) => makeJob(data)),
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  save: jest.fn(async (data) => data),
  count: jest.fn().mockResolvedValue(0),
  createQueryBuilder: jest.fn(),
  manager: {},
});

const queryBuilder = (result: unknown) => ({
  setLock: jest.fn().mockReturnThis(),
  setOnLocked: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  getOne: jest.fn().mockResolvedValue(result),
  getCount: jest.fn().mockResolvedValue(result),
});

function config(values: Record<string, unknown>): ConfigService {
  const configValues: Record<string, unknown> = {
    AWS_REGION: 'eu-north-1',
    SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER: 'database',
    SKIN_JOURNAL_INSIGHT_SQS_QUEUE_URL: '',
    SKIN_JOURNAL_INSIGHT_SQS_DLQ_URL: '',
    ...values,
  };

  return {
    get: jest.fn((key: string) => configValues[key]),
    getOrThrow: jest.fn((key: string) => {
      if (Object.prototype.hasOwnProperty.call(configValues, key)) {
        return configValues[key];
      }
      throw new Error(`Missing config ${key}`);
    }),
  } as unknown as ConfigService;
}

describe('SkinJournalInsightQueueService', () => {
  const services: SkinJournalInsightQueueService[] = [];

  afterEach(() => {
    for (const service of services) {
      service.onModuleDestroy();
    }
    services.length = 0;
    jest.clearAllMocks();
  });

  it('creates a DB job and sends an SQS message containing only the job id', async () => {
    const jobs = repo();
    jobs.find.mockResolvedValue([
      {
        id: 'insight-job-1',
        user_id: 'user-1',
        status: 'queued',
        run_after: new Date(),
      },
    ]);
    const service = new SkinJournalInsightQueueService(
      jobs as never,
      config({
        SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER: 'sqs',
        SKIN_JOURNAL_INSIGHT_SQS_QUEUE_URL:
          'https://sqs.eu-west-1.amazonaws.com/123/skin-journal-insights',
      }),
    );
    services.push(service);
    const send = jest.fn().mockResolvedValue({});
    (service as unknown as { sqsClient: { send: jest.Mock } }).sqsClient = {
      send,
    };

    await service.enqueueInsightJob({
      userId: 'user-1',
      trigger: 'photo_analysis_completed',
      locale: 'en',
      inputSignature: 'signature-1',
      reason: 'Insight generation queued.',
    });

    const command = send.mock.calls[0]?.[0] as {
      input: { MessageBody: string; QueueUrl: string };
    };
    expect(JSON.parse(command.input.MessageBody)).toEqual({
      job_id: 'insight-job-1',
    });
    expect(command.input.MessageBody).not.toContain('user-1');
    expect(command.input.MessageBody).not.toContain('signature-1');
    expect(jobs.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent' }),
    );
  });

  it('coalesces active user jobs instead of creating duplicate expensive work', async () => {
    const jobs = repo();
    const activeJob = {
      id: 'insight-job-1',
      user_id: 'user-1',
      status: 'queued',
      trigger: 'scheduled_refresh',
      locale: 'en',
      input_signature: 'old-signature',
      attempt_count: 0,
      max_attempts: 5,
      run_after: new Date('2026-05-01T09:00:00.000Z'),
      locked_at: null,
      locked_by: null,
      last_error: null,
      completed_at: null,
    };
    jobs.findOne.mockResolvedValue(activeJob);
    const service = new SkinJournalInsightQueueService(
      jobs as never,
      config({ SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER: 'database' }),
    );
    services.push(service);

    await service.enqueueInsightJob({
      userId: 'user-1',
      trigger: 'check_in_updated',
      locale: 'sv',
      inputSignature: 'new-signature',
    });

    expect(jobs.create).not.toHaveBeenCalled();
    expect(jobs.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'insight-job-1',
        trigger: 'check_in_updated',
        locale: 'sv',
        input_signature: 'new-signature',
        status: 'queued',
      }),
    );
  });

  it('does not overwrite a running user job when a later enqueue arrives', async () => {
    const jobs = repo();
    const runningJob = {
      id: 'insight-job-running',
      user_id: 'user-1',
      status: 'running',
      trigger: 'scheduled_refresh',
      locale: 'en',
      input_signature: 'running-signature',
      attempt_count: 1,
      max_attempts: 5,
      run_after: new Date('2026-05-01T09:00:00.000Z'),
      locked_at: new Date('2026-05-01T09:01:00.000Z'),
      locked_by: 'worker-1',
      last_error: null,
      completed_at: null,
    };
    jobs.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(runningJob);
    const service = new SkinJournalInsightQueueService(
      jobs as never,
      config({ SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER: 'database' }),
    );
    services.push(service);

    const result = await service.enqueueInsightJob({
      userId: 'user-1',
      trigger: 'check_in_updated',
      locale: 'sv',
      inputSignature: 'new-signature',
    });

    expect(result).toBe(runningJob);
    expect(jobs.create).not.toHaveBeenCalled();
    expect(jobs.save).not.toHaveBeenCalled();
  });

  it('keeps the DB job queued when SQS send fails', async () => {
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const jobs = repo();
    jobs.find.mockResolvedValue([
      {
        id: 'insight-job-1',
        user_id: 'user-1',
        status: 'queued',
        run_after: new Date(),
      },
    ]);
    const service = new SkinJournalInsightQueueService(
      jobs as never,
      config({
        SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER: 'sqs',
        SKIN_JOURNAL_INSIGHT_SQS_QUEUE_URL:
          'https://sqs.eu-west-1.amazonaws.com/123/skin-journal-insights',
      }),
    );
    services.push(service);
    (service as unknown as { sqsClient: { send: jest.Mock } }).sqsClient = {
      send: jest.fn().mockRejectedValue(new Error('sqs unavailable')),
    };

    await service.dispatchDueJobs();

    loggerSpy.mockRestore();
    expect(jobs.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'queued',
        last_error: 'sqs unavailable',
      }),
    );
  });

  it('parses only safe SQS messages and deletes malformed messages', async () => {
    const jobs = repo();
    const service = new SkinJournalInsightQueueService(
      jobs as never,
      config({
        SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER: 'sqs',
        SKIN_JOURNAL_INSIGHT_SQS_QUEUE_URL: 'https://sqs.example/queue',
      }),
    );
    services.push(service);
    const send = jest
      .fn()
      .mockResolvedValueOnce({
        Messages: [
          {
            Body: JSON.stringify({ job_id: 'job-valid' }),
            ReceiptHandle: 'receipt-valid',
          },
          {
            Body: JSON.stringify({
              job_id: 'job-invalid',
              user_id: 'must-not-be-trusted',
            }),
            ReceiptHandle: 'receipt-extra',
          },
          { Body: '{broken', ReceiptHandle: 'receipt-broken' },
          { Body: JSON.stringify({ job_id: '' }), ReceiptHandle: 'empty' },
        ],
      })
      .mockResolvedValue({});
    (service as unknown as { sqsClient: { send: jest.Mock } }).sqsClient = {
      send,
    };

    const messages = await service.receiveMessages();

    expect(messages).toEqual([
      { jobId: 'job-valid', receiptHandle: 'receipt-valid' },
      { jobId: 'job-invalid', receiptHandle: 'receipt-extra' },
    ]);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[1][0].input).toEqual(
      expect.objectContaining({ ReceiptHandle: 'receipt-broken' }),
    );
    expect(send.mock.calls[2][0].input).toEqual(
      expect.objectContaining({ ReceiptHandle: 'empty' }),
    );
  });

  it('extends message visibility and deletes messages only when SQS is configured', async () => {
    const jobs = repo();
    const service = new SkinJournalInsightQueueService(
      jobs as never,
      config({
        SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER: 'sqs',
        SKIN_JOURNAL_INSIGHT_SQS_QUEUE_URL: 'https://sqs.example/queue',
      }),
    );
    services.push(service);
    const send = jest.fn().mockResolvedValue({});
    (service as unknown as { sqsClient: { send: jest.Mock } }).sqsClient = {
      send,
    };

    await service.extendMessageVisibility('receipt-1');
    await service.deleteMessage('receipt-1');

    expect(send.mock.calls[0][0].input).toEqual(
      expect.objectContaining({
        ReceiptHandle: 'receipt-1',
        VisibilityTimeout: expect.any(Number),
      }),
    );
    expect(send.mock.calls[1][0].input).toEqual(
      expect.objectContaining({ ReceiptHandle: 'receipt-1' }),
    );
  });

  it('claims due SQS jobs under a transaction and increments attempts', async () => {
    const jobs = repo();
    const job = makeJob({ status: 'sent', attempt_count: 2 });
    const txRepo = {
      createQueryBuilder: jest.fn(() => queryBuilder(job)),
      save: jest.fn(async (entity) => entity),
    };
    const manager = {
      query: jest.fn().mockResolvedValue(undefined),
      getRepository: jest.fn(() => txRepo),
    };
    jobs.manager = {
      transaction: jest.fn(async (callback) => callback(manager)),
    };
    const service = new SkinJournalInsightQueueService(
      jobs as never,
      config({ SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER: 'sqs' }),
    );
    services.push(service);

    const claimed = await service.claimJob('insight-job-1', 'worker-1');

    expect(claimed).toEqual(
      expect.objectContaining({
        status: 'running',
        locked_by: 'worker-1',
        attempt_count: 3,
      }),
    );
    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['skin-journal-insight-generation'],
    );
  });

  it('does not claim jobs scheduled for the future', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const jobs = repo();
    const job = makeJob({
      status: 'sent',
      run_after: new Date('2026-05-01T10:05:00.000Z'),
      locked_at: new Date(now),
      locked_by: 'previous-worker',
    });
    const txRepo = {
      createQueryBuilder: jest.fn(() => queryBuilder(job)),
      save: jest.fn(async (entity) => entity),
    };
    jobs.manager = {
      transaction: jest.fn(async (callback) =>
        callback({ getRepository: () => txRepo }),
      ),
    };
    const service = new SkinJournalInsightQueueService(
      jobs as never,
      config({ SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER: 'database' }),
    );
    services.push(service);

    const claimed = await service.claimJob('insight-job-1', 'worker-1');

    expect(claimed).toBeNull();
    expect(txRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'queued',
        locked_at: null,
        locked_by: null,
      }),
    );
    jest.useRealTimers();
  });

  it('claims the next database job using skip-locked semantics', async () => {
    const jobs = repo();
    const job = makeJob();
    const qb = queryBuilder(job);
    const txRepo = {
      createQueryBuilder: jest.fn(() => qb),
      save: jest.fn(async (entity) => entity),
    };
    jobs.manager = {
      transaction: jest.fn(async (callback) =>
        callback({ getRepository: () => txRepo }),
      ),
    };
    const service = new SkinJournalInsightQueueService(
      jobs as never,
      config({ SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER: 'database' }),
    );
    services.push(service);

    const claimed = await service.claimNextDatabaseJob('worker-2');

    expect(claimed).toEqual(
      expect.objectContaining({ status: 'running', locked_by: 'worker-2' }),
    );
    expect(qb.setOnLocked).toHaveBeenCalledWith('skip_locked');
  });

  it('updates terminal and rescheduled job states consistently', async () => {
    const jobs = repo();
    const service = new SkinJournalInsightQueueService(
      jobs as never,
      config({ SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER: 'database' }),
    );
    services.push(service);
    const job = makeJob({ status: 'running', locked_by: 'worker-1' });

    await service.completeJob(job);
    expect(jobs.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'completed',
        locked_by: null,
        last_error: null,
        completed_at: expect.any(Date),
      }),
    );

    await service.failJob(job, 'OpenAI unavailable');
    expect(jobs.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'failed',
        last_error: 'OpenAI unavailable',
      }),
    );

    await service.cancelJob(job, 'entry deleted');
    expect(jobs.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'cancelled',
        last_error: 'entry deleted',
      }),
    );

    await service.rescheduleJob(job, {
      reason: 'retry later',
      runAfter: new Date('2026-05-01T10:30:00.000Z'),
      inputSignature: 'signature-2',
      trigger: 'scheduled_refresh',
    });
    expect(jobs.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'queued',
        last_error: 'retry later',
        input_signature: 'signature-2',
        completed_at: null,
      }),
    );
  });

  it('recovers only expired sent and running jobs', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const jobs = repo();
    jobs.find.mockResolvedValue([
      makeJob({
        id: 'old-running',
        status: 'running',
        locked_at: new Date('2026-05-01T09:00:00.000Z'),
      }),
      makeJob({
        id: 'recent-running',
        status: 'running',
        locked_at: new Date('2026-05-01T09:59:00.000Z'),
      }),
      makeJob({
        id: 'old-sent',
        status: 'sent',
        updated_at: new Date('2026-05-01T09:00:00.000Z'),
      }),
    ]);
    const service = new SkinJournalInsightQueueService(
      jobs as never,
      config({ SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER: 'database' }),
    );
    services.push(service);

    const recovered = await service.recoverExpiredLocks();

    expect(recovered).toBe(2);
    expect(jobs.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'old-running', status: 'queued' }),
    );
    expect(jobs.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'old-sent', status: 'queued' }),
    );
    expect(jobs.save).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'recent-running', status: 'queued' }),
    );
    jest.useRealTimers();
  });

  it('returns queue metrics without loading sensitive job payloads', async () => {
    jest.useFakeTimers().setSystemTime(now);
    const jobs = repo();
    jobs.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(6);
    jobs.findOne.mockResolvedValue(
      makeJob({ run_after: new Date('2026-05-01T09:59:30.000Z') }),
    );
    jobs.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(7),
    });
    const service = new SkinJournalInsightQueueService(
      jobs as never,
      config({
        SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER: 'sqs',
        SKIN_JOURNAL_INSIGHT_SQS_QUEUE_URL: 'https://sqs.example/main',
        SKIN_JOURNAL_INSIGHT_SQS_DLQ_URL: 'https://sqs.example/dlq',
      }),
    );
    services.push(service);
    const send = jest
      .fn()
      .mockResolvedValueOnce({
        Attributes: {
          ApproximateNumberOfMessages: '8',
          ApproximateNumberOfMessagesNotVisible: '9',
          RedrivePolicy: '{}',
        },
      })
      .mockResolvedValueOnce({
        Attributes: {
          ApproximateNumberOfMessages: '10',
          ApproximateNumberOfMessagesNotVisible: 'not-a-number',
        },
      });
    (service as unknown as { sqsClient: { send: jest.Mock } }).sqsClient = {
      send,
    };

    await expect(service.getQueueMetrics()).resolves.toEqual({
      driver: 'sqs',
      queued_count: 2,
      sent_count: 1,
      running_count: 3,
      failed_count: 4,
      completed_count: 5,
      cancelled_count: 6,
      oldest_queued_age_seconds: 30,
      retrying_count: 7,
      sqs_visible_count: 8,
      sqs_not_visible_count: 9,
      sqs_redrive_policy_configured: true,
      dlq_visible_count: 10,
    });
    jest.useRealTimers();
  });

  it('returns empty metrics and rejects enqueues when the insight job table is missing', async () => {
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const jobs = repo();
    jobs.manager = {
      query: jest.fn().mockResolvedValue([{ relation: null }]),
    };
    const service = new SkinJournalInsightQueueService(
      jobs as never,
      config({ SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER: 'database' }),
    );
    services.push(service);

    await expect(service.isReady()).resolves.toBe(false);
    await expect(service.getQueueMetrics()).resolves.toEqual(
      expect.objectContaining({
        queued_count: 0,
        oldest_queued_age_seconds: null,
      }),
    );
    await expect(
      service.enqueueInsightJob({
        userId: 'user-1',
        trigger: 'scheduled_refresh',
        locale: 'en',
        inputSignature: 'signature-1',
      }),
    ).rejects.toThrow('skin_journal_insight_jobs is missing');
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('skin_journal_insight_jobs is missing'),
    );
    loggerSpy.mockRestore();
  });

  it('calculates capped retry dates', () => {
    const service = new SkinJournalInsightQueueService(
      repo() as never,
      config({ SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER: 'database' }),
    );
    services.push(service);

    expect(service.nextRetryAt(1, now).toISOString()).toBe(
      '2026-05-01T10:00:30.000Z',
    );
    expect(service.nextRetryAt(20, now).toISOString()).toBe(
      '2026-05-01T11:00:00.000Z',
    );
  });
});

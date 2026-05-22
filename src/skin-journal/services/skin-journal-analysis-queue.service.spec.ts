import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { SkinJournalAnalysisJob } from '../entities/skin-journal-analysis-job.entity';
import {
  SKIN_JOURNAL_ANALYSIS_ASSUMED_RUN_COST_USD,
  SKIN_JOURNAL_ANALYSIS_DAILY_BUDGET_USD,
  SKIN_JOURNAL_ANALYSIS_MAX_CONCURRENT,
} from '../skin-journal.constants';
import { SkinJournalAnalysisQueueService } from './skin-journal-analysis-queue.service';

const repo = () => ({
  create: jest.fn((data) => ({
    id: 'analysis-job-1',
    status: 'queued',
    attempt_count: 0,
    max_attempts: 5,
    run_after: new Date(),
    locked_at: null,
    locked_by: null,
    last_error: null,
    completed_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...data,
  })),
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  save: jest.fn(async (data) => data),
  update: jest.fn().mockResolvedValue({ affected: 0 }),
  count: jest.fn().mockResolvedValue(0),
  createQueryBuilder: jest.fn(),
});

function config(values: Record<string, unknown>): ConfigService {
  const configValues: Record<string, unknown> = {
    AWS_REGION: 'eu-north-1',
    SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER: 'database',
    SKIN_JOURNAL_ANALYSIS_SQS_QUEUE_URL: '',
    SKIN_JOURNAL_ANALYSIS_SQS_DLQ_URL: '',
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

describe('SkinJournalAnalysisQueueService', () => {
  const services: SkinJournalAnalysisQueueService[] = [];

  afterEach(() => {
    for (const service of services) {
      service.onModuleDestroy();
    }
    services.length = 0;
    jest.clearAllMocks();
  });

  it('creates a DB job and sends an SQS message containing only the job id', async () => {
    const jobs = repo();
    const dueJob = {
      id: 'analysis-job-1',
      user_id: 'user-1',
      entry_id: 'entry-1',
      photo_object_key: 'skin-journal/user-1/entry-1/photo.webp',
      status: 'queued',
      run_after: new Date(),
    };
    jobs.find.mockResolvedValue([dueJob]);
    const service = new SkinJournalAnalysisQueueService(
      jobs as never,
      config({
        SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER: 'sqs',
        SKIN_JOURNAL_ANALYSIS_SQS_QUEUE_URL:
          'https://sqs.eu-west-1.amazonaws.com/123/skin-journal-analysis',
      }),
    );
    services.push(service);
    const send = jest.fn().mockResolvedValue({});
    (service as unknown as { sqsClient: { send: jest.Mock } }).sqsClient = {
      send,
    };

    await service.enqueueAnalysisJob({
      userId: 'user-1',
      entryId: 'entry-1',
      photoObjectKey: 'skin-journal/user-1/entry-1/photo.webp',
      reason: 'Analysis queued after photo upload.',
    });

    const command = send.mock.calls[0]?.[0] as {
      input: { MessageBody: string; QueueUrl: string };
    };
    expect(JSON.parse(command.input.MessageBody)).toEqual({
      job_id: 'analysis-job-1',
    });
    expect(command.input.MessageBody).not.toContain('user-1');
    expect(command.input.MessageBody).not.toContain('photo.webp');
    expect(jobs.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent' }),
    );
  });

  it('keeps the DB job queued when SQS send fails', async () => {
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const jobs = repo();
    const dueJob = {
      id: 'analysis-job-1',
      user_id: 'user-1',
      entry_id: 'entry-1',
      photo_object_key: 'skin-journal/user-1/entry-1/photo.webp',
      status: 'queued',
      run_after: new Date(),
    };
    jobs.find.mockResolvedValue([dueJob]);
    const service = new SkinJournalAnalysisQueueService(
      jobs as never,
      config({
        SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER: 'sqs',
        SKIN_JOURNAL_ANALYSIS_SQS_QUEUE_URL:
          'https://sqs.eu-west-1.amazonaws.com/123/skin-journal-analysis',
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

  it('reuses active jobs for the same entry and photo', async () => {
    const jobs = repo();
    const existing = {
      id: 'analysis-job-existing',
      user_id: 'user-1',
      entry_id: 'entry-1',
      photo_object_key: 'skin-journal/user-1/entry-1/photo.webp',
      status: 'sent',
      attempt_count: 1,
      max_attempts: 5,
      run_after: new Date('2026-04-30T00:00:00.000Z'),
      locked_at: null,
      locked_by: null,
      last_error: null,
      completed_at: null,
    } as SkinJournalAnalysisJob;
    jobs.findOne.mockResolvedValue(existing);
    const service = new SkinJournalAnalysisQueueService(
      jobs as never,
      config({ SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER: 'database' }),
    );
    services.push(service);

    await service.enqueueAnalysisJob({
      userId: 'user-1',
      entryId: 'entry-1',
      photoObjectKey: 'skin-journal/user-1/entry-1/photo.webp',
      reason: 'Retry requested.',
    });

    expect(jobs.create).not.toHaveBeenCalled();
    expect(jobs.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'analysis-job-existing',
        status: 'queued',
        last_error: 'Retry requested.',
      }),
    );
  });

  it('extends SQS message visibility while a worker is still processing', async () => {
    const jobs = repo();
    const service = new SkinJournalAnalysisQueueService(
      jobs as never,
      config({
        SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER: 'sqs',
        SKIN_JOURNAL_ANALYSIS_SQS_QUEUE_URL:
          'https://sqs.eu-west-1.amazonaws.com/123/skin-journal-analysis',
      }),
    );
    services.push(service);
    const send = jest.fn().mockResolvedValue({});
    (service as unknown as { sqsClient: { send: jest.Mock } }).sqsClient = {
      send,
    };

    await service.extendMessageVisibility('receipt-1');

    expect(send.mock.calls[0]?.[0].input).toMatchObject({
      ReceiptHandle: 'receipt-1',
      VisibilityTimeout: 120,
    });
  });

  it('uses DB-backed capacity checks when claiming jobs', async () => {
    const jobs = repo();
    const runningJob = {
      id: 'analysis-job-1',
      user_id: 'user-1',
      entry_id: 'entry-1',
      photo_object_key: 'skin-journal/user-1/entry-1/photo.webp',
      status: 'sent',
      attempt_count: 0,
      max_attempts: 5,
      run_after: new Date(Date.now() - 1000),
      locked_at: null,
      locked_by: null,
      last_error: null,
      completed_at: null,
    } as SkinJournalAnalysisJob;
    const claimBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(runningJob),
    };
    const attemptsBuilder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ attempts: '0' }),
    };
    const claimRepo = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValueOnce(claimBuilder)
        .mockReturnValueOnce(attemptsBuilder),
      count: jest
        .fn()
        .mockResolvedValueOnce(SKIN_JOURNAL_ANALYSIS_MAX_CONCURRENT)
        .mockResolvedValueOnce(0),
      save: jest.fn(async (data) => data),
    };
    (jobs as unknown as { manager: unknown }).manager = {
      transaction: jest.fn((callback) =>
        callback({
          getRepository: () => claimRepo,
          query: jest.fn().mockResolvedValue(undefined),
        }),
      ),
    };
    const service = new SkinJournalAnalysisQueueService(
      jobs as never,
      config({ SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER: 'database' }),
    );
    services.push(service);

    const claimed = await service.claimJob('analysis-job-1', 'worker-1');

    expect(claimed).toBeNull();
    expect(claimRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'queued',
        locked_at: null,
        locked_by: null,
        last_error: expect.stringContaining('capacity'),
        run_after: expect.any(Date),
      }),
    );
  });

  it('defers budget-capped jobs to the next UTC budget window', async () => {
    const jobs = repo();
    const runningJob = {
      id: 'analysis-job-1',
      user_id: 'user-1',
      entry_id: 'entry-1',
      photo_object_key: 'skin-journal/user-1/entry-1/photo.webp',
      status: 'sent',
      attempt_count: 0,
      max_attempts: 5,
      run_after: new Date(Date.now() - 1000),
      locked_at: null,
      locked_by: null,
      last_error: null,
      completed_at: null,
    } as SkinJournalAnalysisJob;
    const dailyRunLimit = Math.max(
      1,
      Math.floor(
        SKIN_JOURNAL_ANALYSIS_DAILY_BUDGET_USD /
          SKIN_JOURNAL_ANALYSIS_ASSUMED_RUN_COST_USD,
      ),
    );
    const claimBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(runningJob),
    };
    const attemptsBuilder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ attempts: dailyRunLimit }),
    };
    const claimRepo = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValueOnce(claimBuilder)
        .mockReturnValueOnce(attemptsBuilder),
      count: jest.fn().mockResolvedValue(0),
      save: jest.fn(async (data) => data),
    };
    (jobs as unknown as { manager: unknown }).manager = {
      transaction: jest.fn((callback) =>
        callback({
          getRepository: () => claimRepo,
          query: jest.fn().mockResolvedValue(undefined),
        }),
      ),
    };
    const service = new SkinJournalAnalysisQueueService(
      jobs as never,
      config({ SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER: 'database' }),
    );
    services.push(service);

    const claimed = await service.claimJob('analysis-job-1', 'worker-1');

    expect(claimed).toBeNull();
    const saved = claimRepo.save.mock.calls[0]?.[0] as SkinJournalAnalysisJob;
    expect(saved.last_error).toContain('budget');
    expect(saved.run_after.toISOString().slice(11, 16)).toBe('00:01');
  });

  it('deletes malformed SQS messages so they do not poison the queue', async () => {
    const jobs = repo();
    const service = new SkinJournalAnalysisQueueService(
      jobs as never,
      config({
        SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER: 'sqs',
        SKIN_JOURNAL_ANALYSIS_SQS_QUEUE_URL:
          'https://sqs.eu-west-1.amazonaws.com/123/skin-journal-analysis',
      }),
    );
    services.push(service);
    const send = jest
      .fn()
      .mockResolvedValueOnce({
        Messages: [
          { Body: '{bad-json', ReceiptHandle: 'bad-receipt' },
          {
            Body: JSON.stringify({ job_id: 'analysis-job-1' }),
            ReceiptHandle: 'good-receipt',
          },
        ],
      })
      .mockResolvedValue({});
    (service as unknown as { sqsClient: { send: jest.Mock } }).sqsClient = {
      send,
    };

    const messages = await service.receiveMessages();

    expect(messages).toEqual([
      { jobId: 'analysis-job-1', receiptHandle: 'good-receipt' },
    ]);
    expect(send.mock.calls[1]?.[0].input).toMatchObject({
      ReceiptHandle: 'bad-receipt',
    });
  });

  it('includes DB, SQS, and DLQ aggregate counts in queue metrics', async () => {
    const jobs = repo();
    jobs.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(1);
    jobs.findOne.mockResolvedValue({
      run_after: new Date(Date.now() - 120000),
    });
    jobs.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(1),
    });
    const service = new SkinJournalAnalysisQueueService(
      jobs as never,
      config({
        SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER: 'sqs',
        SKIN_JOURNAL_ANALYSIS_SQS_QUEUE_URL:
          'https://sqs.eu-west-1.amazonaws.com/123/skin-journal-analysis',
        SKIN_JOURNAL_ANALYSIS_SQS_DLQ_URL:
          'https://sqs.eu-west-1.amazonaws.com/123/skin-journal-analysis-dlq',
      }),
    );
    services.push(service);
    (service as unknown as { sqsClient: { send: jest.Mock } }).sqsClient = {
      send: jest
        .fn()
        .mockResolvedValueOnce({
          Attributes: {
            ApproximateNumberOfMessages: '4',
            ApproximateNumberOfMessagesNotVisible: '2',
            RedrivePolicy: '{"deadLetterTargetArn":"arn"}',
          },
        })
        .mockResolvedValueOnce({
          Attributes: {
            ApproximateNumberOfMessages: '1',
          },
        }),
    };

    const metrics = await service.getQueueMetrics();

    expect(metrics).toMatchObject({
      driver: 'sqs',
      queued_count: 2,
      sent_count: 1,
      running_count: 1,
      failed_count: 1,
      completed_count: 10,
      cancelled_count: 1,
      retrying_count: 1,
      sqs_visible_count: 4,
      sqs_not_visible_count: 2,
      sqs_oldest_message_age_seconds: null,
      sqs_redrive_policy_configured: true,
      dlq_visible_count: 1,
      dlq_oldest_message_age_seconds: null,
    });
  });

  it('recovers expired sent and running jobs with one batch update', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-01T10:00:00.000Z'));
    const jobs = repo();
    jobs.find.mockResolvedValue([
      {
        id: 'old-running',
        status: 'running',
        locked_at: new Date('2026-05-01T09:00:00.000Z'),
      },
      {
        id: 'recent-running',
        status: 'running',
        locked_at: new Date('2026-05-01T09:59:00.000Z'),
      },
      {
        id: 'old-sent',
        status: 'sent',
        updated_at: new Date('2026-05-01T09:00:00.000Z'),
      },
    ]);
    const service = new SkinJournalAnalysisQueueService(
      jobs as never,
      config({ SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER: 'database' }),
    );
    services.push(service);

    const recovered = await service.recoverExpiredLocks();

    expect(recovered).toBe(2);
    expect(jobs.update).toHaveBeenCalledWith(
      { id: expect.objectContaining({ _type: 'in' }) },
      expect.objectContaining({
        status: 'queued',
        locked_at: null,
        locked_by: null,
        run_after: expect.any(Date),
      }),
    );
    expect(jobs.save).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('does not crash local startup when the analysis job table has not been migrated yet', async () => {
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const jobs = repo();
    (jobs as unknown as { manager: { query: jest.Mock } }).manager = {
      query: jest.fn().mockResolvedValue([{ relation: null }]),
    };
    const service = new SkinJournalAnalysisQueueService(
      jobs as never,
      config({ SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER: 'database' }),
    );
    services.push(service);

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    loggerSpy.mockRestore();
    expect(jobs.find).not.toHaveBeenCalled();
  });

  it('fails production startup clearly when the analysis job table is missing', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      const jobs = repo();
      (jobs as unknown as { manager: { query: jest.Mock } }).manager = {
        query: jest.fn().mockResolvedValue([{ relation: null }]),
      };
      const service = new SkinJournalAnalysisQueueService(
        jobs as never,
        config({ SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER: 'database' }),
      );
      services.push(service);

      await expect(service.onModuleInit()).rejects.toThrow(
        'skin_journal_analysis_jobs',
      );
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('fails startup in production when SQS has no redrive policy', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      const jobs = repo();
      const service = new SkinJournalAnalysisQueueService(
        jobs as never,
        config({
          SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER: 'sqs',
          SKIN_JOURNAL_ANALYSIS_SQS_QUEUE_URL:
            'https://sqs.eu-west-1.amazonaws.com/123/skin-journal-analysis',
        }),
      );
      services.push(service);
      (service as unknown as { sqsClient: { send: jest.Mock } }).sqsClient = {
        send: jest.fn().mockResolvedValue({ Attributes: {} }),
      };

      await expect(service.onModuleInit()).rejects.toThrow('dead-letter queue');
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });
});

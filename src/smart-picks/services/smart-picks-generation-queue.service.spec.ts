import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { SmartPickGenerationJob } from '../entities/smart-pick-generation-job.entity';
import { SmartPicksGenerationJobStatus } from '../smart-picks.types';
import { SmartPicksContext } from './smart-picks-context-builder';
import { SmartPicksGenerationQueueService } from './smart-picks-generation-queue.service';

describe('SmartPicksGenerationQueueService', () => {
  afterEach(() => {
    for (const service of servicesForCleanup) {
      service.onModuleDestroy();
    }
    servicesForCleanup.length = 0;
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('queues one product generation job for the current Smart Picks inputs', async () => {
    const jobs = repo<SmartPickGenerationJob>();
    jobs.findOne.mockResolvedValue(null);
    jobs.save.mockImplementation(async (job) => job as SmartPickGenerationJob);
    const service = buildService(jobs);

    await service.enqueueForContext(context(), 4);

    expect(jobs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        mode: 'starter',
        inputs_hash: 'hash-1',
        status: SmartPicksGenerationJobStatus.Queued,
        attempt_count: 0,
        max_attempts: 3,
        locked_at: null,
        locked_by: null,
        last_error: null,
      }),
    );
    expect(jobs.save).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate an active job for the same user, mode, and hash', async () => {
    const activeJob = job({
      status: SmartPicksGenerationJobStatus.Running,
    });
    const jobs = repo<SmartPickGenerationJob>();
    jobs.findOne.mockResolvedValue(activeJob);
    const service = buildService(jobs);

    const queued = await service.enqueueForContext(context(), 2);

    expect(queued).toBe(activeJob);
    expect(jobs.save).not.toHaveBeenCalled();
  });

  it('does not queue work when every visible gap already has a product pick', async () => {
    const jobs = repo<SmartPickGenerationJob>();
    const service = buildService(jobs);

    const queued = await service.enqueueForContext(context(), 0);

    expect(queued).toBeNull();
    expect(jobs.findOne).not.toHaveBeenCalled();
    expect(jobs.save).not.toHaveBeenCalled();
  });

  it('schedules SQS dispatch after enqueuing from the API path without blocking the request', async () => {
    jest.useFakeTimers();
    const jobs = repo<SmartPickGenerationJob>();
    const dueJob = job({ id: 'smart-pick-job-1' });
    jobs.findOne.mockResolvedValue(null);
    jobs.save.mockImplementation(async (value) => ({
      ...dueJob,
      ...(value as SmartPickGenerationJob),
      generateId: jest.fn(),
    }));
    jobs.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
    jobs.find.mockResolvedValue([dueJob]);
    const service = buildService(jobs, {
      SMART_PICKS_QUEUE_DRIVER: 'sqs',
      SMART_PICKS_SQS_QUEUE_URL:
        'https://sqs.eu-north-1.amazonaws.com/123/smart-picks',
    });
    const send = jest.fn().mockResolvedValue({});
    (service as unknown as { sqsClient: { send: jest.Mock } }).sqsClient = {
      send,
    };

    await service.enqueueForContext(context(), 2);

    expect(send).not.toHaveBeenCalled();
    expect(jobs.save).toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(5000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(jobs.update).toHaveBeenCalledWith(
      {
        id: 'smart-pick-job-1',
        status: SmartPicksGenerationJobStatus.Queued,
        run_after: expect.anything(),
      },
      expect.objectContaining({
        status: SmartPicksGenerationJobStatus.Sent,
      }),
    );
  });

  it('wakes SQS dispatch when the matching active job is still queued', async () => {
    jest.useFakeTimers();
    const activeJob = job({
      id: 'smart-pick-job-1',
      status: SmartPicksGenerationJobStatus.Queued,
    });
    const jobs = repo<SmartPickGenerationJob>();
    jobs.findOne.mockResolvedValue(activeJob);
    jobs.find.mockResolvedValue([activeJob]);
    jobs.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
    const service = buildService(jobs, {
      SMART_PICKS_QUEUE_DRIVER: 'sqs',
      SMART_PICKS_SQS_QUEUE_URL:
        'https://sqs.eu-north-1.amazonaws.com/123/smart-picks',
    });
    const send = jest.fn().mockResolvedValue({});
    (service as unknown as { sqsClient: { send: jest.Mock } }).sqsClient = {
      send,
    };

    const queued = await service.enqueueForContext(context(), 2);

    expect(queued).toBe(activeJob);
    expect(jobs.save).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(5000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('dispatches due DB jobs to SQS with only the job id', async () => {
    const jobs = repo<SmartPickGenerationJob>();
    jobs.find.mockResolvedValue([job({ id: 'smart-pick-job-1' })]);
    jobs.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
    const service = buildService(jobs, {
      SMART_PICKS_QUEUE_DRIVER: 'sqs',
      SMART_PICKS_SQS_QUEUE_URL:
        'https://sqs.eu-north-1.amazonaws.com/123/smart-picks',
    });
    const send = jest.fn().mockResolvedValue({});
    (service as unknown as { sqsClient: { send: jest.Mock } }).sqsClient = {
      send,
    };

    await service.dispatchDueJobs();

    const command = send.mock.calls[0]?.[0] as {
      input: { MessageBody: string; QueueUrl: string };
    };
    expect(JSON.parse(command.input.MessageBody)).toEqual({
      job_id: 'smart-pick-job-1',
    });
    expect(command.input.MessageBody).not.toContain('user-1');
    expect(command.input.MessageBody).not.toContain('hash-1');
    expect(jobs.update).toHaveBeenCalledWith(
      {
        id: 'smart-pick-job-1',
        status: SmartPicksGenerationJobStatus.Queued,
        run_after: expect.anything(),
      },
      expect.objectContaining({
        status: SmartPicksGenerationJobStatus.Sent,
        last_error: null,
      }),
    );
  });

  it('keeps the DB job queued when SQS send fails', async () => {
    const jobs = repo<SmartPickGenerationJob>();
    jobs.find.mockResolvedValue([job({ id: 'smart-pick-job-1' })]);
    jobs.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
    const service = buildService(jobs, {
      SMART_PICKS_QUEUE_DRIVER: 'sqs',
      SMART_PICKS_SQS_QUEUE_URL:
        'https://sqs.eu-north-1.amazonaws.com/123/smart-picks',
    });
    (service as unknown as { sqsClient: { send: jest.Mock } }).sqsClient = {
      send: jest.fn().mockRejectedValue(new Error('sqs unavailable')),
    };

    await service.dispatchDueJobs();

    expect(jobs.update).toHaveBeenLastCalledWith(
      {
        id: 'smart-pick-job-1',
        status: SmartPicksGenerationJobStatus.Sent,
      },
      expect.objectContaining({
        status: SmartPicksGenerationJobStatus.Queued,
        last_error: 'sqs unavailable',
      }),
    );
  });

  it('does not overwrite a job another worker already dispatched', async () => {
    const jobs = repo<SmartPickGenerationJob>();
    jobs.find.mockResolvedValue([job({ id: 'smart-pick-job-1' })]);
    jobs.update.mockResolvedValue({ affected: 0, raw: [], generatedMaps: [] });
    const service = buildService(jobs, {
      SMART_PICKS_QUEUE_DRIVER: 'sqs',
      SMART_PICKS_SQS_QUEUE_URL:
        'https://sqs.eu-north-1.amazonaws.com/123/smart-picks',
    });
    const send = jest.fn();
    (service as unknown as { sqsClient: { send: jest.Mock } }).sqsClient = {
      send,
    };

    const sentCount = await service.dispatchDueJobs();

    expect(sentCount).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('does not dispatch a queued job if its run time changed after the read', async () => {
    const jobs = repo<SmartPickGenerationJob>();
    jobs.find.mockResolvedValue([job({ id: 'smart-pick-job-1' })]);
    jobs.update.mockResolvedValue({ affected: 0, raw: [], generatedMaps: [] });
    const service = buildService(jobs, {
      SMART_PICKS_QUEUE_DRIVER: 'sqs',
      SMART_PICKS_SQS_QUEUE_URL:
        'https://sqs.eu-north-1.amazonaws.com/123/smart-picks',
    });
    const send = jest.fn();
    (service as unknown as { sqsClient: { send: jest.Mock } }).sqsClient = {
      send,
    };

    await service.dispatchDueJobs();

    expect(jobs.update).toHaveBeenCalledWith(
      expect.objectContaining({
        run_after: expect.anything(),
      }),
      expect.objectContaining({
        status: SmartPicksGenerationJobStatus.Sent,
      }),
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('parses SQS messages with job ids and deletes malformed messages', async () => {
    const jobs = repo<SmartPickGenerationJob>();
    const service = buildService(jobs, {
      SMART_PICKS_QUEUE_DRIVER: 'sqs',
      SMART_PICKS_SQS_QUEUE_URL:
        'https://sqs.eu-north-1.amazonaws.com/123/smart-picks',
    });
    const send = jest
      .fn()
      .mockResolvedValueOnce({
        Messages: [
          { Body: '{bad-json', ReceiptHandle: 'bad-receipt' },
          {
            Body: JSON.stringify({ job_id: 'smart-pick-job-1' }),
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
      { jobId: 'smart-pick-job-1', receiptHandle: 'good-receipt' },
    ]);
    expect(send.mock.calls[1]?.[0].input).toMatchObject({
      ReceiptHandle: 'bad-receipt',
    });
  });

  it('keeps valid SQS messages when malformed-message cleanup fails', async () => {
    const jobs = repo<SmartPickGenerationJob>();
    const service = buildService(jobs, {
      SMART_PICKS_QUEUE_DRIVER: 'sqs',
      SMART_PICKS_SQS_QUEUE_URL:
        'https://sqs.eu-north-1.amazonaws.com/123/smart-picks',
    });
    const send = jest
      .fn()
      .mockResolvedValueOnce({
        Messages: [
          { Body: '{bad-json', ReceiptHandle: 'bad-receipt' },
          {
            Body: JSON.stringify({ job_id: 'smart-pick-job-1' }),
            ReceiptHandle: 'good-receipt',
          },
        ],
      })
      .mockRejectedValueOnce(new Error('delete unavailable'));
    (service as unknown as { sqsClient: { send: jest.Mock } }).sqsClient = {
      send,
    };

    const messages = await service.receiveMessages();

    expect(messages).toEqual([
      { jobId: 'smart-pick-job-1', receiptHandle: 'good-receipt' },
    ]);
  });

  it('requeues stale running jobs without spending another attempt', async () => {
    const jobs = repo<SmartPickGenerationJob>();
    jobs.find
      .mockResolvedValueOnce([
        job({
          status: SmartPicksGenerationJobStatus.Running,
          attempt_count: 1,
          locked_at: new Date('2026-05-13T09:00:00.000Z'),
        }),
      ])
      .mockResolvedValueOnce([]);
    const service = buildService(jobs);
    const now = new Date('2026-05-13T10:00:00.000Z');

    await service.recoverStaleRunningJobs(now);

    expect(jobs.update).toHaveBeenCalledWith(
      {
        id: 'job-1',
        status: SmartPicksGenerationJobStatus.Running,
        locked_by: 'worker-1',
      },
      expect.objectContaining({
        status: SmartPicksGenerationJobStatus.Queued,
        attempt_count: 1,
        run_after: now,
        locked_at: null,
        locked_by: null,
      }),
    );
  });

  it('fails stale running jobs that already used every attempt', async () => {
    const jobs = repo<SmartPickGenerationJob>();
    jobs.find
      .mockResolvedValueOnce([
        job({
          status: SmartPicksGenerationJobStatus.Running,
          attempt_count: 3,
          max_attempts: 3,
          locked_at: new Date('2026-05-13T09:00:00.000Z'),
        }),
      ])
      .mockResolvedValueOnce([]);
    const service = buildService(jobs);

    await service.recoverStaleRunningJobs(new Date('2026-05-13T10:00:00.000Z'));

    expect(jobs.update).toHaveBeenCalledWith(
      {
        id: 'job-1',
        status: SmartPicksGenerationJobStatus.Running,
        locked_by: 'worker-1',
      },
      expect.objectContaining({
        status: SmartPicksGenerationJobStatus.Failed,
        attempt_count: 3,
      }),
    );
  });

  it('requeues stale sent jobs so a lost SQS message cannot hang forever', async () => {
    const jobs = repo<SmartPickGenerationJob>();
    jobs.find.mockResolvedValueOnce([]).mockResolvedValueOnce([
      job({
        status: SmartPicksGenerationJobStatus.Sent,
        updated_at: new Date('2026-05-13T09:00:00.000Z'),
      }),
    ]);
    const service = buildService(jobs);
    const now = new Date('2026-05-13T10:00:00.000Z');

    await service.recoverStaleRunningJobs(now);

    expect(jobs.update).toHaveBeenCalledWith(
      { id: 'job-1', status: SmartPicksGenerationJobStatus.Sent },
      expect.objectContaining({
        status: SmartPicksGenerationJobStatus.Queued,
        run_after: now,
        locked_at: null,
        locked_by: null,
      }),
    );
  });
});

function repo<T extends object>() {
  return {
    create: jest.fn((value) => value),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function buildService(
  jobs: jest.Mocked<Repository<SmartPickGenerationJob>>,
  values: Record<string, unknown> = {},
): SmartPicksGenerationQueueService {
  const service = new SmartPicksGenerationQueueService(jobs, config(values));
  servicesForCleanup.push(service);
  return service;
}

const servicesForCleanup: SmartPicksGenerationQueueService[] = [];

function config(values: Record<string, unknown> = {}): ConfigService {
  const configValues: Record<string, unknown> = {
    AWS_REGION: 'eu-north-1',
    SMART_PICKS_QUEUE_DRIVER: 'database',
    SMART_PICKS_SQS_QUEUE_URL: '',
    SMART_PICKS_SQS_DLQ_URL: '',
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

function context(
  overrides: Partial<Pick<SmartPicksContext, 'mode' | 'inputsHash'>> = {},
): SmartPicksContext {
  return {
    user: { id: 'user-1' },
    mode: 'starter',
    inputsHash: 'hash-1',
    ...overrides,
  } as SmartPicksContext;
}

function job(
  overrides: Partial<SmartPickGenerationJob> = {},
): SmartPickGenerationJob {
  return {
    id: 'job-1',
    user_id: 'user-1',
    mode: 'starter',
    inputs_hash: 'hash-1',
    status: SmartPicksGenerationJobStatus.Queued,
    attempt_count: 0,
    max_attempts: 3,
    run_after: new Date('2026-05-13T10:00:00.000Z'),
    locked_at: null,
    locked_by: 'worker-1',
    last_error: null,
    ai_model: null,
    ai_input_tokens: null,
    ai_output_tokens: null,
    ai_total_tokens: null,
    ai_estimated_cost_usd: null,
    created_at: new Date('2026-05-13T10:00:00.000Z'),
    updated_at: new Date('2026-05-13T10:00:00.000Z'),
    user: undefined as never,
    generateId: jest.fn(),
    ...overrides,
  };
}

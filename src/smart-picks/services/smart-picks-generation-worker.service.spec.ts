import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { SmartPickGenerationJob } from '../entities/smart-pick-generation-job.entity';
import {
  SmartPicksGenerationJobStatus,
  SmartPicksProductGenerationReason,
  SmartPicksProductGenerationStatus,
} from '../smart-picks.types';
import { SmartPicksOverviewService } from './smart-picks-overview.service';
import {
  SmartPicksGenerationQueueService,
  type SmartPicksQueueMessage,
} from './smart-picks-generation-queue.service';
import { SmartPicksGenerationWorker } from './smart-picks-generation-worker.service';

describe('SmartPicksGenerationWorker', () => {
  const jobs = repo<SmartPickGenerationJob>();
  const users = repo<User>();
  const queue = {
    getDriver: jest.fn().mockReturnValue('database'),
    receiveMessages: jest.fn(),
    dispatchDueJobs: jest.fn(),
    claimJob: jest.fn(),
    claimNextDatabaseJob: jest.fn(),
    deleteMessage: jest.fn(),
    extendMessageVisibility: jest.fn(),
    getVisibilityHeartbeatMs: jest.fn(),
    recoverStaleRunningJobs: jest.fn(),
    scheduleDispatch: jest.fn(),
  } as unknown as jest.Mocked<
    Pick<
      SmartPicksGenerationQueueService,
      | 'getDriver'
      | 'receiveMessages'
      | 'dispatchDueJobs'
      | 'claimJob'
      | 'claimNextDatabaseJob'
      | 'deleteMessage'
      | 'extendMessageVisibility'
      | 'getVisibilityHeartbeatMs'
      | 'recoverStaleRunningJobs'
      | 'scheduleDispatch'
    >
  >;
  const overview = {
    generateProductPicksForJob: jest.fn(),
  } as unknown as jest.Mocked<
    Pick<SmartPicksOverviewService, 'generateProductPicksForJob'>
  >;
  const worker = new SmartPicksGenerationWorker(
    {
      get: jest.fn().mockReturnValue('development'),
    } as unknown as ConfigService,
    queue as unknown as SmartPicksGenerationQueueService,
    jobs,
    users,
    overview as unknown as SmartPicksOverviewService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    queue.getDriver.mockReturnValue('database');
    queue.receiveMessages.mockResolvedValue([]);
    queue.dispatchDueJobs.mockResolvedValue(0);
    queue.claimJob.mockResolvedValue(null);
    queue.claimNextDatabaseJob.mockResolvedValue(job());
    queue.deleteMessage.mockResolvedValue(undefined);
    queue.extendMessageVisibility.mockResolvedValue(undefined);
    queue.getVisibilityHeartbeatMs.mockReturnValue(60_000);
    queue.recoverStaleRunningJobs.mockResolvedValue(undefined);
    queue.scheduleDispatch.mockReturnValue(undefined);
    users.findOne.mockResolvedValue({ id: 'user-1' } as User);
    overview.generateProductPicksForJob.mockResolvedValue({
      status: SmartPicksProductGenerationStatus.Ready,
      reason: null,
      missingPickCount: 0,
      isProcessing: false,
      attemptedAt: null,
      retryAfter: null,
    });
    jobs.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
  });

  it('marks a claimed job complete when product picks are generated', async () => {
    await worker.pollOnce();

    expect(overview.generateProductPicksForJob).toHaveBeenCalledWith(
      { id: 'user-1' },
      'starter',
      'hash-1',
    );
    expect(jobs.update).toHaveBeenCalledWith(
      {
        id: 'job-1',
        status: SmartPicksGenerationJobStatus.Running,
        locked_by: 'worker-1',
      },
      expect.objectContaining({
        status: SmartPicksGenerationJobStatus.Completed,
        last_error: null,
        locked_at: null,
        locked_by: null,
      }),
    );
  });

  it('requeues provider failures until the retry limit is reached', async () => {
    queue.claimNextDatabaseJob.mockResolvedValue(job({ attempt_count: 1 }));
    overview.generateProductPicksForJob.mockResolvedValue({
      status: SmartPicksProductGenerationStatus.Failed,
      reason: SmartPicksProductGenerationReason.ProviderFailed,
      missingPickCount: 2,
      isProcessing: false,
      attemptedAt: '2026-05-13T10:00:00.000Z',
      retryAfter: null,
    });

    await worker.pollOnce();

    expect(jobs.update).toHaveBeenCalledWith(
      {
        id: 'job-1',
        status: SmartPicksGenerationJobStatus.Running,
        locked_by: 'worker-1',
      },
      expect.objectContaining({
        status: SmartPicksGenerationJobStatus.Queued,
        attempt_count: 1,
        last_error: 'provider_failed',
        locked_at: null,
        locked_by: null,
      }),
    );
  });

  it('dead-letters jobs that keep failing', async () => {
    queue.claimNextDatabaseJob.mockResolvedValue(job({ attempt_count: 3 }));
    overview.generateProductPicksForJob.mockResolvedValue({
      status: SmartPicksProductGenerationStatus.Failed,
      reason: SmartPicksProductGenerationReason.NoPick,
      missingPickCount: 1,
      isProcessing: false,
      attemptedAt: '2026-05-13T10:00:00.000Z',
      retryAfter: null,
    });

    await worker.pollOnce();

    expect(jobs.update).toHaveBeenCalledWith(
      {
        id: 'job-1',
        status: SmartPicksGenerationJobStatus.Running,
        locked_by: 'worker-1',
      },
      expect.objectContaining({
        status: SmartPicksGenerationJobStatus.Failed,
        attempt_count: 3,
        last_error: 'no_pick',
      }),
    );
  });

  it('does not retry no-pick outcomes that already passed internal generation retries', async () => {
    queue.claimNextDatabaseJob.mockResolvedValue(job({ attempt_count: 1 }));
    overview.generateProductPicksForJob.mockResolvedValue({
      status: SmartPicksProductGenerationStatus.Failed,
      reason: SmartPicksProductGenerationReason.NoPick,
      missingPickCount: 1,
      isProcessing: false,
      attemptedAt: '2026-05-13T10:00:00.000Z',
      retryAfter: null,
    });

    await worker.pollOnce();

    expect(jobs.update).toHaveBeenCalledWith(
      {
        id: 'job-1',
        status: SmartPicksGenerationJobStatus.Running,
        locked_by: 'worker-1',
      },
      expect.objectContaining({
        status: SmartPicksGenerationJobStatus.Failed,
        attempt_count: 1,
        last_error: 'no_pick',
      }),
    );
  });

  it('does not retry configuration skips that cannot succeed later', async () => {
    queue.claimNextDatabaseJob.mockResolvedValue(job({ attempt_count: 1 }));
    overview.generateProductPicksForJob.mockResolvedValue({
      status: SmartPicksProductGenerationStatus.Skipped,
      reason: SmartPicksProductGenerationReason.MissingApiKey,
      missingPickCount: 1,
      isProcessing: false,
      attemptedAt: '2026-05-13T10:00:00.000Z',
      retryAfter: null,
    });

    await worker.pollOnce();

    expect(jobs.update).toHaveBeenCalledWith(
      {
        id: 'job-1',
        status: SmartPicksGenerationJobStatus.Running,
        locked_by: 'worker-1',
      },
      expect.objectContaining({
        status: SmartPicksGenerationJobStatus.Failed,
        attempt_count: 1,
        last_error: 'missing_api_key',
      }),
    );
  });

  it('recovers stale running jobs before claiming new work', async () => {
    queue.claimNextDatabaseJob.mockResolvedValue(null);

    await worker.pollOnce();

    expect(queue.recoverStaleRunningJobs).toHaveBeenCalled();
    expect(queue.claimNextDatabaseJob).toHaveBeenCalled();
  });

  it('claims SQS jobs by job id and deletes the message only after processing', async () => {
    const message: SmartPicksQueueMessage = {
      jobId: 'job-1',
      receiptHandle: 'receipt-1',
    };
    queue.getDriver.mockReturnValue('sqs');
    queue.receiveMessages.mockResolvedValue([message]);
    queue.claimJob.mockResolvedValue(job());

    await worker.pollOnce();

    expect(queue.claimJob).toHaveBeenCalledWith('job-1', expect.any(String));
    expect(queue.dispatchDueJobs).toHaveBeenCalled();
    expect(overview.generateProductPicksForJob).toHaveBeenCalled();
    expect(queue.deleteMessage).toHaveBeenCalledWith('receipt-1');
  });

  it('leaves SQS messages visible for retry when processing throws', async () => {
    queue.getDriver.mockReturnValue('sqs');
    queue.receiveMessages.mockResolvedValue([
      { jobId: 'job-1', receiptHandle: 'receipt-1' },
    ]);
    queue.claimJob.mockResolvedValue(job());
    overview.generateProductPicksForJob.mockRejectedValueOnce(
      new Error('OpenAI timeout'),
    );

    await worker.pollOnce();

    expect(queue.deleteMessage).not.toHaveBeenCalled();
  });

  it('does not schedule retry dispatch when a stale worker no longer owns the job', async () => {
    jobs.update.mockResolvedValueOnce({
      affected: 0,
      raw: [],
      generatedMaps: [],
    });
    overview.generateProductPicksForJob.mockResolvedValue({
      status: SmartPicksProductGenerationStatus.Failed,
      reason: SmartPicksProductGenerationReason.ProviderFailed,
      missingPickCount: 1,
      isProcessing: false,
      attemptedAt: '2026-05-13T10:00:00.000Z',
      retryAfter: null,
    });

    await worker.pollOnce();

    expect(queue.scheduleDispatch).not.toHaveBeenCalled();
  });

  it('keeps the standalone worker process alive with a referenced poll timer', () => {
    const unref = jest.fn();
    const fakeTimer = { unref } as unknown as ReturnType<typeof setTimeout>;
    const setTimeoutMock = ((..._args: Parameters<typeof setTimeout>) =>
      fakeTimer) as unknown as typeof setTimeout;
    const setTimeoutSpy = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation(setTimeoutMock);
    const workerWithTimer = new SmartPicksGenerationWorker(
      {
        get: jest.fn().mockReturnValue('development'),
      } as unknown as ConfigService,
      queue as unknown as SmartPicksGenerationQueueService,
      jobs,
      users,
      overview as unknown as SmartPicksOverviewService,
    );

    try {
      workerWithTimer.onModuleInit();

      expect(setTimeoutSpy).toHaveBeenCalled();
      expect(unref).not.toHaveBeenCalled();
    } finally {
      workerWithTimer.onModuleDestroy();
      setTimeoutSpy.mockRestore();
    }
  });
});

function repo<T extends object>() {
  return {
    createQueryBuilder: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function job(
  overrides: Partial<SmartPickGenerationJob> = {},
): SmartPickGenerationJob {
  return {
    id: 'job-1',
    user_id: 'user-1',
    mode: 'starter',
    inputs_hash: 'hash-1',
    status: SmartPicksGenerationJobStatus.Running,
    attempt_count: 1,
    max_attempts: 3,
    run_after: new Date('2026-05-13T10:00:00.000Z'),
    locked_at: new Date('2026-05-13T10:00:00.000Z'),
    locked_by: 'worker-1',
    last_error: null,
    created_at: new Date('2026-05-13T10:00:00.000Z'),
    updated_at: new Date('2026-05-13T10:00:00.000Z'),
    user: undefined as never,
    generateId: jest.fn(),
    ...overrides,
  };
}

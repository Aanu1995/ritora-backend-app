import { ConfigService } from '@nestjs/config';
import {
  IngredientProductAnalysisJob,
  IngredientProductAnalysisJobStatus,
} from './entities/ingredient-product-analysis-job.entity';
import { IngredientProductAnalysisQueueService } from './ingredient-product-analysis-queue.service';
import { IngredientProductAnalysisSnapshotService } from './ingredient-product-analysis-snapshot.service';
import { IngredientProductAnalysisWorkerService } from './ingredient-product-analysis-worker.service';

function job(
  overrides: Partial<IngredientProductAnalysisJob> = {},
): IngredientProductAnalysisJob {
  return Object.assign(new IngredientProductAnalysisJob(), {
    id: 'job-1',
    user_id: 'user-1',
    product_id: 'product-1',
    language: 'en',
    with_explanations: false,
    inci_hash: 'hash-1',
    product_updated_at: new Date('2026-05-23T00:00:00.000Z'),
    status: IngredientProductAnalysisJobStatus.Running,
    attempt_count: 1,
    max_attempts: 3,
    run_after: new Date('2026-05-23T00:00:00.000Z'),
    locked_at: new Date('2026-05-23T00:00:00.000Z'),
    locked_by: 'worker-1',
    last_error: null,
    completed_at: null,
    ...overrides,
  });
}

describe('IngredientProductAnalysisWorkerService', () => {
  const originalSetTimeout = global.setTimeout;
  const queue = {
    getDriver: jest.fn(),
    dispatchDueJobs: jest.fn(),
    receiveMessages: jest.fn(),
    claimJob: jest.fn(),
    recoverStaleRunningJobs: jest.fn(),
    claimNextJob: jest.fn(),
    deleteMessage: jest.fn(),
    extendMessageVisibility: jest.fn(),
    getVisibilityHeartbeatMs: jest.fn(),
    completeJob: jest.fn(),
    retryOrFailJob: jest.fn(),
  };
  const snapshots = {
    analyzeFocusProductForUser: jest.fn(),
  };
  let worker: IngredientProductAnalysisWorkerService;

  beforeEach(() => {
    jest.clearAllMocks();
    queue.getDriver.mockReturnValue('database');
    queue.dispatchDueJobs.mockResolvedValue(0);
    queue.receiveMessages.mockResolvedValue([]);
    queue.claimJob.mockResolvedValue(null);
    queue.recoverStaleRunningJobs.mockResolvedValue(undefined);
    queue.claimNextJob.mockResolvedValue(job());
    queue.deleteMessage.mockResolvedValue(undefined);
    queue.extendMessageVisibility.mockResolvedValue(undefined);
    queue.getVisibilityHeartbeatMs.mockReturnValue(60_000);
    queue.completeJob.mockResolvedValue(undefined);
    queue.retryOrFailJob.mockResolvedValue(undefined);
    snapshots.analyzeFocusProductForUser.mockResolvedValue({ status: 'ok' });
    worker = new IngredientProductAnalysisWorkerService(
      {
        get: jest.fn().mockReturnValue('development'),
      } as unknown as ConfigService,
      queue as unknown as IngredientProductAnalysisQueueService,
      snapshots as unknown as IngredientProductAnalysisSnapshotService,
    );
  });

  afterEach(() => {
    worker.onModuleDestroy();
    jest.restoreAllMocks();
  });

  it('processes one claimed job and marks it complete', async () => {
    await worker.pollOnce();

    expect(queue.recoverStaleRunningJobs).toHaveBeenCalled();
    expect(queue.claimNextJob).toHaveBeenCalledWith(expect.any(String));
    expect(snapshots.analyzeFocusProductForUser).toHaveBeenCalledWith(
      'user-1',
      'product-1',
      'en',
      false,
    );
    expect(queue.completeJob).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'job-1' }),
    );
    expect(queue.retryOrFailJob).not.toHaveBeenCalled();
  });

  it('retries a job when snapshot analysis fails', async () => {
    const claimedJob = job({ attempt_count: 1 });
    queue.claimNextJob.mockResolvedValue(claimedJob);
    snapshots.analyzeFocusProductForUser.mockRejectedValue(
      new Error('OpenAI timeout'),
    );

    await worker.pollOnce();

    expect(queue.completeJob).not.toHaveBeenCalled();
    expect(queue.retryOrFailJob).toHaveBeenCalledWith(
      claimedJob,
      'OpenAI timeout',
    );
  });

  it('does nothing when no queued job is available', async () => {
    queue.claimNextJob.mockResolvedValue(null);

    await worker.pollOnce();

    expect(snapshots.analyzeFocusProductForUser).not.toHaveBeenCalled();
    expect(queue.completeJob).not.toHaveBeenCalled();
  });

  it('does not run overlapping polls', async () => {
    let resolveAnalysis: () => void = () => undefined;
    snapshots.analyzeFocusProductForUser.mockReturnValue(
      new Promise((resolve) => {
        resolveAnalysis = () => resolve({ status: 'ok' });
      }),
    );

    const firstPoll = worker.pollOnce();
    await worker.pollOnce();
    resolveAnalysis();
    await firstPoll;

    expect(queue.claimNextJob).toHaveBeenCalledTimes(1);
  });

  it('keeps the main poll timer referenced so the standalone worker process stays alive', () => {
    const unrefSpies: jest.SpyInstance[] = [];
    jest.spyOn(global, 'setTimeout').mockImplementation(() => {
      const timer = originalSetTimeout(() => undefined, 60_000);
      unrefSpies.push(jest.spyOn(timer, 'unref'));
      return timer;
    });

    worker.onModuleInit();

    expect(unrefSpies).toHaveLength(1);
    expect(unrefSpies[0]).not.toHaveBeenCalled();
  });

  it('claims SQS jobs by id and deletes the message only after processing', async () => {
    queue.getDriver.mockReturnValue('sqs');
    queue.receiveMessages.mockResolvedValue([
      { jobId: 'job-1', receiptHandle: 'receipt-1' },
    ]);
    queue.claimJob.mockResolvedValue(job());

    await worker.pollOnce();

    expect(queue.dispatchDueJobs).toHaveBeenCalled();
    expect(queue.claimJob).toHaveBeenCalledWith('job-1', expect.any(String));
    expect(snapshots.analyzeFocusProductForUser).toHaveBeenCalled();
    expect(queue.deleteMessage).toHaveBeenCalledWith('receipt-1');
  });

  it('leaves SQS messages visible for retry when processing throws', async () => {
    queue.getDriver.mockReturnValue('sqs');
    queue.receiveMessages.mockResolvedValue([
      { jobId: 'job-1', receiptHandle: 'receipt-1' },
    ]);
    queue.claimJob.mockResolvedValue(job());
    snapshots.analyzeFocusProductForUser.mockRejectedValue(
      new Error('OpenAI timeout'),
    );

    await worker.pollOnce();

    expect(queue.retryOrFailJob).toHaveBeenCalled();
    expect(queue.deleteMessage).not.toHaveBeenCalled();
  });
});

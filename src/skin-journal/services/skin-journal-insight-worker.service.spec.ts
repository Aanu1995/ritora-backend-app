import { SkinJournalService } from '../skin-journal.service';
import { SkinJournalInsightQueueService } from './skin-journal-insight-queue.service';
import { SkinJournalInsightWorkerService } from './skin-journal-insight-worker.service';

describe('SkinJournalInsightWorkerService', () => {
  const queue = {
    getDriver: jest.fn(() => 'database'),
    receiveMessages: jest.fn(),
    claimJob: jest.fn(),
    claimNextDatabaseJob: jest.fn(),
    deleteMessage: jest.fn(),
    extendMessageVisibility: jest.fn(),
  };
  const journal = {
    processInsightJob: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    queue.getDriver.mockReturnValue('database');
    queue.receiveMessages.mockResolvedValue([]);
    queue.claimJob.mockResolvedValue(null);
    queue.claimNextDatabaseJob.mockResolvedValue(null);
    queue.deleteMessage.mockResolvedValue(undefined);
    queue.extendMessageVisibility.mockResolvedValue(undefined);
    journal.processInsightJob.mockResolvedValue(undefined);
  });

  it('processes one due database job without user request involvement', async () => {
    const job = { id: 'insight-job-1' };
    queue.claimNextDatabaseJob.mockResolvedValue(job);
    const worker = new SkinJournalInsightWorkerService(
      queue as unknown as SkinJournalInsightQueueService,
      journal as unknown as SkinJournalService,
    );

    await worker.pollOnce();

    expect(journal.processInsightJob).toHaveBeenCalledWith(job);
  });

  it('claims SQS messages and deletes them only after processing', async () => {
    const job = { id: 'insight-job-1' };
    queue.getDriver.mockReturnValue('sqs');
    queue.receiveMessages.mockResolvedValue([
      { jobId: 'insight-job-1', receiptHandle: 'receipt-1' },
    ]);
    queue.claimJob.mockResolvedValue(job);
    const worker = new SkinJournalInsightWorkerService(
      queue as unknown as SkinJournalInsightQueueService,
      journal as unknown as SkinJournalService,
    );

    await worker.pollOnce();

    expect(queue.claimJob).toHaveBeenCalledWith(
      'insight-job-1',
      expect.stringMatching(/^skin-journal-insight-/),
    );
    expect(journal.processInsightJob).toHaveBeenCalledWith(job);
    expect(queue.deleteMessage).toHaveBeenCalledWith('receipt-1');
  });

  it('extends SQS visibility while a long insight generation is running', async () => {
    jest.useFakeTimers();
    queue.getDriver.mockReturnValue('sqs');
    queue.receiveMessages.mockResolvedValue([
      { jobId: 'insight-job-1', receiptHandle: 'receipt-1' },
    ]);
    queue.claimJob.mockResolvedValue({ id: 'insight-job-1' });
    journal.processInsightJob.mockReturnValue(
      new Promise((resolve) => setTimeout(resolve, 46000)),
    );
    const worker = new SkinJournalInsightWorkerService(
      queue as unknown as SkinJournalInsightQueueService,
      journal as unknown as SkinJournalService,
    );

    const poll = worker.pollOnce();
    await Promise.resolve();
    jest.advanceTimersByTime(45000);
    await Promise.resolve();
    jest.advanceTimersByTime(1000);
    await poll;

    expect(queue.extendMessageVisibility).toHaveBeenCalledWith('receipt-1');
    jest.useRealTimers();
  });

  it('does not schedule another poll after shutdown while a poll is in flight', async () => {
    jest.useFakeTimers();
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    let resolveClaim!: (job: null) => void;
    queue.getDriver.mockReturnValue('database');
    queue.claimNextDatabaseJob.mockReturnValue(
      new Promise<null>((resolve) => {
        resolveClaim = resolve;
      }),
    );
    const worker = new SkinJournalInsightWorkerService(
      queue as unknown as SkinJournalInsightQueueService,
      journal as unknown as SkinJournalService,
    );

    try {
      worker.onModuleInit();
      await jest.advanceTimersByTimeAsync(1);

      expect(queue.claimNextDatabaseJob).toHaveBeenCalledTimes(1);

      worker.onModuleDestroy();
      resolveClaim(null);
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(6000);

      expect(queue.claimNextDatabaseJob).toHaveBeenCalledTimes(1);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      jest.useRealTimers();
    }
  });

  it('keeps the standalone worker process alive with a referenced poll timer', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const unref = jest.fn();
    const fakeTimer = { unref } as unknown as ReturnType<typeof setTimeout>;
    const setTimeoutMock = ((..._args: Parameters<typeof setTimeout>) =>
      fakeTimer) as unknown as typeof setTimeout;
    const setTimeoutSpy = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation(setTimeoutMock);
    const worker = new SkinJournalInsightWorkerService(
      queue as unknown as SkinJournalInsightQueueService,
      journal as unknown as SkinJournalService,
    );

    try {
      worker.onModuleInit();

      expect(setTimeoutSpy).toHaveBeenCalled();
      expect(unref).not.toHaveBeenCalled();
    } finally {
      worker.onModuleDestroy();
      setTimeoutSpy.mockRestore();
      process.env.NODE_ENV = previousNodeEnv;
    }
  });
});

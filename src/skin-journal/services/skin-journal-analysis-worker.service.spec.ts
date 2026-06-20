import '../../test-globals.setup';
import { SkinJournalService } from '../skin-journal.service';
import { SkinJournalAnalysisQueueService } from './skin-journal-analysis-queue.service';
import { SkinJournalAnalysisWorkerService } from './skin-journal-analysis-worker.service';

describe('SkinJournalAnalysisWorkerService', () => {
  const queue = {
    getDriver: jest.fn(),
    receiveMessages: jest.fn(),
    claimJob: jest.fn(),
    claimNextDatabaseJob: jest.fn(),
    deleteMessage: jest.fn(),
    extendMessageVisibility: jest.fn(),
  };
  const journal = {
    processAnalysisJob: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    queue.deleteMessage.mockResolvedValue(undefined);
    queue.extendMessageVisibility.mockResolvedValue(undefined);
    journal.processAnalysisJob.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('claims SQS jobs by job id and deletes the message only after processing', async () => {
    const job = {
      id: 'analysis-job-1',
      status: 'running',
      user_id: 'user-1',
      entry_id: 'entry-1',
      photo_object_key: 'skin-journal/user-1/entry-1/photo.webp',
    };
    queue.getDriver.mockReturnValue('sqs');
    queue.receiveMessages.mockResolvedValue([
      { jobId: 'analysis-job-1', receiptHandle: 'receipt-1' },
    ]);
    queue.claimJob.mockResolvedValue(job);
    const worker = new SkinJournalAnalysisWorkerService(
      queue as unknown as SkinJournalAnalysisQueueService,
      journal as unknown as SkinJournalService,
    );

    await worker.pollOnce();

    expect(queue.claimJob).toHaveBeenCalledWith(
      'analysis-job-1',
      expect.stringMatching(/^skin-journal-analysis-/),
    );
    expect(journal.processAnalysisJob).toHaveBeenCalledWith(job);
    expect(queue.deleteMessage).toHaveBeenCalledWith('receipt-1');
  });

  it('processes database fallback jobs without SQS', async () => {
    const job = {
      id: 'analysis-job-1',
      status: 'running',
      user_id: 'user-1',
      entry_id: 'entry-1',
      photo_object_key: 'skin-journal/user-1/entry-1/photo.webp',
    };
    queue.getDriver.mockReturnValue('database');
    queue.claimNextDatabaseJob.mockResolvedValue(job);
    const worker = new SkinJournalAnalysisWorkerService(
      queue as unknown as SkinJournalAnalysisQueueService,
      journal as unknown as SkinJournalService,
    );

    await worker.pollOnce();

    expect(queue.receiveMessages).not.toHaveBeenCalled();
    expect(journal.processAnalysisJob).toHaveBeenCalledWith(job);
  });

  it('extends SQS visibility while a long-running analysis is processing', async () => {
    jest.useFakeTimers();
    const job = {
      id: 'analysis-job-1',
      status: 'running',
      user_id: 'user-1',
      entry_id: 'entry-1',
      photo_object_key: 'skin-journal/user-1/entry-1/photo.webp',
    };
    queue.getDriver.mockReturnValue('sqs');
    queue.receiveMessages.mockResolvedValue([
      { jobId: 'analysis-job-1', receiptHandle: 'receipt-1' },
    ]);
    queue.claimJob.mockResolvedValue(job);
    journal.processAnalysisJob.mockReturnValue(
      new Promise((resolve) => {
        setTimeout(resolve, 70000);
      }),
    );
    const worker = new SkinJournalAnalysisWorkerService(
      queue as unknown as SkinJournalAnalysisQueueService,
      journal as unknown as SkinJournalService,
    );

    const poll = worker.pollOnce();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(60000);
    await jest.advanceTimersByTimeAsync(10000);
    await poll;

    expect(queue.extendMessageVisibility).toHaveBeenCalledWith('receipt-1');
    expect(queue.deleteMessage).toHaveBeenCalledWith('receipt-1');
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
    const worker = new SkinJournalAnalysisWorkerService(
      queue as unknown as SkinJournalAnalysisQueueService,
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
    const worker = new SkinJournalAnalysisWorkerService(
      queue as unknown as SkinJournalAnalysisQueueService,
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

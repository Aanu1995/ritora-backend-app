import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AccountDeletionSchedulerService } from './account-deletion-scheduler.service';
import { AccountDeletionFinalizationDriver } from './account-deletion.types';
import { AccountDeletionWorkerService } from './account-deletion-worker.service';

describe('AccountDeletionWorkerService', () => {
  const makeWorker = (
    driver: AccountDeletionFinalizationDriver,
    authOverrides: Partial<Record<keyof AuthService, jest.Mock>> = {},
    schedulerOverrides: Partial<
      Record<keyof AccountDeletionSchedulerService, jest.Mock>
    > = {},
    nodeEnv = 'production',
  ): {
    worker: AccountDeletionWorkerService;
    authService: Record<string, jest.Mock>;
    scheduler: Record<string, jest.Mock>;
  } => {
    const config = {
      get: jest.fn((key: string) => (key === 'NODE_ENV' ? nodeEnv : null)),
    } as unknown as ConfigService;
    const authService = {
      processDueAccountDeletions: jest.fn().mockResolvedValue(0),
      processScheduledAccountDeletion: jest.fn().mockResolvedValue(false),
      clearExpiredAccountDeletionCancellationReceipts: jest
        .fn()
        .mockResolvedValue(0),
      ...authOverrides,
    };
    const scheduler = {
      getDriver: jest.fn().mockReturnValue(driver),
      receiveMessages: jest.fn().mockResolvedValue([]),
      deleteMessage: jest.fn().mockResolvedValue(undefined),
      extendMessageVisibility: jest.fn().mockResolvedValue(undefined),
      ...schedulerOverrides,
    };

    return {
      worker: new AccountDeletionWorkerService(
        config,
        authService as unknown as AuthService,
        scheduler as unknown as AccountDeletionSchedulerService,
      ),
      authService,
      scheduler,
    };
  };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('processes scheduler SQS messages and deletes them after idempotent handling', async () => {
    const scheduledFor = new Date('2026-05-14T12:00:00.000Z');
    const { worker, authService, scheduler } = makeWorker(
      AccountDeletionFinalizationDriver.EventBridgeSqs,
      {},
      {
        receiveMessages: jest.fn().mockResolvedValue([
          {
            userId: '01USER',
            scheduledFor,
            receiptHandle: 'receipt-1',
          },
        ]),
      },
    );

    await worker.pollOnce();

    expect(authService.processScheduledAccountDeletion).toHaveBeenCalledWith(
      '01USER',
      scheduledFor,
    );
    expect(scheduler.deleteMessage).toHaveBeenCalledWith('receipt-1');
    expect(authService.processDueAccountDeletions).not.toHaveBeenCalled();
    expect(
      authService.clearExpiredAccountDeletionCancellationReceipts,
    ).toHaveBeenCalled();
  });

  it('keeps early SQS messages for retry instead of deleting them', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-13T11:59:59.999Z'));
    const scheduledFor = new Date('2026-06-13T12:00:00.000Z');
    const { worker, authService, scheduler } = makeWorker(
      AccountDeletionFinalizationDriver.EventBridgeSqs,
      {},
      {
        receiveMessages: jest.fn().mockResolvedValue([
          {
            userId: '01USER',
            scheduledFor,
            receiptHandle: 'receipt-1',
          },
        ]),
      },
    );

    await worker.pollOnce();

    expect(authService.processScheduledAccountDeletion).not.toHaveBeenCalled();
    expect(scheduler.deleteMessage).not.toHaveBeenCalled();
  });

  it('does not delete an SQS message when finalization processing fails', async () => {
    const { worker, scheduler } = makeWorker(
      AccountDeletionFinalizationDriver.EventBridgeSqs,
      {
        processScheduledAccountDeletion: jest
          .fn()
          .mockRejectedValue(new Error('database unavailable')),
      },
      {
        receiveMessages: jest.fn().mockResolvedValue([
          {
            userId: '01USER',
            scheduledFor: new Date('2026-05-14T12:00:00.000Z'),
            receiptHandle: 'receipt-1',
          },
        ]),
      },
    );

    await worker.pollOnce();

    expect(scheduler.deleteMessage).not.toHaveBeenCalled();
  });

  it('skips overlapping poll attempts', async () => {
    let resolveReceiveMessages: (value: []) => void = () => undefined;
    const receiveMessages = jest.fn(
      () =>
        new Promise<[]>((resolve) => {
          resolveReceiveMessages = resolve;
        }),
    );
    const { worker } = makeWorker(
      AccountDeletionFinalizationDriver.EventBridgeSqs,
      {},
      { receiveMessages },
    );

    const firstPoll = worker.pollOnce();
    const secondPoll = worker.pollOnce();

    expect(receiveMessages).toHaveBeenCalledTimes(1);

    await secondPoll;
    resolveReceiveMessages([]);
    await firstPoll;
  });

  it('extends SQS visibility while finalization is still running', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-13T12:00:01.000Z'));
    let resolveFinalization: (value: boolean) => void = () => undefined;
    const processScheduledAccountDeletion = jest.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveFinalization = resolve;
        }),
    );
    const { worker, scheduler } = makeWorker(
      AccountDeletionFinalizationDriver.EventBridgeSqs,
      { processScheduledAccountDeletion },
      {
        receiveMessages: jest.fn().mockResolvedValue([
          {
            userId: '01USER',
            scheduledFor: new Date('2026-06-13T12:00:00.000Z'),
            receiptHandle: 'receipt-1',
          },
        ]),
        extendMessageVisibility: jest.fn().mockRejectedValue(new Error('sqs')),
      },
    );

    const poll = worker.pollOnce();
    await Promise.resolve();
    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(120_000);
    expect(scheduler.extendMessageVisibility).toHaveBeenCalledWith('receipt-1');

    resolveFinalization(true);
    await poll;

    await jest.advanceTimersByTimeAsync(120_000);
    expect(scheduler.extendMessageVisibility).toHaveBeenCalledTimes(1);
  });

  it('falls back to database due-account processing for local database driver', async () => {
    const { worker, authService, scheduler } = makeWorker(
      AccountDeletionFinalizationDriver.Database,
      { processDueAccountDeletions: jest.fn().mockResolvedValue(2) },
    );

    await worker.pollOnce();

    expect(authService.processDueAccountDeletions).toHaveBeenCalled();
    expect(
      authService.clearExpiredAccountDeletionCancellationReceipts,
    ).toHaveBeenCalled();
    expect(scheduler.receiveMessages).not.toHaveBeenCalled();
  });

  it('does not fail the poll when cancellation receipt cleanup fails', async () => {
    const { worker, authService } = makeWorker(
      AccountDeletionFinalizationDriver.Database,
      {
        clearExpiredAccountDeletionCancellationReceipts: jest
          .fn()
          .mockRejectedValue(new Error('database unavailable')),
      },
    );

    await expect(worker.pollOnce()).resolves.toBeUndefined();

    expect(authService.processDueAccountDeletions).toHaveBeenCalled();
    expect(
      authService.clearExpiredAccountDeletionCancellationReceipts,
    ).toHaveBeenCalled();
  });

  it('throttles cancellation receipt cleanup between frequent polls', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-15T12:00:00.000Z'));
    const { worker, authService } = makeWorker(
      AccountDeletionFinalizationDriver.EventBridgeSqs,
    );

    await worker.pollOnce();
    await worker.pollOnce();

    expect(
      authService.clearExpiredAccountDeletionCancellationReceipts,
    ).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date('2026-05-15T13:00:00.000Z'));
    await worker.pollOnce();

    expect(
      authService.clearExpiredAccountDeletionCancellationReceipts,
    ).toHaveBeenCalledTimes(2);
  });

  it('starts scheduled polling outside test and stops the timer on destroy', async () => {
    jest.useFakeTimers();
    const { worker, authService } = makeWorker(
      AccountDeletionFinalizationDriver.Database,
    );

    worker.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(authService.processDueAccountDeletions).toHaveBeenCalledTimes(1);

    worker.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(authService.processDueAccountDeletions).toHaveBeenCalledTimes(1);
  });

  it('continues scheduled polling after a transient poll failure', async () => {
    jest.useFakeTimers();
    const processDueAccountDeletions = jest
      .fn()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValue(0);
    const { worker } = makeWorker(AccountDeletionFinalizationDriver.Database, {
      processDueAccountDeletions,
    });

    worker.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(processDueAccountDeletions).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(60_000);
    expect(processDueAccountDeletions).toHaveBeenCalledTimes(2);
    worker.onModuleDestroy();
  });

  it('backs off after an immediate SQS polling failure', async () => {
    jest.useFakeTimers();
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const receiveMessages = jest
      .fn()
      .mockRejectedValueOnce(new Error('sqs unavailable'))
      .mockResolvedValue([]);
    const { worker } = makeWorker(
      AccountDeletionFinalizationDriver.EventBridgeSqs,
      {},
      { receiveMessages },
    );

    worker.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(receiveMessages).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(999);
    expect(receiveMessages).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1);
    expect(receiveMessages).toHaveBeenCalledTimes(2);
    worker.onModuleDestroy();
  });

  it('does not start scheduled polling in test', async () => {
    jest.useFakeTimers();
    const { worker, authService } = makeWorker(
      AccountDeletionFinalizationDriver.Database,
      {},
      {},
      'test',
    );

    worker.onModuleInit();
    await jest.advanceTimersByTimeAsync(60_000);

    expect(authService.processDueAccountDeletions).not.toHaveBeenCalled();
  });
});

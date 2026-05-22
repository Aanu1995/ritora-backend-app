import { ConfigService } from '@nestjs/config';
import { AdminAccountMonitoringSeverity } from './entities/admin-account-monitoring-flag.entity';
import { AdminOperationalIncidentSeverity } from './entities/admin-operational-incident.entity';
import {
  AdminAccountMonitoringQueueDriver,
  AdminAccountMonitoringQueueMessageType,
  AdminAccountMonitoringQueueService,
} from './admin-account-monitoring-queue.service';
import { AdminAccountMonitoringWorkerService } from './admin-account-monitoring-worker.service';
import {
  ACCOUNT_MONITORING_SCAN_SESSION_ID,
  AdminService,
} from './admin.service';

function makeWorker() {
  const config = {
    get: jest.fn((key: string) => (key === 'NODE_ENV' ? 'production' : null)),
  } as unknown as ConfigService;
  const queue = {
    deleteMessage: jest.fn(async () => undefined),
    extendMessageVisibility: jest.fn(async () => undefined),
    getDriver: jest.fn(() => AdminAccountMonitoringQueueDriver.Sqs),
    isReady: jest.fn(() => true),
    receiveMessages: jest.fn(async () => [
      {
        receiptHandle: 'receipt-1',
        triggeredAt: new Date('2026-05-22T09:00:00.000Z'),
        type: AdminAccountMonitoringQueueMessageType.AutomatedScan,
      },
    ]),
  } as unknown as AdminAccountMonitoringQueueService;
  const adminService = {
    createScheduledAccountMonitoringOperationalIncident: jest.fn(async () => ({
      id: 'incident-1',
    })),
    createScheduledAccountMonitoringSupportEvent: jest.fn(async () => ({
      id: 'flag-support-1',
    })),
    runScheduledAccountMonitoringScan: jest.fn(async () => ({
      candidates: 0,
    })),
  } as unknown as AdminService;

  return {
    adminService,
    queue,
    worker: new AdminAccountMonitoringWorkerService(
      config,
      queue,
      adminService,
    ),
  };
}

describe('AdminAccountMonitoringWorkerService', () => {
  it('runs scheduled monitoring scans from SQS messages and deletes processed receipts', async () => {
    const { adminService, queue, worker } = makeWorker();

    await worker.pollOnce();

    expect(queue.receiveMessages).toHaveBeenCalledTimes(1);
    expect(adminService.runScheduledAccountMonitoringScan).toHaveBeenCalledWith(
      {
        sessionId: ACCOUNT_MONITORING_SCAN_SESSION_ID,
        userAgent: 'ritora-account-monitoring-sqs-worker/1.0',
      },
    );
    expect(queue.deleteMessage).toHaveBeenCalledWith('receipt-1');
  });

  it('coalesces queued scheduled scan messages into one database scan', async () => {
    const { adminService, queue, worker } = makeWorker();
    (queue.receiveMessages as jest.Mock).mockResolvedValueOnce([
      {
        receiptHandle: 'receipt-1',
        triggeredAt: new Date('2026-05-22T09:00:00.000Z'),
        type: AdminAccountMonitoringQueueMessageType.AutomatedScan,
      },
      {
        receiptHandle: 'receipt-2',
        triggeredAt: new Date('2026-05-22T09:05:00.000Z'),
        type: AdminAccountMonitoringQueueMessageType.AutomatedScan,
      },
    ]);

    await worker.pollOnce();

    expect(
      adminService.runScheduledAccountMonitoringScan,
    ).toHaveBeenCalledTimes(1);
    expect(queue.deleteMessage).toHaveBeenCalledWith('receipt-1');
    expect(queue.deleteMessage).toHaveBeenCalledWith('receipt-2');
  });

  it('processes queued support escalation messages without running a scan', async () => {
    const { adminService, queue, worker } = makeWorker();
    (queue.receiveMessages as jest.Mock).mockResolvedValueOnce([
      {
        internalNote: 'Support team escalated repeated user reports.',
        latestSignal: 'Support thread SUP-123 was escalated.',
        reason: 'Support escalation received from account monitoring queue',
        receiptHandle: 'receipt-support-1',
        severity: AdminAccountMonitoringSeverity.Warning,
        summary: 'Support escalation received',
        supportReference: 'SUP-123',
        triggeredAt: new Date('2026-05-22T09:10:00.000Z'),
        type: AdminAccountMonitoringQueueMessageType.SupportEscalation,
        userIdentifier: 'user@example.com',
      },
    ]);

    await worker.pollOnce();

    expect(
      adminService.runScheduledAccountMonitoringScan,
    ).not.toHaveBeenCalled();
    expect(
      adminService.createScheduledAccountMonitoringSupportEvent,
    ).toHaveBeenCalledWith({
      internalNote: 'Support team escalated repeated user reports.',
      latestSignal: 'Support thread SUP-123 was escalated.',
      reason: 'Support escalation received from account monitoring queue',
      severity: AdminAccountMonitoringSeverity.Warning,
      summary: 'Support escalation received',
      supportReference: 'SUP-123',
      userIdentifier: 'user@example.com',
    });
    expect(queue.deleteMessage).toHaveBeenCalledWith('receipt-support-1');
  });

  it('processes queued operational incident messages without running a scan', async () => {
    const { adminService, queue, worker } = makeWorker();
    (queue.receiveMessages as jest.Mock).mockResolvedValueOnce([
      {
        description: 'CloudWatch reported elevated media provider failures.',
        receiptHandle: 'receipt-incident-1',
        severity: AdminOperationalIncidentSeverity.Critical,
        sourceId: 'cloudwatch:media-provider-errors',
        sourceType: 'aws:cloudwatch-alarm',
        title: 'Media provider errors elevated',
        triggeredAt: new Date('2026-05-22T09:20:00.000Z'),
        type: AdminAccountMonitoringQueueMessageType.OperationalIncident,
      },
    ]);

    await worker.pollOnce();

    expect(
      adminService.runScheduledAccountMonitoringScan,
    ).not.toHaveBeenCalled();
    expect(
      adminService.createScheduledAccountMonitoringOperationalIncident,
    ).toHaveBeenCalledWith({
      description: 'CloudWatch reported elevated media provider failures.',
      severity: AdminOperationalIncidentSeverity.Critical,
      sourceId: 'cloudwatch:media-provider-errors',
      sourceType: 'aws:cloudwatch-alarm',
      title: 'Media provider errors elevated',
    });
    expect(queue.deleteMessage).toHaveBeenCalledWith('receipt-incident-1');
  });

  it('does not run overlapping polls', async () => {
    const { queue, worker } = makeWorker();
    let releasePoll = (): void => undefined;
    (queue.receiveMessages as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releasePoll = () => resolve([]);
        }),
    );

    const firstPoll = worker.pollOnce();
    await worker.pollOnce();
    releasePoll();
    await firstPoll;

    expect(queue.receiveMessages).toHaveBeenCalledTimes(1);
  });

  it('does not start polling when SQS driver is selected without a ready queue', () => {
    jest.useFakeTimers();
    const { queue, worker } = makeWorker();
    (queue.isReady as jest.Mock).mockReturnValue(false);

    try {
      worker.onModuleInit();
      jest.advanceTimersByTime(1);

      expect(queue.receiveMessages).not.toHaveBeenCalled();
    } finally {
      worker.onModuleDestroy();
      jest.useRealTimers();
    }
  });
});

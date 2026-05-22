import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs';
import { ConfigService } from '@nestjs/config';
import { AdminAccountMonitoringSeverity } from './entities/admin-account-monitoring-flag.entity';
import { AdminOperationalIncidentSeverity } from './entities/admin-operational-incident.entity';
import {
  AdminAccountMonitoringQueueDriver,
  AdminAccountMonitoringQueueMessageType,
  AdminAccountMonitoringQueueService,
} from './admin-account-monitoring-queue.service';

function makeService(
  overrides: Record<string, string | undefined> = {},
): AdminAccountMonitoringQueueService {
  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        ACCOUNT_MONITORING_QUEUE_DRIVER: AdminAccountMonitoringQueueDriver.Sqs,
        ACCOUNT_MONITORING_SQS_QUEUE_URL:
          'https://sqs.eu-north-1.amazonaws.com/123/account-monitoring',
        AWS_REGION: 'eu-north-1',
      };
      if (key in overrides) {
        return overrides[key];
      }
      return values[key];
    }),
  } as unknown as ConfigService;

  return new AdminAccountMonitoringQueueService(config);
}

describe('AdminAccountMonitoringQueueService', () => {
  it('does not attempt SQS polling until the configured queue URL is present', async () => {
    const service = makeService({
      ACCOUNT_MONITORING_SQS_QUEUE_URL: '',
    });

    expect(service.isReady()).toBe(false);
    await expect(service.receiveMessages()).resolves.toEqual([]);
  });

  it('parses direct and EventBridge SQS messages and deletes malformed messages', async () => {
    const service = makeService();
    const send = jest
      .fn()
      .mockResolvedValueOnce({
        Messages: [
          {
            Body: JSON.stringify({
              triggered_at: '2026-05-22T09:00:00.000Z',
              type: AdminAccountMonitoringQueueMessageType.AutomatedScan,
            }),
            ReceiptHandle: 'receipt-direct',
          },
          {
            Body: JSON.stringify({
              detail: {
                type: AdminAccountMonitoringQueueMessageType.AutomatedScan,
              },
              time: '2026-05-22T09:05:00.000Z',
            }),
            ReceiptHandle: 'receipt-eventbridge',
          },
          {
            Body: JSON.stringify({
              detail: {
                alarmName: 'ritora-prod-media-provider-errors',
                state: { value: 'ALARM' },
              },
              'detail-type': 'CloudWatch Alarm State Change',
              source: 'aws.cloudwatch',
              time: '2026-05-22T09:07:00.000Z',
            }),
            ReceiptHandle: 'receipt-incident',
          },
          {
            Body: JSON.stringify({
              detail: {
                description:
                  'CloudWatch reported elevated media provider failures.',
                severity: AdminOperationalIncidentSeverity.Critical,
                sourceId: 'cloudwatch:media-provider-errors',
                sourceType: 'aws:cloudwatch-alarm',
                title: 'Media provider errors elevated',
                type: AdminAccountMonitoringQueueMessageType.OperationalIncident,
              },
              time: '2026-05-22T09:07:00.000Z',
            }),
            ReceiptHandle: 'receipt-direct-incident',
          },
          {
            Body: JSON.stringify({
              detail: {
                severity: AdminAccountMonitoringSeverity.Critical,
                summary: 'Escalated support thread',
                supportReference: 'SUP-124',
                type: AdminAccountMonitoringQueueMessageType.SupportEscalation,
                userIdentifier: 'user@example.com',
              },
              time: '2026-05-22T09:06:00.000Z',
            }),
            ReceiptHandle: 'receipt-support',
          },
          {
            Body: JSON.stringify({ type: 'unsupported' }),
            ReceiptHandle: 'receipt-malformed',
          },
        ],
      })
      .mockResolvedValueOnce({});
    (
      service as unknown as {
        sqsClient: { send: jest.Mock };
      }
    ).sqsClient = { send };

    const messages = await service.receiveMessages();

    expect(messages).toEqual([
      {
        receiptHandle: 'receipt-direct',
        triggeredAt: new Date('2026-05-22T09:00:00.000Z'),
        type: AdminAccountMonitoringQueueMessageType.AutomatedScan,
      },
      {
        receiptHandle: 'receipt-eventbridge',
        triggeredAt: new Date('2026-05-22T09:05:00.000Z'),
        type: AdminAccountMonitoringQueueMessageType.AutomatedScan,
      },
      {
        description:
          'CloudWatch alarm ritora-prod-media-provider-errors entered ALARM state. Review CloudWatch alarm history and linked dashboards for full provider context.',
        receiptHandle: 'receipt-incident',
        severity: AdminOperationalIncidentSeverity.Critical,
        sourceId: 'ritora-prod-media-provider-errors',
        sourceType: 'aws:cloudwatch-alarm',
        title: 'Platform alarm: ritora-prod-media-provider-errors',
        triggeredAt: new Date('2026-05-22T09:07:00.000Z'),
        type: AdminAccountMonitoringQueueMessageType.OperationalIncident,
      },
      {
        description: 'CloudWatch reported elevated media provider failures.',
        receiptHandle: 'receipt-direct-incident',
        severity: AdminOperationalIncidentSeverity.Critical,
        sourceId: 'cloudwatch:media-provider-errors',
        sourceType: 'aws:cloudwatch-alarm',
        title: 'Media provider errors elevated',
        triggeredAt: new Date('2026-05-22T09:07:00.000Z'),
        type: AdminAccountMonitoringQueueMessageType.OperationalIncident,
      },
      {
        internalNote:
          'Support escalation was received from the support event queue.',
        latestSignal: 'Support escalation SUP-124 was received.',
        reason: 'Support escalation received from account monitoring queue',
        receiptHandle: 'receipt-support',
        severity: AdminAccountMonitoringSeverity.Critical,
        summary: 'Escalated support thread',
        supportReference: 'SUP-124',
        triggeredAt: new Date('2026-05-22T09:06:00.000Z'),
        type: AdminAccountMonitoringQueueMessageType.SupportEscalation,
        userIdentifier: 'user@example.com',
      },
    ]);
    expect(send).toHaveBeenNthCalledWith(1, expect.any(ReceiveMessageCommand));
    expect(send).toHaveBeenNthCalledWith(2, expect.any(DeleteMessageCommand));
  });
});

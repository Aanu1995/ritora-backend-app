import {
  ActionAfterCompletion,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  FlexibleTimeWindowMode,
  ResourceNotFoundException,
} from '@aws-sdk/client-scheduler';
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs';
import { ConfigService } from '@nestjs/config';
import {
  AccountDeletionFinalizationDriver,
  AccountDeletionQueueMessageType,
} from './account-deletion.types';
import { AccountDeletionSchedulerService } from './account-deletion-scheduler.service';

const configValues: Record<string, string> = {
  NODE_ENV: 'production',
  AWS_REGION: 'eu-north-1',
  ACCOUNT_DELETION_FINALIZATION_DRIVER:
    AccountDeletionFinalizationDriver.EventBridgeSqs,
  ACCOUNT_DELETION_SQS_QUEUE_URL:
    'https://sqs.eu-north-1.amazonaws.com/123/account-deletions',
  ACCOUNT_DELETION_SQS_QUEUE_ARN:
    'arn:aws:sqs:eu-north-1:123:account-deletions',
  ACCOUNT_DELETION_SCHEDULER_ROLE_ARN:
    'arn:aws:iam::123:role/account-deletion-scheduler',
  ACCOUNT_DELETION_SCHEDULER_GROUP: 'account-deletions',
  ACCOUNT_DELETION_SCHEDULER_DLQ_ARN:
    'arn:aws:sqs:eu-north-1:123:account-deletion-scheduler-dlq',
};

describe('AccountDeletionSchedulerService', () => {
  const makeService = (
    overrides: Record<string, string> = {},
  ): AccountDeletionSchedulerService => {
    const config = {
      get: jest.fn((key: string) => ({ ...configValues, ...overrides })[key]),
      getOrThrow: jest.fn((key: string) => {
        const value = { ...configValues, ...overrides }[key];
        if (value === undefined) throw new Error(`Missing config ${key}`);
        return value;
      }),
    } as unknown as ConfigService;

    return new AccountDeletionSchedulerService(config);
  };

  it('creates a one-time EventBridge schedule targeting SQS', async () => {
    const service = makeService();
    const send = jest.fn().mockResolvedValue({});
    (
      service as unknown as {
        schedulerClient: { send: jest.Mock };
      }
    ).schedulerClient = { send };

    await service.scheduleFinalization(
      '01USER',
      new Date('2026-06-13T12:34:56.789Z'),
    );

    expect(send).toHaveBeenNthCalledWith(1, expect.any(DeleteScheduleCommand));
    expect(send).toHaveBeenNthCalledWith(2, expect.any(CreateScheduleCommand));
    const command = send.mock.calls[1][0] as CreateScheduleCommand;
    expect(command.input).toMatchObject({
      Name: 'account-deletion-01USER',
      GroupName: 'account-deletions',
      ScheduleExpression: 'at(2026-06-13T12:34:56)',
      ScheduleExpressionTimezone: 'UTC',
      ActionAfterCompletion: ActionAfterCompletion.DELETE,
      FlexibleTimeWindow: { Mode: FlexibleTimeWindowMode.OFF },
      Target: {
        Arn: configValues.ACCOUNT_DELETION_SQS_QUEUE_ARN,
        RoleArn: configValues.ACCOUNT_DELETION_SCHEDULER_ROLE_ARN,
        DeadLetterConfig: {
          Arn: configValues.ACCOUNT_DELETION_SCHEDULER_DLQ_ARN,
        },
      },
    });
    expect(JSON.parse(command.input.Target?.Input ?? '{}')).toEqual({
      type: AccountDeletionQueueMessageType.Finalize,
      user_id: '01USER',
      scheduled_for: '2026-06-13T12:34:56.789Z',
    });
  });

  it('ignores missing schedules when cancelling finalization', async () => {
    const service = makeService();
    const send = jest.fn().mockRejectedValue(
      new ResourceNotFoundException({
        message: 'not found',
        Message: 'not found',
        $metadata: {},
      }),
    );
    (
      service as unknown as {
        schedulerClient: { send: jest.Mock };
      }
    ).schedulerClient = { send };

    await expect(service.cancelFinalization('01USER')).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledWith(expect.any(DeleteScheduleCommand));
  });

  it('parses valid SQS messages and deletes malformed ones', async () => {
    const service = makeService();
    const send = jest
      .fn()
      .mockResolvedValueOnce({
        Messages: [
          {
            Body: JSON.stringify({
              type: AccountDeletionQueueMessageType.Finalize,
              user_id: '01USER',
              scheduled_for: '2026-06-13T12:34:56.789Z',
            }),
            ReceiptHandle: 'receipt-valid',
          },
          {
            Body: JSON.stringify({ user_id: '' }),
            ReceiptHandle: 'receipt-invalid',
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
        userId: '01USER',
        scheduledFor: new Date('2026-06-13T12:34:56.789Z'),
        receiptHandle: 'receipt-valid',
      },
    ]);
    expect(send).toHaveBeenNthCalledWith(1, expect.any(ReceiveMessageCommand));
    expect(send).toHaveBeenNthCalledWith(2, expect.any(DeleteMessageCommand));
  });

  it('destroys AWS clients when the module shuts down', () => {
    const service = makeService();
    const schedulerDestroy = jest.fn();
    const sqsDestroy = jest.fn();
    (
      service as unknown as {
        schedulerClient: { destroy: jest.Mock };
        sqsClient: { destroy: jest.Mock };
      }
    ).schedulerClient = { destroy: schedulerDestroy };
    (
      service as unknown as {
        schedulerClient: { destroy: jest.Mock };
        sqsClient: { destroy: jest.Mock };
      }
    ).sqsClient = { destroy: sqsDestroy };

    service.onModuleDestroy();

    expect(schedulerDestroy).toHaveBeenCalledTimes(1);
    expect(sqsDestroy).toHaveBeenCalledTimes(1);
  });
});

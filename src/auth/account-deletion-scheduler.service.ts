import {
  ActionAfterCompletion,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  FlexibleTimeWindowMode,
  ResourceNotFoundException,
  SchedulerClient,
  ScheduleState,
} from '@aws-sdk/client-scheduler';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { toIsoString } from '../common/utils/date';
import {
  AccountDeletionFinalizationDriver,
  AccountDeletionQueueMessage,
  AccountDeletionQueueMessageType,
} from './account-deletion.types';

const ACCOUNT_DELETION_SCHEDULE_PREFIX = 'account-deletion';
const ACCOUNT_DELETION_SQS_WAIT_TIME_SECONDS = 20;
const ACCOUNT_DELETION_SQS_VISIBILITY_TIMEOUT_SECONDS = 300;
const ACCOUNT_DELETION_SCHEDULER_MAX_EVENT_AGE_SECONDS = 24 * 60 * 60;
const ACCOUNT_DELETION_SCHEDULER_MAX_RETRY_ATTEMPTS = 185;

type AccountDeletionSchedulerPayload = {
  type: AccountDeletionQueueMessageType.Finalize;
  user_id: string;
  scheduled_for: string;
};

@Injectable()
export class AccountDeletionSchedulerService implements OnModuleDestroy {
  private readonly logger = new Logger(AccountDeletionSchedulerService.name);
  private readonly driver: AccountDeletionFinalizationDriver;
  private readonly queueUrl: string;
  private readonly queueArn: string;
  private readonly schedulerRoleArn: string;
  private readonly scheduleGroup: string;
  private readonly schedulerDlqArn: string;
  private schedulerClient: SchedulerClient | null;
  private sqsClient: SQSClient | null;

  constructor(private readonly config: ConfigService) {
    this.driver = this.readDriver();
    this.queueUrl =
      this.config.get<string>('ACCOUNT_DELETION_SQS_QUEUE_URL') ?? '';
    this.queueArn =
      this.config.get<string>('ACCOUNT_DELETION_SQS_QUEUE_ARN') ?? '';
    this.schedulerRoleArn =
      this.config.get<string>('ACCOUNT_DELETION_SCHEDULER_ROLE_ARN') ?? '';
    this.scheduleGroup =
      this.config.get<string>('ACCOUNT_DELETION_SCHEDULER_GROUP') ?? '';
    this.schedulerDlqArn =
      this.config.get<string>('ACCOUNT_DELETION_SCHEDULER_DLQ_ARN') ?? '';

    const awsRegion = this.config.get<string>('AWS_REGION');
    this.schedulerClient =
      this.driver === AccountDeletionFinalizationDriver.EventBridgeSqs
        ? new SchedulerClient({ region: awsRegion })
        : null;
    this.sqsClient =
      this.driver === AccountDeletionFinalizationDriver.EventBridgeSqs
        ? new SQSClient({ region: awsRegion })
        : null;
  }

  getDriver(): AccountDeletionFinalizationDriver {
    return this.driver;
  }

  onModuleDestroy(): void {
    this.schedulerClient?.destroy();
    this.sqsClient?.destroy();
    this.schedulerClient = null;
    this.sqsClient = null;
  }

  async scheduleFinalization(
    userId: string,
    scheduledFor: Date,
  ): Promise<void> {
    if (this.driver !== AccountDeletionFinalizationDriver.EventBridgeSqs) {
      return;
    }
    const schedulerClient = this.getSchedulerClient();

    await this.deleteScheduleIfExists(userId);

    const payload: AccountDeletionSchedulerPayload = {
      type: AccountDeletionQueueMessageType.Finalize,
      user_id: userId,
      scheduled_for: toIsoString(scheduledFor),
    };

    await schedulerClient.send(
      new CreateScheduleCommand({
        Name: this.scheduleName(userId),
        GroupName: this.optionalValue(this.scheduleGroup),
        Description:
          'Finalize a Ritora account deletion after the grace period.',
        ScheduleExpression: `at(${this.formatAtExpressionDate(scheduledFor)})`,
        ScheduleExpressionTimezone: 'UTC',
        State: ScheduleState.ENABLED,
        ActionAfterCompletion: ActionAfterCompletion.DELETE,
        FlexibleTimeWindow: { Mode: FlexibleTimeWindowMode.OFF },
        ClientToken: `${ACCOUNT_DELETION_SCHEDULE_PREFIX}-${userId}-${scheduledFor.getTime()}`,
        Target: {
          Arn: this.queueArn,
          RoleArn: this.schedulerRoleArn,
          Input: JSON.stringify(payload),
          RetryPolicy: {
            MaximumEventAgeInSeconds:
              ACCOUNT_DELETION_SCHEDULER_MAX_EVENT_AGE_SECONDS,
            MaximumRetryAttempts: ACCOUNT_DELETION_SCHEDULER_MAX_RETRY_ATTEMPTS,
          },
          DeadLetterConfig: this.schedulerDlqArn
            ? { Arn: this.schedulerDlqArn }
            : undefined,
        },
      }),
    );
  }

  async cancelFinalization(userId: string): Promise<void> {
    if (this.driver !== AccountDeletionFinalizationDriver.EventBridgeSqs) {
      return;
    }
    this.getSchedulerClient();
    await this.deleteScheduleIfExists(userId);
  }

  async receiveMessages(): Promise<AccountDeletionQueueMessage[]> {
    if (
      this.driver !== AccountDeletionFinalizationDriver.EventBridgeSqs ||
      !this.sqsClient ||
      !this.queueUrl
    ) {
      return [];
    }

    const response = await this.sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: ACCOUNT_DELETION_SQS_WAIT_TIME_SECONDS,
        VisibilityTimeout: ACCOUNT_DELETION_SQS_VISIBILITY_TIMEOUT_SECONDS,
      }),
    );

    const messages: AccountDeletionQueueMessage[] = [];
    for (const rawMessage of response.Messages ?? []) {
      const parsed = this.toQueueMessage(rawMessage);
      if (parsed) {
        messages.push(parsed);
        continue;
      }
      if (rawMessage.ReceiptHandle) {
        await this.deleteMalformedMessage(rawMessage.ReceiptHandle);
      }
    }

    return messages;
  }

  async deleteMessage(receiptHandle: string): Promise<void> {
    if (
      this.driver !== AccountDeletionFinalizationDriver.EventBridgeSqs ||
      !this.sqsClient ||
      !this.queueUrl
    ) {
      return;
    }

    await this.sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }

  async extendMessageVisibility(receiptHandle: string): Promise<void> {
    if (
      this.driver !== AccountDeletionFinalizationDriver.EventBridgeSqs ||
      !this.sqsClient ||
      !this.queueUrl
    ) {
      return;
    }

    await this.sqsClient.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: ACCOUNT_DELETION_SQS_VISIBILITY_TIMEOUT_SECONDS,
      }),
    );
  }

  private async deleteScheduleIfExists(userId: string): Promise<void> {
    if (!this.schedulerClient) {
      return;
    }

    try {
      await this.schedulerClient.send(
        new DeleteScheduleCommand({
          Name: this.scheduleName(userId),
          GroupName: this.optionalValue(this.scheduleGroup),
        }),
      );
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        return;
      }
      throw error;
    }
  }

  private toQueueMessage(message: Message): AccountDeletionQueueMessage | null {
    if (!message.Body || !message.ReceiptHandle) {
      return null;
    }

    try {
      const payload = JSON.parse(message.Body) as {
        type?: unknown;
        user_id?: unknown;
        scheduled_for?: unknown;
      };
      if (
        payload.type !== AccountDeletionQueueMessageType.Finalize ||
        typeof payload.user_id !== 'string' ||
        payload.user_id.length === 0 ||
        typeof payload.scheduled_for !== 'string'
      ) {
        return null;
      }

      const scheduledFor = new Date(payload.scheduled_for);
      if (Number.isNaN(scheduledFor.getTime())) {
        return null;
      }

      return {
        userId: payload.user_id,
        scheduledFor,
        receiptHandle: message.ReceiptHandle,
      };
    } catch {
      return null;
    }
  }

  private async deleteMalformedMessage(receiptHandle: string): Promise<void> {
    try {
      await this.deleteMessage(receiptHandle);
    } catch (error) {
      this.logger.warn(
        `Failed to delete malformed account deletion SQS message: ${this.errorMessage(
          error,
        )}`,
      );
    }
  }

  private getSchedulerClient(): SchedulerClient {
    if (!this.schedulerClient || !this.queueArn || !this.schedulerRoleArn) {
      throw new Error(
        'Account deletion EventBridge Scheduler is not configured',
      );
    }
    return this.schedulerClient;
  }

  private scheduleName(userId: string): string {
    return `${ACCOUNT_DELETION_SCHEDULE_PREFIX}-${userId}`;
  }

  private formatAtExpressionDate(date: Date): string {
    return date.toISOString().replace(/\.\d{3}Z$/, '');
  }

  private optionalValue(value: string): string | undefined {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  private readDriver(): AccountDeletionFinalizationDriver {
    const configured =
      this.config.get<AccountDeletionFinalizationDriver>(
        'ACCOUNT_DELETION_FINALIZATION_DRIVER',
      ) ?? AccountDeletionFinalizationDriver.Database;
    return configured === AccountDeletionFinalizationDriver.EventBridgeSqs
      ? AccountDeletionFinalizationDriver.EventBridgeSqs
      : AccountDeletionFinalizationDriver.Database;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown queue error';
  }
}

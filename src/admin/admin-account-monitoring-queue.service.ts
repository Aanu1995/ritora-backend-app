import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminOperationalIncidentSeverity } from './entities/admin-operational-incident.entity';
import { AdminAccountMonitoringSeverity } from './entities/admin-account-monitoring-flag.entity';

export enum AdminAccountMonitoringQueueDriver {
  None = 'none',
  Sqs = 'sqs',
}

export enum AdminAccountMonitoringQueueMessageType {
  AutomatedScan = 'account_monitoring_automated_scan',
  OperationalIncident = 'account_monitoring_operational_incident',
  SupportEscalation = 'account_monitoring_support_escalation',
}

export type AdminAccountMonitoringAutomatedScanQueueMessage = {
  receiptHandle: string;
  triggeredAt: Date;
  type: AdminAccountMonitoringQueueMessageType.AutomatedScan;
};

export type AdminAccountMonitoringSupportEscalationQueueMessage = {
  internalNote: string;
  latestSignal: string;
  reason: string;
  receiptHandle: string;
  severity: AdminAccountMonitoringSeverity;
  summary: string;
  supportReference: string;
  triggeredAt: Date;
  type: AdminAccountMonitoringQueueMessageType.SupportEscalation;
  userIdentifier: string;
};

export type AdminAccountMonitoringOperationalIncidentQueueMessage = {
  description: string;
  receiptHandle: string;
  severity: AdminOperationalIncidentSeverity;
  sourceId: string;
  sourceType: string;
  title: string;
  triggeredAt: Date;
  type: AdminAccountMonitoringQueueMessageType.OperationalIncident;
};

export type AdminAccountMonitoringQueueMessage =
  | AdminAccountMonitoringAutomatedScanQueueMessage
  | AdminAccountMonitoringOperationalIncidentQueueMessage
  | AdminAccountMonitoringSupportEscalationQueueMessage;

const ACCOUNT_MONITORING_SQS_WAIT_TIME_SECONDS = 20;
const ACCOUNT_MONITORING_SQS_VISIBILITY_TIMEOUT_SECONDS = 300;
const SUPPORT_ESCALATION_DEFAULT_REASON =
  'Support escalation received from account monitoring queue';
const SUPPORT_ESCALATION_DEFAULT_INTERNAL_NOTE =
  'Support escalation was received from the support event queue.';

@Injectable()
export class AdminAccountMonitoringQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(AdminAccountMonitoringQueueService.name);
  private readonly driver: AdminAccountMonitoringQueueDriver;
  private readonly queueUrl: string;
  private readonly sqsClient: SQSClient | null;

  constructor(private readonly config: ConfigService) {
    this.driver = this.readDriver();
    this.queueUrl =
      this.config.get<string>('ACCOUNT_MONITORING_SQS_QUEUE_URL')?.trim() ?? '';
    this.sqsClient =
      this.driver === AdminAccountMonitoringQueueDriver.Sqs && this.queueUrl
        ? new SQSClient({
            region: this.config.get<string>('AWS_REGION'),
          })
        : null;
  }

  getDriver(): AdminAccountMonitoringQueueDriver {
    return this.driver;
  }

  isReady(): boolean {
    return (
      this.driver === AdminAccountMonitoringQueueDriver.Sqs &&
      this.sqsClient !== null &&
      this.queueUrl.length > 0
    );
  }

  onModuleDestroy(): void {
    this.sqsClient?.destroy();
  }

  async receiveMessages(): Promise<AdminAccountMonitoringQueueMessage[]> {
    if (
      this.driver !== AdminAccountMonitoringQueueDriver.Sqs ||
      !this.sqsClient ||
      !this.queueUrl
    ) {
      return [];
    }

    const response = await this.sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: 5,
        VisibilityTimeout: ACCOUNT_MONITORING_SQS_VISIBILITY_TIMEOUT_SECONDS,
        WaitTimeSeconds: ACCOUNT_MONITORING_SQS_WAIT_TIME_SECONDS,
      }),
    );

    const messages: AdminAccountMonitoringQueueMessage[] = [];
    for (const rawMessage of response.Messages ?? []) {
      const parsed = this.toQueueMessage(rawMessage);
      if (parsed) {
        messages.push(parsed);
        continue;
      }

      if (rawMessage.ReceiptHandle) {
        await this.deleteMessage(rawMessage.ReceiptHandle);
      }
    }

    return messages;
  }

  async deleteMessage(receiptHandle: string): Promise<void> {
    if (
      this.driver !== AdminAccountMonitoringQueueDriver.Sqs ||
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
      this.driver !== AdminAccountMonitoringQueueDriver.Sqs ||
      !this.sqsClient ||
      !this.queueUrl
    ) {
      return;
    }

    await this.sqsClient.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: ACCOUNT_MONITORING_SQS_VISIBILITY_TIMEOUT_SECONDS,
      }),
    );
  }

  private readDriver(): AdminAccountMonitoringQueueDriver {
    const configured =
      this.config.get<string>('ACCOUNT_MONITORING_QUEUE_DRIVER') ?? 'none';
    return configured.trim().toLowerCase() === 'sqs'
      ? AdminAccountMonitoringQueueDriver.Sqs
      : AdminAccountMonitoringQueueDriver.None;
  }

  private toQueueMessage(
    message: Message,
  ): AdminAccountMonitoringQueueMessage | null {
    if (!message.Body || !message.ReceiptHandle) {
      return null;
    }

    try {
      const parsed = JSON.parse(message.Body) as unknown;
      const payload = this.resolvePayload(parsed);
      if (!payload) {
        return null;
      }

      const triggeredAt = this.resolveTriggeredAt(payload);
      if (!triggeredAt) {
        return null;
      }

      return this.toTypedQueueMessage(
        message.ReceiptHandle,
        triggeredAt,
        payload,
      );
    } catch (error) {
      this.logger.warn(
        `Discarding malformed account monitoring SQS message: ${
          error instanceof Error ? error.message : 'invalid JSON'
        }`,
      );
      return null;
    }
  }

  private resolvePayload(value: unknown): Record<string, unknown> | null {
    if (!isRecord(value)) {
      return null;
    }

    const directType = resolveMessageType(value.type);
    if (directType) {
      return { ...value, type: directType };
    }

    const detail = value.detail;
    const detailType = isRecord(detail)
      ? resolveMessageType(detail.type)
      : null;
    if (isRecord(detail) && detailType) {
      return {
        ...detail,
        triggered_at: detail.triggered_at ?? value.time,
        type: detailType,
      };
    }

    if (value['detail-type'] === 'ritora.account-monitoring.automated-scan') {
      return {
        triggered_at: value.time,
        type: AdminAccountMonitoringQueueMessageType.AutomatedScan,
      };
    }

    if (
      value['detail-type'] === 'ritora.account-monitoring.support-escalation'
    ) {
      return {
        ...(isRecord(detail) ? detail : {}),
        triggered_at: value.time,
        type: AdminAccountMonitoringQueueMessageType.SupportEscalation,
      };
    }

    if (
      value['detail-type'] === 'ritora.account-monitoring.operational-incident'
    ) {
      return {
        ...(isRecord(detail) ? detail : {}),
        triggered_at: value.time,
        type: AdminAccountMonitoringQueueMessageType.OperationalIncident,
      };
    }

    if (
      value.source === 'aws.cloudwatch' &&
      value['detail-type'] === 'CloudWatch Alarm State Change' &&
      isRecord(detail)
    ) {
      const alarmName = readRequiredString(detail.alarmName, 120, 1);
      const state = detail.state;
      const stateValue = isRecord(state) ? state.value : null;
      if (alarmName && stateValue === 'ALARM') {
        return {
          description: `CloudWatch alarm ${alarmName} entered ALARM state. Review CloudWatch alarm history and linked dashboards for full provider context.`,
          severity: AdminOperationalIncidentSeverity.Critical,
          sourceId: alarmName,
          sourceType: 'aws:cloudwatch-alarm',
          title: `Platform alarm: ${alarmName}`,
          triggered_at: value.time,
          type: AdminAccountMonitoringQueueMessageType.OperationalIncident,
        };
      }
    }

    return null;
  }

  private resolveTriggeredAt(payload: Record<string, unknown>): Date | null {
    const raw = payload.triggered_at ?? payload.triggeredAt;
    const triggeredAt = typeof raw === 'string' ? new Date(raw) : new Date();
    return Number.isNaN(triggeredAt.getTime()) ? null : triggeredAt;
  }

  private toTypedQueueMessage(
    receiptHandle: string,
    triggeredAt: Date,
    payload: Record<string, unknown>,
  ): AdminAccountMonitoringQueueMessage | null {
    const type = resolveMessageType(payload.type);
    if (type === AdminAccountMonitoringQueueMessageType.AutomatedScan) {
      return {
        receiptHandle,
        triggeredAt,
        type,
      };
    }

    if (type === AdminAccountMonitoringQueueMessageType.SupportEscalation) {
      return this.toSupportEscalationQueueMessage(
        receiptHandle,
        triggeredAt,
        payload,
      );
    }

    if (type === AdminAccountMonitoringQueueMessageType.OperationalIncident) {
      return this.toOperationalIncidentQueueMessage(
        receiptHandle,
        triggeredAt,
        payload,
      );
    }

    return null;
  }

  private toSupportEscalationQueueMessage(
    receiptHandle: string,
    triggeredAt: Date,
    payload: Record<string, unknown>,
  ): AdminAccountMonitoringSupportEscalationQueueMessage | null {
    const userIdentifier = readRequiredString(
      payload.userIdentifier ?? payload.user_identifier,
      255,
      3,
    );
    const supportReference = readRequiredString(
      payload.supportReference ?? payload.support_reference,
      120,
      3,
    );
    const summary = readRequiredString(payload.summary, 160, 3);
    if (!userIdentifier || !supportReference || !summary) {
      return null;
    }

    return {
      internalNote:
        readOptionalString(
          payload.internalNote ?? payload.internal_note,
          1000,
        ) ?? SUPPORT_ESCALATION_DEFAULT_INTERNAL_NOTE,
      latestSignal:
        readOptionalString(
          payload.latestSignal ?? payload.latest_signal,
          1000,
        ) ?? `Support escalation ${supportReference} was received.`,
      reason:
        readOptionalString(payload.reason, 500) ??
        SUPPORT_ESCALATION_DEFAULT_REASON,
      receiptHandle,
      severity: resolveSeverity(payload.severity),
      summary,
      supportReference,
      triggeredAt,
      type: AdminAccountMonitoringQueueMessageType.SupportEscalation,
      userIdentifier,
    };
  }

  private toOperationalIncidentQueueMessage(
    receiptHandle: string,
    triggeredAt: Date,
    payload: Record<string, unknown>,
  ): AdminAccountMonitoringOperationalIncidentQueueMessage | null {
    const title = readRequiredString(payload.title, 160, 3);
    const description = readRequiredString(payload.description, 1000, 8);
    const sourceType = readRequiredString(
      payload.sourceType ?? payload.source_type,
      80,
      2,
    );
    const sourceId = readRequiredString(
      payload.sourceId ?? payload.source_id,
      120,
      1,
    );
    if (!title || !description || !sourceType || !sourceId) {
      return null;
    }

    return {
      description,
      receiptHandle,
      severity: resolveOperationalIncidentSeverity(payload.severity),
      sourceId,
      sourceType,
      title,
      triggeredAt,
      type: AdminAccountMonitoringQueueMessageType.OperationalIncident,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveMessageType(
  value: unknown,
): AdminAccountMonitoringQueueMessageType | null {
  if (value === 'account_monitoring_automated_scan') {
    return AdminAccountMonitoringQueueMessageType.AutomatedScan;
  }
  if (value === 'account_monitoring_operational_incident') {
    return AdminAccountMonitoringQueueMessageType.OperationalIncident;
  }
  if (value === 'account_monitoring_support_escalation') {
    return AdminAccountMonitoringQueueMessageType.SupportEscalation;
  }
  return null;
}

function resolveSeverity(value: unknown): AdminAccountMonitoringSeverity {
  return value === AdminAccountMonitoringSeverity.Critical
    ? AdminAccountMonitoringSeverity.Critical
    : AdminAccountMonitoringSeverity.Warning;
}

function resolveOperationalIncidentSeverity(
  value: unknown,
): AdminOperationalIncidentSeverity {
  return value === AdminOperationalIncidentSeverity.Critical
    ? AdminOperationalIncidentSeverity.Critical
    : AdminOperationalIncidentSeverity.Warning;
}

function readRequiredString(
  value: unknown,
  maxLength: number,
  minLength: number,
): string | null {
  const normalized = readOptionalString(value, maxLength);
  return normalized && normalized.length >= minLength ? normalized : null;
}

function readOptionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    return null;
  }
  return trimmed;
}

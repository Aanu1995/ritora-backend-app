import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AdminAccountMonitoringAutomatedScanQueueMessage,
  AdminAccountMonitoringOperationalIncidentQueueMessage,
  AdminAccountMonitoringQueueDriver,
  AdminAccountMonitoringQueueMessage,
  AdminAccountMonitoringQueueMessageType,
  AdminAccountMonitoringQueueService,
  AdminAccountMonitoringSupportEscalationQueueMessage,
} from './admin-account-monitoring-queue.service';
import {
  ACCOUNT_MONITORING_SCAN_SESSION_ID,
  AdminService,
} from './admin.service';

const ACCOUNT_MONITORING_SQS_POLL_INTERVAL_MS = 0;
const ACCOUNT_MONITORING_SQS_FAILURE_BACKOFF_MIN_MS = 1_000;
const ACCOUNT_MONITORING_SQS_FAILURE_BACKOFF_MAX_MS = 30_000;
const ACCOUNT_MONITORING_SQS_FAILURE_BACKOFF_JITTER_MS = 1_000;
const ACCOUNT_MONITORING_SQS_VISIBILITY_HEARTBEAT_MS = 120_000;

@Injectable()
export class AdminAccountMonitoringWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    AdminAccountMonitoringWorkerService.name,
  );
  private readonly enabled: boolean;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private stopped = true;
  private consecutivePollFailures = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly queue: AdminAccountMonitoringQueueService,
    private readonly adminService: AdminService,
  ) {
    this.enabled = this.configService.get<string>('NODE_ENV') !== 'test';
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log(
        'Account monitoring worker disabled in test environment.',
      );
      return;
    }
    if (this.queue.getDriver() !== AdminAccountMonitoringQueueDriver.Sqs) {
      this.logger.log('Account monitoring worker disabled without SQS driver.');
      return;
    }
    if (!this.queue.isReady()) {
      this.logger.error(
        'Account monitoring worker disabled because SQS is selected but the queue is not ready.',
      );
      return;
    }

    this.stopped = false;
    this.schedulePoll(0);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async pollOnce(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const messages = await this.queue.receiveMessages();
      await this.processSqsMessages(messages);
    } finally {
      this.polling = false;
    }
  }

  private async processSqsMessages(
    messages: AdminAccountMonitoringQueueMessage[],
  ): Promise<void> {
    if (messages.length === 0) return;

    const scanMessages: AdminAccountMonitoringAutomatedScanQueueMessage[] = [];
    const supportMessages: AdminAccountMonitoringSupportEscalationQueueMessage[] =
      [];
    const incidentMessages: AdminAccountMonitoringOperationalIncidentQueueMessage[] =
      [];

    for (const message of messages) {
      if (
        message.type === AdminAccountMonitoringQueueMessageType.AutomatedScan
      ) {
        scanMessages.push(message);
        continue;
      }
      if (
        message.type ===
        AdminAccountMonitoringQueueMessageType.SupportEscalation
      ) {
        supportMessages.push(message);
        continue;
      }
      incidentMessages.push(message);
    }

    if (scanMessages.length > 0) {
      await this.processScheduledScanMessages(scanMessages);
    }

    for (const message of supportMessages) {
      await this.processSupportEscalationMessage(message);
    }

    for (const message of incidentMessages) {
      await this.processOperationalIncidentMessage(message);
    }
  }

  private async processScheduledScanMessages(
    messages: AdminAccountMonitoringAutomatedScanQueueMessage[],
  ): Promise<void> {
    const heartbeats = messages.map((message) =>
      this.startVisibilityHeartbeat(message.receiptHandle),
    );
    const latestScheduledAt = messages.reduce(
      (latest, message) =>
        message.triggeredAt.getTime() > latest.getTime()
          ? message.triggeredAt
          : latest,
      messages[0].triggeredAt,
    );
    try {
      await this.adminService.runScheduledAccountMonitoringScan({
        sessionId: ACCOUNT_MONITORING_SCAN_SESSION_ID,
        userAgent: 'ritora-account-monitoring-sqs-worker/1.0',
      });
      const deleteResults = await Promise.allSettled(
        messages.map((message) =>
          this.queue.deleteMessage(message.receiptHandle),
        ),
      );
      deleteResults.forEach((result, index) => {
        if (result.status === 'fulfilled') return;

        this.logger.warn(
          `Failed to delete account monitoring SQS message ${
            messages[index]?.receiptHandle ?? 'unknown'
          }: ${
            result.reason instanceof Error
              ? result.reason.message
              : 'unknown error'
          }`,
        );
      });
    } catch (error) {
      this.logger.error(
        `Failed to process ${messages.length} account monitoring scan message(s); latest scheduled at ${latestScheduledAt.toISOString()}`,
        error,
      );
    } finally {
      for (const heartbeat of heartbeats) {
        if (!heartbeat) continue;
        clearInterval(heartbeat);
      }
    }
  }

  private async processSupportEscalationMessage(
    message: AdminAccountMonitoringSupportEscalationQueueMessage,
  ): Promise<void> {
    const heartbeat = this.startVisibilityHeartbeat(message.receiptHandle);
    try {
      await this.adminService.createScheduledAccountMonitoringSupportEvent({
        internalNote: message.internalNote,
        latestSignal: message.latestSignal,
        reason: message.reason,
        severity: message.severity,
        summary: message.summary,
        supportReference: message.supportReference,
        userIdentifier: message.userIdentifier,
      });
      await this.queue.deleteMessage(message.receiptHandle);
    } catch (error) {
      this.logger.error(
        `Failed to process account monitoring support message scheduled at ${message.triggeredAt.toISOString()}`,
        error,
      );
    } finally {
      if (heartbeat) {
        clearInterval(heartbeat);
      }
    }
  }

  private async processOperationalIncidentMessage(
    message: AdminAccountMonitoringOperationalIncidentQueueMessage,
  ): Promise<void> {
    const heartbeat = this.startVisibilityHeartbeat(message.receiptHandle);
    try {
      await this.adminService.createScheduledAccountMonitoringOperationalIncident(
        {
          description: message.description,
          severity: message.severity,
          sourceId: message.sourceId,
          sourceType: message.sourceType,
          title: message.title,
        },
      );
      await this.queue.deleteMessage(message.receiptHandle);
    } catch (error) {
      this.logger.error(
        `Failed to process account monitoring operational incident message scheduled at ${message.triggeredAt.toISOString()}`,
        error,
      );
    } finally {
      if (heartbeat) {
        clearInterval(heartbeat);
      }
    }
  }

  private schedulePoll(delayMs: number): void {
    if (this.stopped) return;

    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.pollOnce()
        .then(() => {
          this.consecutivePollFailures = 0;
        })
        .catch((error) => {
          this.consecutivePollFailures += 1;
          this.logger.error('Account monitoring worker poll failed', error);
        })
        .finally(() => {
          this.schedulePoll(this.nextPollDelayMs());
        });
    }, delayMs);
  }

  private nextPollDelayMs(): number {
    if (this.consecutivePollFailures === 0) {
      return ACCOUNT_MONITORING_SQS_POLL_INTERVAL_MS;
    }

    const exponentialDelay = Math.min(
      ACCOUNT_MONITORING_SQS_FAILURE_BACKOFF_MIN_MS *
        2 ** (this.consecutivePollFailures - 1),
      ACCOUNT_MONITORING_SQS_FAILURE_BACKOFF_MAX_MS,
    );
    const jitter = Math.floor(
      Math.random() * ACCOUNT_MONITORING_SQS_FAILURE_BACKOFF_JITTER_MS,
    );
    return exponentialDelay + jitter;
  }

  private startVisibilityHeartbeat(
    receiptHandle: string,
  ): ReturnType<typeof setInterval> | null {
    const heartbeat = setInterval(() => {
      void this.queue.extendMessageVisibility(receiptHandle).catch((error) => {
        this.logger.warn(
          `Failed to extend account monitoring SQS visibility: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      });
    }, ACCOUNT_MONITORING_SQS_VISIBILITY_HEARTBEAT_MS);
    heartbeat.unref();
    return heartbeat;
  }
}

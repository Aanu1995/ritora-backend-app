import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { nowDate } from '../common/utils/date';
import { AccountDeletionSchedulerService } from './account-deletion-scheduler.service';
import {
  AccountDeletionFinalizationDriver,
  AccountDeletionQueueMessage,
} from './account-deletion.types';
import { AuthService } from './auth.service';

const ACCOUNT_DELETION_DATABASE_POLL_INTERVAL_MS = 60_000;
const ACCOUNT_DELETION_SQS_POLL_INTERVAL_MS = 0;
const ACCOUNT_DELETION_SQS_FAILURE_BACKOFF_MIN_MS = 1_000;
const ACCOUNT_DELETION_SQS_FAILURE_BACKOFF_MAX_MS = 30_000;
const ACCOUNT_DELETION_SQS_FAILURE_BACKOFF_JITTER_MS = 1_000;
const ACCOUNT_DELETION_SQS_VISIBILITY_HEARTBEAT_MS = 120_000;

@Injectable()
export class AccountDeletionWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AccountDeletionWorkerService.name);
  private readonly enabled: boolean;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private stopped = true;
  private consecutivePollFailures = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
    private readonly accountDeletionScheduler: AccountDeletionSchedulerService,
  ) {
    this.enabled = this.configService.get<string>('NODE_ENV') !== 'test';
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('Account deletion worker disabled in test environment.');
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
      if (
        this.accountDeletionScheduler.getDriver() ===
        AccountDeletionFinalizationDriver.EventBridgeSqs
      ) {
        const messages = await this.accountDeletionScheduler.receiveMessages();
        await Promise.all(
          messages.map((message) => this.processSqsMessage(message)),
        );
        return;
      }

      const deleted = await this.authService.processDueAccountDeletions();
      if (deleted > 0) {
        this.logger.log(`Finalized ${deleted} scheduled account deletions.`);
      }
    } finally {
      this.polling = false;
    }
  }

  private async processSqsMessage(
    message: AccountDeletionQueueMessage,
  ): Promise<void> {
    if (message.scheduledFor.getTime() > nowDate().getTime()) {
      this.logger.warn(
        `Received account deletion message before scheduled time for user ${message.userId}.`,
      );
      return;
    }

    const heartbeat = this.startVisibilityHeartbeat(message.receiptHandle);
    try {
      const deleted = await this.authService.processScheduledAccountDeletion(
        message.userId,
        message.scheduledFor,
      );
      if (deleted) {
        this.logger.log(
          `Finalized scheduled account deletion for user ${message.userId}.`,
        );
      }
      await this.accountDeletionScheduler.deleteMessage(message.receiptHandle);
    } catch (error) {
      this.logger.error(
        `Failed to process scheduled account deletion for user ${message.userId}`,
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
          this.logger.error('Account deletion worker poll failed', error);
        })
        .finally(() => {
          this.schedulePoll(this.nextPollDelayMs());
        });
    }, delayMs);
  }

  private nextPollDelayMs(): number {
    if (
      this.accountDeletionScheduler.getDriver() !==
      AccountDeletionFinalizationDriver.EventBridgeSqs
    ) {
      return ACCOUNT_DELETION_DATABASE_POLL_INTERVAL_MS;
    }

    if (this.consecutivePollFailures === 0) {
      return ACCOUNT_DELETION_SQS_POLL_INTERVAL_MS;
    }

    const exponentialDelay = Math.min(
      ACCOUNT_DELETION_SQS_FAILURE_BACKOFF_MIN_MS *
        2 ** (this.consecutivePollFailures - 1),
      ACCOUNT_DELETION_SQS_FAILURE_BACKOFF_MAX_MS,
    );
    const jitter = Math.floor(
      Math.random() * ACCOUNT_DELETION_SQS_FAILURE_BACKOFF_JITTER_MS,
    );
    return exponentialDelay + jitter;
  }

  private startVisibilityHeartbeat(
    receiptHandle: string,
  ): ReturnType<typeof setInterval> | null {
    if (
      this.accountDeletionScheduler.getDriver() !==
      AccountDeletionFinalizationDriver.EventBridgeSqs
    ) {
      return null;
    }

    return setInterval(() => {
      void this.accountDeletionScheduler
        .extendMessageVisibility(receiptHandle)
        .catch((error) => {
          this.logger.warn(
            `Failed to extend account deletion SQS message visibility: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          );
        });
    }, ACCOUNT_DELETION_SQS_VISIBILITY_HEARTBEAT_MS);
  }
}

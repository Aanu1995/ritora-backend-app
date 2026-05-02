import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ulid } from 'ulid';
import { SkinJournalService } from '../skin-journal.service';
import {
  SKIN_JOURNAL_INSIGHT_JOB_POLL_INTERVAL_MS,
  SKIN_JOURNAL_INSIGHT_SQS_VISIBILITY_HEARTBEAT_MS,
} from '../skin-journal.constants';
import {
  InsightQueueMessage,
  SkinJournalInsightQueueService,
} from './skin-journal-insight-queue.service';

@Injectable()
export class SkinJournalInsightWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SkinJournalInsightWorkerService.name);
  private readonly workerId = `skin-journal-insight-${ulid()}`;
  private readonly enabled: boolean;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private stopped = true;

  constructor(
    private readonly queue: SkinJournalInsightQueueService,
    private readonly journal: SkinJournalService,
  ) {
    this.enabled = process.env.NODE_ENV !== 'test';
  }

  onModuleInit(): void {
    if (this.enabled) {
      this.stopped = false;
      this.schedulePoll(0);
    }
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async pollOnce(): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      if (this.queue.getDriver() === 'sqs') {
        const messages = await this.queue.receiveMessages();
        await Promise.all(
          messages.map((message) => this.processSqsMessage(message)),
        );
        return;
      }

      const job = await this.queue.claimNextDatabaseJob(this.workerId);
      if (job) {
        await this.journal.processInsightJob(job);
      }
    } finally {
      this.polling = false;
    }
  }

  private async processSqsMessage(message: InsightQueueMessage): Promise<void> {
    const heartbeat = this.startVisibilityHeartbeat(message.receiptHandle);
    try {
      const job = await this.queue.claimJob(message.jobId, this.workerId);
      if (job) {
        await this.journal.processInsightJob(job);
      }
      await this.queue.deleteMessage(message.receiptHandle);
    } catch (error) {
      this.logger.error(
        `Failed to process skin journal insight job ${message.jobId}`,
        error,
      );
    } finally {
      if (heartbeat) {
        clearInterval(heartbeat);
      }
    }
  }

  private startVisibilityHeartbeat(
    receiptHandle: string,
  ): ReturnType<typeof setInterval> | null {
    if (this.queue.getDriver() !== 'sqs') {
      return null;
    }
    const heartbeat = setInterval(() => {
      void this.queue.extendMessageVisibility(receiptHandle).catch((error) => {
        this.logger.warn(
          `Failed to extend Skin Journal insight message visibility: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      });
    }, SKIN_JOURNAL_INSIGHT_SQS_VISIBILITY_HEARTBEAT_MS);
    heartbeat.unref?.();
    return heartbeat;
  }

  private schedulePoll(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.pollTimer = setTimeout(() => {
      void this.pollOnce()
        .catch((error) => {
          this.logger.error('Skin journal insight worker poll failed', error);
        })
        .finally(() => {
          if (this.enabled && !this.stopped) {
            this.schedulePoll(SKIN_JOURNAL_INSIGHT_JOB_POLL_INTERVAL_MS);
          }
        });
    }, delayMs);
    this.pollTimer.unref?.();
  }
}

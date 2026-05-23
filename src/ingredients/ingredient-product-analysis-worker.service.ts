import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ulid } from 'ulid';
import { IngredientProductAnalysisJob } from './entities/ingredient-product-analysis-job.entity';
import {
  IngredientProductAnalysisQueueService,
  type IngredientProductAnalysisQueueMessage,
} from './ingredient-product-analysis-queue.service';
import { IngredientProductAnalysisSnapshotService } from './ingredient-product-analysis-snapshot.service';

const INGREDIENT_PRODUCT_ANALYSIS_POLL_INTERVAL_MS = 10_000;

@Injectable()
export class IngredientProductAnalysisWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    IngredientProductAnalysisWorkerService.name,
  );
  private readonly workerId = `ingredient-analysis-${ulid()}`;
  private readonly enabled: boolean;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private stopped = true;

  constructor(
    private readonly configService: ConfigService,
    private readonly queue: IngredientProductAnalysisQueueService,
    private readonly snapshots: IngredientProductAnalysisSnapshotService,
  ) {
    this.enabled = this.configService.get<string>('NODE_ENV') !== 'test';
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log(
        'Ingredient product analysis worker disabled in test environment.',
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
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      await this.queue.recoverStaleRunningJobs();
      if (this.queue.getDriver() === 'sqs') {
        await this.queue.dispatchDueJobs();
        const messages = await this.queue.receiveMessages();
        await Promise.all(
          messages.map((message) => this.processSqsMessage(message)),
        );
        return;
      }

      const job = await this.queue.claimNextJob(this.workerId);
      if (!job) {
        return;
      }

      await this.processJob(job, false);
    } finally {
      this.polling = false;
    }
  }

  private async processSqsMessage(
    message: IngredientProductAnalysisQueueMessage,
  ): Promise<void> {
    const heartbeat = this.startVisibilityHeartbeat(message.receiptHandle);
    try {
      const job = await this.queue.claimJob(message.jobId, this.workerId);
      if (job) {
        await this.processJob(job, true);
      }
      await this.queue.deleteMessage(message.receiptHandle);
    } catch {
      return;
    } finally {
      if (heartbeat) {
        clearInterval(heartbeat);
      }
    }
  }

  private async processJob(
    job: IngredientProductAnalysisJob,
    rethrow: boolean,
  ): Promise<void> {
    try {
      await this.snapshots.analyzeFocusProductForUser(
        job.user_id,
        job.product_id,
        job.language,
        job.with_explanations,
      );
      await this.queue.completeJob(job);
    } catch (error) {
      if (error instanceof NotFoundException) {
        await this.queue.completeJob(job);
        return;
      }

      const message =
        error instanceof Error ? error.message : 'ingredient_analysis_failed';
      await this.queue.retryOrFailJob(job, message);
      this.logger.warn(
        `Ingredient product analysis job ${job.id} failed: ${message}`,
      );
      if (rethrow) {
        throw error;
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
      void this.queue.extendMessageVisibility(receiptHandle).catch(() => {
        return;
      });
    }, this.queue.getVisibilityHeartbeatMs());
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
          this.logger.error(
            'Ingredient product analysis worker poll failed',
            error instanceof Error ? error.stack : String(error),
          );
        })
        .finally(() => {
          if (this.enabled && !this.stopped) {
            this.schedulePoll(INGREDIENT_PRODUCT_ANALYSIS_POLL_INTERVAL_MS);
          }
        });
    }, delayMs);
  }
}

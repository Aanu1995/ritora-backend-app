import { Injectable, Logger } from '@nestjs/common';
import { IngredientProductAnalysisQueueService } from './ingredient-product-analysis-queue.service';

@Injectable()
export class IngredientProductAnalysisPreparationService {
  private readonly logger = new Logger(
    IngredientProductAnalysisPreparationService.name,
  );
  private readonly jobs = new Map<string, Promise<void>>();

  constructor(private readonly queue: IngredientProductAnalysisQueueService) {}

  scheduleForProduct(userId: string, productId: string): void {
    const jobKey = `${userId}:${productId}`;
    if (this.jobs.has(jobKey)) {
      return;
    }

    const job = this.queue
      .enqueueForProduct(userId, productId)
      .then(() => undefined)
      .catch((error) => {
        this.logger.warn(
          `Ingredient product analysis enqueue failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      })
      .finally(() => {
        this.jobs.delete(jobKey);
      });

    this.jobs.set(jobKey, job);
  }

  async waitForIdle(): Promise<void> {
    while (this.jobs.size > 0) {
      await Promise.allSettled(this.jobs.values());
    }
  }
}

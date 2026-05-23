import { Logger } from '@nestjs/common';
import { IngredientProductAnalysisQueueService } from './ingredient-product-analysis-queue.service';
import { IngredientProductAnalysisPreparationService } from './ingredient-product-analysis-preparation.service';

describe('IngredientProductAnalysisPreparationService', () => {
  const queue = {
    enqueueForProduct: jest.fn(),
  };
  let service: IngredientProductAnalysisPreparationService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    queue.enqueueForProduct.mockResolvedValue(undefined);
    service = new IngredientProductAnalysisPreparationService(
      queue as unknown as IngredientProductAnalysisQueueService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('enqueues default-language product analysis without running AI in the API process', async () => {
    service.scheduleForProduct('user-1', 'product-1');

    expect(queue.enqueueForProduct).toHaveBeenCalledWith('user-1', 'product-1');

    await service.waitForIdle();
  });

  it('coalesces duplicate product jobs while one is already running', async () => {
    let resolveJob: () => void = () => undefined;
    queue.enqueueForProduct.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveJob = resolve;
      }),
    );

    service.scheduleForProduct('user-1', 'product-1');
    service.scheduleForProduct('user-1', 'product-1');

    expect(queue.enqueueForProduct).toHaveBeenCalledTimes(1);

    resolveJob();
    await service.waitForIdle();

    service.scheduleForProduct('user-1', 'product-1');

    expect(queue.enqueueForProduct).toHaveBeenCalledTimes(2);
    await service.waitForIdle();
  });

  it('logs preparation failures and clears the in-flight job', async () => {
    queue.enqueueForProduct.mockRejectedValue(
      new Error('analysis unavailable'),
    );

    service.scheduleForProduct('user-1', 'product-1');
    await service.waitForIdle();
    service.scheduleForProduct('user-1', 'product-1');

    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      'Ingredient product analysis enqueue failed: analysis unavailable',
    );
    expect(queue.enqueueForProduct).toHaveBeenCalledTimes(2);
  });
});

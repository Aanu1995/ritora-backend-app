import type { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { ProductCategory } from '../shelf/shelf.types';
import {
  IngredientProductAnalysisJob,
  IngredientProductAnalysisJobStatus,
} from './entities/ingredient-product-analysis-job.entity';
import { buildProductIngredientAnalysisHash } from './ingredient-product-analysis-snapshot.service';
import {
  IngredientProductAnalysisQueueService,
  type IngredientProductAnalysisQueueMessage,
} from './ingredient-product-analysis-queue.service';

function product(overrides: Partial<InventoryProduct> = {}): InventoryProduct {
  return Object.assign(new InventoryProduct(), {
    id: 'product-1',
    user_id: 'user-1',
    brand: 'Ritora Lab',
    name: 'Barrier Serum',
    category: ProductCategory.Serum,
    identity: {
      inciIngredients: ['Aqua', 'Niacinamide'],
    },
    created_at: new Date('2026-05-22T00:00:00.000Z'),
    updated_at: new Date('2026-05-23T00:00:00.000Z'),
    ...overrides,
  });
}

function job(
  overrides: Partial<IngredientProductAnalysisJob> = {},
): IngredientProductAnalysisJob {
  return Object.assign(new IngredientProductAnalysisJob(), {
    id: 'job-1',
    user_id: 'user-1',
    product_id: 'product-1',
    language: 'en',
    with_explanations: false,
    inci_hash: 'hash-1',
    product_updated_at: new Date('2026-05-23T00:00:00.000Z'),
    status: IngredientProductAnalysisJobStatus.Queued,
    attempt_count: 0,
    max_attempts: 3,
    run_after: new Date('2026-05-23T00:00:00.000Z'),
    locked_at: null,
    locked_by: null,
    last_error: null,
    completed_at: null,
    ...overrides,
  });
}

describe('IngredientProductAnalysisQueueService', () => {
  const jobs = {
    findOne: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(),
    update: jest.fn(),
    find: jest.fn(),
    manager: {
      transaction: jest.fn(),
    },
  };
  const products = {
    findOne: jest.fn(),
  };
  let service: IngredientProductAnalysisQueueService;

  beforeEach(() => {
    jest.clearAllMocks();
    jobs.save.mockImplementation(async (value) => value);
    service = new IngredientProductAnalysisQueueService(
      jobs as unknown as Repository<IngredientProductAnalysisJob>,
      products as unknown as Repository<InventoryProduct>,
      config(),
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('enqueues a durable default-language analysis job without running analysis in the API path', async () => {
    const ownedProduct = product();
    products.findOne.mockResolvedValue(ownedProduct);
    jobs.findOne.mockResolvedValue(null);

    await service.enqueueForProduct('user-1', 'product-1');

    expect(products.findOne).toHaveBeenCalledWith({
      where: { id: 'product-1', user_id: 'user-1' },
    });
    expect(jobs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        product_id: 'product-1',
        language: 'en',
        with_explanations: false,
        inci_hash: buildProductIngredientAnalysisHash(ownedProduct),
        product_updated_at: new Date('2026-05-23T00:00:00.000Z'),
        status: IngredientProductAnalysisJobStatus.Queued,
        attempt_count: 0,
        max_attempts: 3,
        locked_at: null,
        locked_by: null,
        last_error: null,
        completed_at: null,
      }),
    );
    expect(jobs.save).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate active jobs for the same product version', async () => {
    const activeJob = job({
      status: IngredientProductAnalysisJobStatus.Running,
    });
    products.findOne.mockResolvedValue(product());
    jobs.findOne.mockResolvedValue(activeJob);

    await expect(
      service.enqueueForProduct('user-1', 'product-1'),
    ).resolves.toBe(activeJob);

    expect(jobs.save).not.toHaveBeenCalled();
  });

  it('returns null when the product no longer belongs to the user', async () => {
    products.findOne.mockResolvedValue(null);

    await expect(
      service.enqueueForProduct('user-1', 'missing-product'),
    ).resolves.toBeNull();

    expect(jobs.findOne).not.toHaveBeenCalled();
    expect(jobs.save).not.toHaveBeenCalled();
  });

  it('claims one queued database job with a worker lock', async () => {
    const queuedJob = job();
    const repo = {
      createQueryBuilder: jest.fn(),
      save: jest.fn(async (value) => value),
    };
    const queryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      setOnLocked: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(queuedJob),
    };
    repo.createQueryBuilder.mockReturnValue(queryBuilder);
    jobs.manager.transaction.mockImplementation(async (callback) =>
      callback({
        getRepository: () => repo,
      }),
    );

    const claimed = await service.claimNextJob('worker-1');

    expect(claimed).toEqual(
      expect.objectContaining({
        status: IngredientProductAnalysisJobStatus.Running,
        locked_by: 'worker-1',
        attempt_count: 1,
      }),
    );
    expect(queryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(queryBuilder.setOnLocked).toHaveBeenCalledWith('skip_locked');
  });

  it('dispatches due database jobs to SQS when the SQS driver is enabled', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-23T02:00:00.000Z'));
    const dueJob = job({ id: 'job-1' });
    jobs.find.mockResolvedValue([dueJob]);
    jobs.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
    service = new IngredientProductAnalysisQueueService(
      jobs as unknown as Repository<IngredientProductAnalysisJob>,
      products as unknown as Repository<InventoryProduct>,
      config({
        INGREDIENT_ANALYSIS_QUEUE_DRIVER: 'sqs',
        INGREDIENT_ANALYSIS_SQS_QUEUE_URL:
          'https://sqs.eu-north-1.amazonaws.com/123/ingredient-analysis',
      }),
    );
    const send = jest.fn().mockResolvedValue({});
    (service as unknown as { sqsClient: { send: jest.Mock } }).sqsClient = {
      send,
    };

    const dispatched = await service.dispatchDueJobs();

    expect(dispatched).toBe(1);
    const command = send.mock.calls[0]?.[0] as {
      input: { MessageBody: string; QueueUrl: string };
    };
    expect(JSON.parse(command.input.MessageBody)).toEqual({
      job_id: 'job-1',
    });
    expect(command.input.MessageBody).not.toContain('user-1');
    expect(jobs.update).toHaveBeenCalledWith(
      {
        id: 'job-1',
        status: IngredientProductAnalysisJobStatus.Queued,
        run_after: expect.anything(),
      },
      expect.objectContaining({
        status: IngredientProductAnalysisJobStatus.Sent,
        last_error: null,
        updated_at: new Date('2026-05-23T02:00:00.000Z'),
      }),
    );
  });

  it('keeps jobs queued when SQS dispatch fails', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-23T02:05:00.000Z'));
    jobs.find.mockResolvedValue([job({ id: 'job-1' })]);
    jobs.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
    service = new IngredientProductAnalysisQueueService(
      jobs as unknown as Repository<IngredientProductAnalysisJob>,
      products as unknown as Repository<InventoryProduct>,
      config({
        INGREDIENT_ANALYSIS_QUEUE_DRIVER: 'sqs',
        INGREDIENT_ANALYSIS_SQS_QUEUE_URL:
          'https://sqs.eu-north-1.amazonaws.com/123/ingredient-analysis',
      }),
    );
    (service as unknown as { sqsClient: { send: jest.Mock } }).sqsClient = {
      send: jest.fn().mockRejectedValue(new Error('sqs unavailable')),
    };

    await service.dispatchDueJobs();

    expect(jobs.update).toHaveBeenLastCalledWith(
      {
        id: 'job-1',
        status: IngredientProductAnalysisJobStatus.Sent,
      },
      expect.objectContaining({
        status: IngredientProductAnalysisJobStatus.Queued,
        last_error: 'sqs unavailable',
        updated_at: new Date('2026-05-23T02:05:00.000Z'),
      }),
    );
  });

  it('receives valid SQS job messages and deletes malformed messages', async () => {
    service = new IngredientProductAnalysisQueueService(
      jobs as unknown as Repository<IngredientProductAnalysisJob>,
      products as unknown as Repository<InventoryProduct>,
      config({
        INGREDIENT_ANALYSIS_QUEUE_DRIVER: 'sqs',
        INGREDIENT_ANALYSIS_SQS_QUEUE_URL:
          'https://sqs.eu-north-1.amazonaws.com/123/ingredient-analysis',
      }),
    );
    const send = jest
      .fn()
      .mockResolvedValueOnce({
        Messages: [
          {
            Body: JSON.stringify({ job_id: 'job-1' }),
            ReceiptHandle: 'receipt-1',
          },
          {
            Body: JSON.stringify({ invalid: true }),
            ReceiptHandle: 'receipt-2',
          },
        ],
      })
      .mockResolvedValue({});
    (service as unknown as { sqsClient: { send: jest.Mock } }).sqsClient = {
      send,
    };

    const messages: IngredientProductAnalysisQueueMessage[] =
      await service.receiveMessages();

    expect(messages).toEqual([{ jobId: 'job-1', receiptHandle: 'receipt-1' }]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('recovers stale running jobs back to queued until attempts are exhausted', async () => {
    const now = new Date('2026-05-23T01:00:00.000Z');
    jobs.find
      .mockResolvedValueOnce([job({ attempt_count: 1 })])
      .mockResolvedValueOnce([
        job({
          id: 'sent-job-1',
          status: IngredientProductAnalysisJobStatus.Sent,
        }),
      ]);
    jobs.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

    await service.recoverStaleRunningJobs(now);

    expect(jobs.update).toHaveBeenCalledWith(
      {
        id: 'job-1',
        status: IngredientProductAnalysisJobStatus.Running,
        locked_by: expect.anything(),
      },
      expect.objectContaining({
        status: IngredientProductAnalysisJobStatus.Queued,
        run_after: now,
        updated_at: now,
        locked_at: null,
        locked_by: null,
      }),
    );
    expect(jobs.update).toHaveBeenCalledWith(
      {
        id: 'sent-job-1',
        status: IngredientProductAnalysisJobStatus.Sent,
      },
      expect.objectContaining({
        status: IngredientProductAnalysisJobStatus.Queued,
        run_after: now,
        updated_at: now,
        locked_at: null,
        locked_by: null,
      }),
    );
  });
});

function config(
  overrides: Record<string, unknown> = {},
): ConfigService<Record<string, unknown>, false> {
  const values: Record<string, unknown> = {
    AWS_REGION: 'eu-north-1',
    INGREDIENT_ANALYSIS_QUEUE_DRIVER: 'database',
    INGREDIENT_ANALYSIS_SQS_QUEUE_URL: '',
    INGREDIENT_ANALYSIS_SQS_DLQ_URL: '',
    ...overrides,
  };
  return {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => {
      const value = values[key];
      if (value === undefined) {
        throw new Error(`Missing config ${key}`);
      }
      return value;
    }),
  } as unknown as ConfigService<Record<string, unknown>, false>;
}

import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { ProductCategory } from '../shelf/shelf.types';
import { AnalysisService } from './analysis.service';
import { ENGINE_VERSION } from './engine-version';
import {
  IngredientProductAnalysisSnapshot,
  IngredientProductAnalysisSnapshotStatus,
} from './entities/ingredient-product-analysis-snapshot.entity';
import {
  buildProductIngredientAnalysisHash,
  IngredientProductAnalysisSnapshotService,
} from './ingredient-product-analysis-snapshot.service';
import {
  AnalysisConfidence,
  AnalysisMode,
  AnalysisStatus,
  type AnalysisResult,
} from './ingredients.types';

function product(overrides: Partial<InventoryProduct> = {}): InventoryProduct {
  return Object.assign(new InventoryProduct(), {
    id: 'product-1',
    user_id: 'user-1',
    brand: 'Ritora Lab',
    name: 'Barrier Serum',
    category: ProductCategory.Serum,
    identity: {
      inciIngredients: ['Aqua', 'Niacinamide', 'Glycerin'],
    },
    created_at: new Date('2026-05-22T00:00:00.000Z'),
    updated_at: new Date('2026-05-23T00:00:00.000Z'),
    ...overrides,
  });
}

function analysisResult(
  status: AnalysisStatus = AnalysisStatus.Ok,
): AnalysisResult {
  return {
    mode: AnalysisMode.Focus,
    status,
    confidence:
      status === AnalysisStatus.Ok
        ? AnalysisConfidence.High
        : AnalysisConfidence.Low,
    safetyScore: null,
    actives: [],
    conflicts: [],
    overlaps: [],
    layeringOrder: [],
    productsMissingInci:
      status === AnalysisStatus.InsufficientData ? ['product-1'] : [],
    engineVersion: ENGINE_VERSION,
    generatedAt: '2026-05-23T00:00:00.000Z',
  };
}

function snapshot(
  overrides: Partial<IngredientProductAnalysisSnapshot> = {},
): IngredientProductAnalysisSnapshot {
  return Object.assign(new IngredientProductAnalysisSnapshot(), {
    id: 'snapshot-1',
    user_id: 'user-1',
    product_id: 'product-1',
    language: 'en',
    with_explanations: false,
    product_updated_at: new Date('2026-05-23T00:00:00.000Z'),
    inci_hash: 'hash',
    engine_version: ENGINE_VERSION,
    status: IngredientProductAnalysisSnapshotStatus.Ready,
    result: analysisResult(),
    last_error: null,
    requested_at: new Date('2026-05-23T00:00:00.000Z'),
    analyzed_at: new Date('2026-05-23T00:00:00.000Z'),
    ...overrides,
  });
}

describe('IngredientProductAnalysisSnapshotService', () => {
  const snapshotsRepository = {
    findOne: jest.fn(),
    query: jest.fn(),
  };
  const inventoryRepository = {
    findOne: jest.fn(),
  };
  const analysisService = {
    analyze: jest.fn(),
  };
  let service: IngredientProductAnalysisSnapshotService;

  beforeEach(() => {
    jest.clearAllMocks();
    snapshotsRepository.query.mockResolvedValue([]);
    service = new IngredientProductAnalysisSnapshotService(
      snapshotsRepository as unknown as Repository<IngredientProductAnalysisSnapshot>,
      inventoryRepository as unknown as Repository<InventoryProduct>,
      analysisService as unknown as AnalysisService,
    );
  });

  it('reuses a ready snapshot when the product identity and INCI hash still match', async () => {
    const ownedProduct = product();
    const result = analysisResult();
    inventoryRepository.findOne.mockResolvedValue(ownedProduct);
    snapshotsRepository.findOne.mockResolvedValue(
      snapshot({
        inci_hash: buildProductIngredientAnalysisHash(ownedProduct),
        result,
      }),
    );

    await expect(
      service.analyzeFocusProductForUser('user-1', 'product-1', 'en', false),
    ).resolves.toBe(result);

    expect(inventoryRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'product-1', user_id: 'user-1' },
    });
    expect(analysisService.analyze).not.toHaveBeenCalled();
    expect(snapshotsRepository.query).not.toHaveBeenCalled();
  });

  it('recomputes a matching snapshot when force refresh is requested', async () => {
    const ownedProduct = product();
    const staleResult = analysisResult();
    const freshResult = analysisResult();
    inventoryRepository.findOne.mockResolvedValue(ownedProduct);
    snapshotsRepository.findOne.mockResolvedValue(
      snapshot({
        inci_hash: buildProductIngredientAnalysisHash(ownedProduct),
        result: staleResult,
      }),
    );
    analysisService.analyze.mockResolvedValue(freshResult);

    await expect(
      service.analyzeFocusProductForUser('user-1', 'product-1', 'en', false, {
        forceRefresh: true,
      }),
    ).resolves.toBe(freshResult);

    expect(analysisService.analyze).toHaveBeenCalledTimes(1);
    expectSnapshotWrite(0, {
      status: IngredientProductAnalysisSnapshotStatus.Pending,
      resultJson: null,
    });
    expectSnapshotWrite(1, {
      status: IngredientProductAnalysisSnapshotStatus.Ready,
      resultJson: JSON.stringify(freshResult),
      lastError: null,
    });
  });

  it('recomputes and persists a ready snapshot when the stored hash is stale', async () => {
    const ownedProduct = product({
      identity: {
        ...product().identity,
        inciIngredients: ['Aqua', 'Azelaic Acid'],
      },
    });
    const result = analysisResult();
    inventoryRepository.findOne.mockResolvedValue(ownedProduct);
    snapshotsRepository.findOne.mockResolvedValue(
      snapshot({ inci_hash: 'stale-hash' }),
    );
    analysisService.analyze.mockResolvedValue(result);

    await expect(
      service.analyzeFocusProductForUser('user-1', 'product-1', 'en', false),
    ).resolves.toBe(result);

    expect(analysisService.analyze).toHaveBeenCalledWith({
      products: [
        {
          id: 'product-1',
          brand: 'Ritora Lab',
          name: 'Barrier Serum',
          category: ProductCategory.Serum,
          inciIngredients: ['Aqua', 'Azelaic Acid'],
        },
      ],
      focusProductId: 'product-1',
      skinProfile: null,
      language: 'en',
      tracking: {
        productId: 'product-1',
        source: 'ingredient_product_analysis_worker',
        userId: 'user-1',
      },
      withExplanations: false,
    });
    expectSnapshotWrite(0, {
      status: IngredientProductAnalysisSnapshotStatus.Pending,
      resultJson: null,
    });
    expectSnapshotWrite(1, {
      status: IngredientProductAnalysisSnapshotStatus.Ready,
      resultJson: JSON.stringify(result),
      lastError: null,
    });
  });

  it('persists insufficient-data results as partial snapshots', async () => {
    const ownedProduct = product({
      identity: { ...product().identity, inciIngredients: [] },
    });
    const result = analysisResult(AnalysisStatus.InsufficientData);
    inventoryRepository.findOne.mockResolvedValue(ownedProduct);
    snapshotsRepository.findOne.mockResolvedValue(null);
    analysisService.analyze.mockResolvedValue(result);

    await service.analyzeFocusProductForUser(
      'user-1',
      'product-1',
      'en',
      false,
    );

    expectSnapshotWrite(1, {
      status: IngredientProductAnalysisSnapshotStatus.Partial,
      resultJson: JSON.stringify(result),
    });
  });

  it('stores a failed snapshot without leaking product payloads into the error field', async () => {
    const ownedProduct = product();
    inventoryRepository.findOne.mockResolvedValue(ownedProduct);
    snapshotsRepository.findOne.mockResolvedValue(null);
    analysisService.analyze.mockRejectedValue(
      new Error('Provider unavailable'),
    );

    await expect(
      service.analyzeFocusProductForUser('user-1', 'product-1', 'en', false),
    ).rejects.toThrow('Provider unavailable');

    expectSnapshotWrite(1, {
      status: IngredientProductAnalysisSnapshotStatus.Failed,
      resultJson: null,
      lastError: 'Provider unavailable',
    });
  });

  it('guards snapshot writes with the product updated timestamp', async () => {
    const ownedProduct = product();
    inventoryRepository.findOne.mockResolvedValue(ownedProduct);
    snapshotsRepository.findOne.mockResolvedValue(null);
    analysisService.analyze.mockResolvedValue(analysisResult());

    await service.analyzeFocusProductForUser(
      'user-1',
      'product-1',
      'en',
      false,
    );

    const sql = snapshotsRepository.query.mock.calls[0]?.[0] as
      | string
      | undefined;
    const params = snapshotsRepository.query.mock.calls[0]?.[1] as
      | unknown[]
      | undefined;

    expect(sql).toContain(
      '"ingredient_product_analysis_snapshots"."product_updated_at"',
    );
    expect(sql).toContain('<= EXCLUDED."product_updated_at"');
    expect(params?.[5]).toEqual(new Date('2026-05-23T00:00:00.000Z'));
  });

  it('coalesces duplicate in-process analysis calls for the same product hash', async () => {
    const ownedProduct = product();
    const result = analysisResult();
    let resolveAnalysis: (value: AnalysisResult) => void = () => undefined;
    const pendingAnalysis = new Promise<AnalysisResult>((resolve) => {
      resolveAnalysis = resolve;
    });

    inventoryRepository.findOne.mockResolvedValue(ownedProduct);
    snapshotsRepository.findOne.mockResolvedValue(null);
    analysisService.analyze.mockReturnValue(pendingAnalysis);

    const first = service.analyzeFocusProductForUser(
      'user-1',
      'product-1',
      'en',
      false,
    );
    const second = service.analyzeFocusProductForUser(
      'user-1',
      'product-1',
      'en',
      false,
    );

    resolveAnalysis(result);

    await expect(Promise.all([first, second])).resolves.toEqual([
      result,
      result,
    ]);
    expect(analysisService.analyze).toHaveBeenCalledTimes(1);
  });

  it('rejects analysis for a product outside the user shelf', async () => {
    inventoryRepository.findOne.mockResolvedValue(null);

    await expect(
      service.analyzeFocusProductForUser('user-1', 'missing', 'en', false),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(snapshotsRepository.findOne).not.toHaveBeenCalled();
    expect(analysisService.analyze).not.toHaveBeenCalled();
  });

  it('changes the hash when product naming, category, or INCI changes', () => {
    const baseline = product();

    expect(
      buildProductIngredientAnalysisHash(product({ name: 'Different Serum' })),
    ).not.toBe(buildProductIngredientAnalysisHash(baseline));
    expect(
      buildProductIngredientAnalysisHash(
        product({ category: ProductCategory.Cleanser }),
      ),
    ).not.toBe(buildProductIngredientAnalysisHash(baseline));
    expect(
      buildProductIngredientAnalysisHash(
        product({
          identity: {
            ...product().identity,
            inciIngredients: ['Aqua', 'Retinal'],
          },
        }),
      ),
    ).not.toBe(buildProductIngredientAnalysisHash(baseline));
  });

  function expectSnapshotWrite(
    callIndex: number,
    expected: {
      status: IngredientProductAnalysisSnapshotStatus;
      resultJson: string | null;
      lastError?: string | null;
    },
  ): void {
    const params = snapshotsRepository.query.mock.calls[callIndex]?.[1] as
      | unknown[]
      | undefined;

    expect(params).toBeDefined();
    expect(params?.[8]).toBe(expected.status);
    expect(params?.[9]).toBe(expected.resultJson);
    if ('lastError' in expected) {
      expect(params?.[10]).toBe(expected.lastError);
    }
  }
});

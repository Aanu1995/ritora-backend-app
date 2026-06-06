import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ProductCategory } from '../../shelf/shelf.types';
import { IngredientProductAnalysisJob } from '../entities/ingredient-product-analysis-job.entity';
import { IngredientProductAnalysisSnapshot } from '../entities/ingredient-product-analysis-snapshot.entity';
import type { AnalysisResult } from '../ingredients.types';
import { ulid } from 'ulid';

export function evaluationInventoryProduct(
  userId: string,
  productId: string,
): InventoryProduct {
  return Object.assign(new InventoryProduct(), {
    id: productId,
    user_id: userId,
    brand: 'Ritora Evaluation',
    name: 'Barrier Snapshot Cream',
    category: ProductCategory.Moisturizer,
    identity: {
      inciIngredients: [
        'Aqua',
        'Glycerin',
        'Ceramide NP',
        'Sodium Hyaluronate',
      ],
    },
    created_at: new Date('2026-05-23T00:00:00.000Z'),
    updated_at: new Date('2026-05-23T00:00:00.000Z'),
  });
}

export class EvaluationInventoryRepository {
  private readonly products = new Map<string, InventoryProduct>();

  constructor(products: InventoryProduct[]) {
    for (const product of products) this.products.set(product.id, product);
  }

  findOne(options: {
    where: { id: string; user_id: string };
  }): Promise<InventoryProduct | null> {
    const product = this.products.get(options.where.id);
    return Promise.resolve(
      product && product.user_id === options.where.user_id ? product : null,
    );
  }
}

export class EvaluationJobRepository {
  readonly manager = {
    transaction: async <T>(
      callback: (manager: {
        getRepository: () => EvaluationJobRepository;
      }) => Promise<T>,
    ) => callback({ getRepository: () => this }),
  };
  private readonly jobs = new Map<string, IngredientProductAnalysisJob>();

  get(id: string): IngredientProductAnalysisJob | null {
    return this.jobs.get(id) ?? null;
  }

  create(
    value: Partial<IngredientProductAnalysisJob>,
  ): IngredientProductAnalysisJob {
    return Object.assign(new IngredientProductAnalysisJob(), {
      id: value.id ?? ulid(),
      created_at: new Date(),
      updated_at: new Date(),
      ...value,
    });
  }

  save(
    job: IngredientProductAnalysisJob,
  ): Promise<IngredientProductAnalysisJob> {
    const stored = this.create({ ...job, updated_at: new Date() });
    this.jobs.set(stored.id, stored);
    return Promise.resolve(stored);
  }

  findOne(options: {
    where: Record<string, unknown>;
  }): Promise<IngredientProductAnalysisJob | null> {
    return Promise.resolve(
      Array.from(this.jobs.values()).find((job) =>
        matchesWhere(job, options.where),
      ) ?? null,
    );
  }

  find(options: {
    where: Record<string, unknown>;
    order?: Record<string, 'ASC' | 'DESC'>;
    take?: number;
  }): Promise<IngredientProductAnalysisJob[]> {
    const rows = Array.from(this.jobs.values()).filter((job) =>
      matchesWhere(job, options.where),
    );
    const [orderKey, orderDirection] =
      Object.entries(options.order ?? {})[0] ?? [];
    if (orderKey && orderDirection) {
      rows.sort((left, right) =>
        compareValues(
          fieldValue(left, orderKey),
          fieldValue(right, orderKey),
          orderDirection,
        ),
      );
    }
    return Promise.resolve(rows.slice(0, options.take ?? rows.length));
  }

  update(
    criteria: Record<string, unknown>,
    values: Partial<IngredientProductAnalysisJob>,
  ): Promise<{ affected: number; raw: never[]; generatedMaps: never[] }> {
    let affected = 0;
    for (const job of this.jobs.values()) {
      if (!matchesWhere(job, criteria)) continue;
      Object.assign(job, values);
      job.updated_at = values.updated_at ?? new Date();
      affected += 1;
    }
    return Promise.resolve({ affected, raw: [], generatedMaps: [] });
  }

  createQueryBuilder(): {
    setLock: () => ReturnType<EvaluationJobRepository['createQueryBuilder']>;
    where: (
      query: string,
      parameters: { jobId?: string },
    ) => ReturnType<EvaluationJobRepository['createQueryBuilder']>;
    getOne: () => Promise<IngredientProductAnalysisJob | null>;
  } {
    let selectedJobId: string | null = null;
    const builder = {
      setLock: () => builder,
      where: (_query: string, parameters: { jobId?: string }) => {
        selectedJobId = parameters.jobId ?? null;
        return builder;
      },
      getOne: () =>
        Promise.resolve(
          selectedJobId ? (this.jobs.get(selectedJobId) ?? null) : null,
        ),
    };
    return builder;
  }
}

export class EvaluationSnapshotRepository {
  private readonly snapshots = new Map<
    string,
    IngredientProductAnalysisSnapshot
  >();

  get(
    userId: string,
    productId: string,
    language: string,
    withExplanations: boolean,
  ): IngredientProductAnalysisSnapshot | null {
    return (
      this.snapshots.get(
        snapshotKey(userId, productId, language, withExplanations),
      ) ?? null
    );
  }

  findOne(options: {
    where: {
      user_id: string;
      product_id: string;
      language: string;
      with_explanations: boolean;
    };
  }): Promise<IngredientProductAnalysisSnapshot | null> {
    return Promise.resolve(
      this.get(
        options.where.user_id,
        options.where.product_id,
        options.where.language,
        options.where.with_explanations,
      ),
    );
  }

  query(_sql: string, params: unknown[]): Promise<never[]> {
    const [
      id,
      userId,
      productId,
      language,
      withExplanations,
      productUpdatedAt,
      inciHash,
      engineVersion,
      status,
      result,
      lastError,
      analyzedAt,
    ] = params;
    const typedParams = {
      id,
      userId,
      productId,
      language,
      withExplanations,
      productUpdatedAt,
      inciHash,
      engineVersion,
      status,
    };
    assertSnapshotParams(typedParams);

    const key = snapshotKey(
      typedParams.userId,
      typedParams.productId,
      typedParams.language,
      typedParams.withExplanations,
    );
    const existing = this.snapshots.get(key);
    if (
      existing &&
      existing.product_updated_at > typedParams.productUpdatedAt
    ) {
      return Promise.resolve([]);
    }
    this.snapshots.set(
      key,
      Object.assign(new IngredientProductAnalysisSnapshot(), {
        id: existing?.id ?? typedParams.id,
        user_id: typedParams.userId,
        product_id: typedParams.productId,
        language: typedParams.language,
        with_explanations: typedParams.withExplanations,
        product_updated_at: typedParams.productUpdatedAt,
        inci_hash: typedParams.inciHash,
        engine_version: typedParams.engineVersion,
        status: typedParams.status,
        result:
          typeof result === 'string'
            ? (JSON.parse(result) as AnalysisResult)
            : null,
        last_error: typeof lastError === 'string' ? lastError : null,
        requested_at: new Date(),
        analyzed_at: analyzedAt instanceof Date ? analyzedAt : null,
        created_at: existing?.created_at ?? new Date(),
        updated_at: new Date(),
      }),
    );
    return Promise.resolve([]);
  }
}

function assertSnapshotParams(input: {
  id: unknown;
  userId: unknown;
  productId: unknown;
  language: unknown;
  withExplanations: unknown;
  productUpdatedAt: unknown;
  inciHash: unknown;
  engineVersion: unknown;
  status: unknown;
}): asserts input is {
  id: string;
  userId: string;
  productId: string;
  language: string;
  withExplanations: boolean;
  productUpdatedAt: Date;
  inciHash: string;
  engineVersion: string;
  status: string;
} {
  if (
    typeof input.id !== 'string' ||
    typeof input.userId !== 'string' ||
    typeof input.productId !== 'string' ||
    typeof input.language !== 'string' ||
    typeof input.withExplanations !== 'boolean' ||
    !(input.productUpdatedAt instanceof Date) ||
    typeof input.inciHash !== 'string' ||
    typeof input.engineVersion !== 'string' ||
    typeof input.status !== 'string'
  ) {
    throw new Error('Invalid evaluation snapshot upsert parameters.');
  }
}

function snapshotKey(
  userId: string,
  productId: string,
  language: string,
  withExplanations: boolean,
): string {
  return `${userId}:${productId}:${language}:${
    withExplanations ? 'explain' : 'plain'
  }`;
}

function matchesWhere(entity: object, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) =>
    matchesValue(fieldValue(entity, key), expected),
  );
}

function matchesValue(actual: unknown, expected: unknown): boolean {
  if (isFindOperator(expected)) {
    if (expected._type === 'lessThanOrEqual') {
      return toTime(actual) <= toTime(expected._value);
    }
    if (expected._type === 'lessThan') {
      return toTime(actual) < toTime(expected._value);
    }
    if (expected._type === 'in' && Array.isArray(expected._value)) {
      return expected._value.includes(actual);
    }
  }
  return actual === expected;
}

function isFindOperator(
  value: unknown,
): value is { _type: string; _value: unknown } {
  return Boolean(value && typeof value === 'object' && '_type' in value);
}

function fieldValue(entity: object, key: string): unknown {
  return (entity as Record<string, unknown>)[key];
}

function toTime(value: unknown): number {
  return value instanceof Date ? value.getTime() : Number.NaN;
}

function compareValues(
  left: unknown,
  right: unknown,
  direction: 'ASC' | 'DESC',
): number {
  const comparison = toTime(left) - toTime(right);
  return direction === 'ASC' ? comparison : -comparison;
}

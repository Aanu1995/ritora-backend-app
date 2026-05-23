import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ulid } from 'ulid';
import { hashStableValue } from '../catalogue/catalogue-cache-key.utils';
import type { AppLanguage } from '../common/i18n/i18n';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { AnalysisService } from './analysis.service';
import { ENGINE_VERSION } from './engine-version';
import {
  IngredientProductAnalysisSnapshot,
  IngredientProductAnalysisSnapshotStatus,
} from './entities/ingredient-product-analysis-snapshot.entity';
import {
  AnalysisStatus,
  type AnalysisResult,
  type ProductForAnalysis,
} from './ingredients.types';
import { IngredientAnalysisAiMetricSource } from './ingredient-analysis-ai-usage-metrics';

@Injectable()
export class IngredientProductAnalysisSnapshotService {
  private readonly activeAnalyses = new Map<string, Promise<AnalysisResult>>();

  constructor(
    @InjectRepository(IngredientProductAnalysisSnapshot)
    private readonly snapshotsRepository: Repository<IngredientProductAnalysisSnapshot>,
    @InjectRepository(InventoryProduct)
    private readonly inventoryRepository: Repository<InventoryProduct>,
    private readonly analysisService: AnalysisService,
  ) {}

  async analyzeFocusProductForUser(
    userId: string,
    productId: string,
    language: AppLanguage,
    withExplanations: boolean,
    options: { forceRefresh?: boolean } = {},
  ): Promise<AnalysisResult> {
    const product = await this.inventoryRepository.findOne({
      where: { id: productId, user_id: userId },
    });

    if (!product) {
      throw new NotFoundException('Inventory product not found');
    }

    const inciHash = buildProductIngredientAnalysisHash(product);
    const cached = await this.snapshotsRepository.findOne({
      where: {
        user_id: userId,
        product_id: productId,
        language,
        with_explanations: withExplanations,
      },
    });

    if (!options.forceRefresh && this.canReuseSnapshot(cached, inciHash)) {
      return cached.result;
    }

    const activeKey = buildActiveAnalysisKey({
      userId,
      productId,
      language,
      withExplanations,
      inciHash,
    });
    const active = this.activeAnalyses.get(activeKey);
    if (active) {
      return active;
    }

    const analysis = this.computeAndStoreSnapshot({
      userId,
      product,
      language,
      withExplanations,
      inciHash,
    }).finally(() => {
      this.activeAnalyses.delete(activeKey);
    });

    this.activeAnalyses.set(activeKey, analysis);
    return analysis;
  }

  private canReuseSnapshot(
    snapshot: IngredientProductAnalysisSnapshot | null,
    inciHash: string,
  ): snapshot is IngredientProductAnalysisSnapshot & {
    result: AnalysisResult;
  } {
    return Boolean(
      snapshot?.result &&
      snapshot.inci_hash === inciHash &&
      (snapshot.status === IngredientProductAnalysisSnapshotStatus.Ready ||
        snapshot.status === IngredientProductAnalysisSnapshotStatus.Partial),
    );
  }

  private async computeAndStoreSnapshot(input: {
    userId: string;
    product: InventoryProduct;
    language: AppLanguage;
    withExplanations: boolean;
    inciHash: string;
  }): Promise<AnalysisResult> {
    await this.upsertSnapshot({
      userId: input.userId,
      productId: input.product.id,
      language: input.language,
      withExplanations: input.withExplanations,
      inciHash: input.inciHash,
      productUpdatedAt: productVersionDate(input.product),
      status: IngredientProductAnalysisSnapshotStatus.Pending,
      result: null,
      lastError: null,
      analyzedAt: null,
    });

    try {
      const result = await this.analysisService.analyze({
        products: [toAnalysisProduct(input.product)],
        focusProductId: input.product.id,
        skinProfile: null,
        language: input.language,
        tracking: {
          productId: input.product.id,
          source:
            IngredientAnalysisAiMetricSource.IngredientProductAnalysisWorker,
          userId: input.userId,
        },
        withExplanations: input.withExplanations,
      });
      await this.upsertSnapshot({
        userId: input.userId,
        productId: input.product.id,
        language: input.language,
        withExplanations: input.withExplanations,
        inciHash: input.inciHash,
        productUpdatedAt: productVersionDate(input.product),
        status: statusForResult(result),
        result,
        lastError: null,
        analyzedAt: new Date(),
      });

      return result;
    } catch (error) {
      await this.upsertSnapshot({
        userId: input.userId,
        productId: input.product.id,
        language: input.language,
        withExplanations: input.withExplanations,
        inciHash: input.inciHash,
        productUpdatedAt: productVersionDate(input.product),
        status: IngredientProductAnalysisSnapshotStatus.Failed,
        result: null,
        lastError: errorMessageForSnapshot(error),
        analyzedAt: new Date(),
      });
      throw error;
    }
  }

  private async upsertSnapshot(input: {
    userId: string;
    productId: string;
    language: AppLanguage;
    withExplanations: boolean;
    inciHash: string;
    productUpdatedAt: Date;
    status: IngredientProductAnalysisSnapshotStatus;
    result: AnalysisResult | null;
    lastError: string | null;
    analyzedAt: Date | null;
  }): Promise<void> {
    await this.snapshotsRepository.query(
      `
        INSERT INTO "ingredient_product_analysis_snapshots" (
          "id",
          "user_id",
          "product_id",
          "language",
          "with_explanations",
          "product_updated_at",
          "inci_hash",
          "engine_version",
          "status",
          "result",
          "last_error",
          "requested_at",
          "analyzed_at"
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,now(),$12)
        ON CONFLICT (
          "user_id",
          "product_id",
          "language",
          "with_explanations"
        )
        DO UPDATE SET
          "product_updated_at" = EXCLUDED."product_updated_at",
          "inci_hash" = EXCLUDED."inci_hash",
          "engine_version" = EXCLUDED."engine_version",
          "status" = EXCLUDED."status",
          "result" = EXCLUDED."result",
          "last_error" = EXCLUDED."last_error",
          "requested_at" = EXCLUDED."requested_at",
          "analyzed_at" = EXCLUDED."analyzed_at",
          "updated_at" = now()
        WHERE "ingredient_product_analysis_snapshots"."product_updated_at"
          <= EXCLUDED."product_updated_at"
      `,
      [
        ulid(),
        input.userId,
        input.productId,
        input.language,
        input.withExplanations,
        input.productUpdatedAt,
        input.inciHash,
        ENGINE_VERSION,
        input.status,
        input.result ? JSON.stringify(input.result) : null,
        input.lastError,
        input.analyzedAt,
      ],
    );
  }
}

export function buildProductIngredientAnalysisHash(
  product: InventoryProduct,
): string {
  return hashStableValue('ingredient-product-analysis-snapshot:v1', {
    brand: normalizeHashText(product.brand),
    name: normalizeHashText(product.name),
    category: product.category,
    engineVersion: ENGINE_VERSION,
    inciIngredients: (product.identity?.inciIngredients ?? [])
      .map(normalizeHashText)
      .filter(Boolean),
  });
}

function toAnalysisProduct(product: InventoryProduct): ProductForAnalysis {
  return {
    id: product.id,
    brand: product.brand,
    name: product.name,
    category: product.category,
    inciIngredients: product.identity?.inciIngredients ?? [],
  };
}

function normalizeHashText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function productVersionDate(product: InventoryProduct): Date {
  return product.updated_at ?? product.created_at ?? new Date(0);
}

function statusForResult(
  result: AnalysisResult,
): IngredientProductAnalysisSnapshotStatus {
  return result.status === AnalysisStatus.InsufficientData
    ? IngredientProductAnalysisSnapshotStatus.Partial
    : IngredientProductAnalysisSnapshotStatus.Ready;
}

function errorMessageForSnapshot(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown error';
  return message.slice(0, 500);
}

function buildActiveAnalysisKey(input: {
  userId: string;
  productId: string;
  language: AppLanguage;
  withExplanations: boolean;
  inciHash: string;
}): string {
  return `${input.userId}:${input.productId}:${input.language}:${
    input.withExplanations ? 'explain' : 'plain'
  }:${input.inciHash}`;
}

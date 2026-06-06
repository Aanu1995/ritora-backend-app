import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { AppLanguage } from '../common/i18n/i18n';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { AnalysisService } from './analysis.service';
import { AnalyzeProductsDto } from './dto/analyze-products.dto';
import { IngredientProductAnalysisSnapshotService } from './ingredient-product-analysis-snapshot.service';
import { IngredientAnalysisAiMetricSource } from './ingredient-analysis-ai-usage-metrics';
import type { AnalysisResult, ProductForAnalysis } from './ingredients.types';
import { SkinProfileAnalysisContextService } from './skin-profile-analysis-context.service';

@Injectable()
export class IngredientsService {
  constructor(
    @InjectRepository(InventoryProduct)
    private readonly inventoryRepository: Repository<InventoryProduct>,
    private readonly analysisService: AnalysisService,
    private readonly analysisContext: SkinProfileAnalysisContextService,
    private readonly productAnalysisSnapshots: IngredientProductAnalysisSnapshotService,
  ) {}

  async analyzeForUser(
    userId: string,
    dto: AnalyzeProductsDto,
    language: AppLanguage,
  ): Promise<AnalysisResult> {
    this.validateAnalyzeRequest(dto);

    if (dto.focusProductId) {
      return this.productAnalysisSnapshots.analyzeFocusProductForUser(
        userId,
        dto.focusProductId,
        language,
        dto.withExplanations ?? false,
        { forceRefresh: dto.forceRefresh ?? false },
      );
    }

    const uniqueProductIds = Array.from(new Set(dto.productIds ?? []));
    const [skinProfile, ownedProducts] = await Promise.all([
      this.analysisContext.loadForUser(userId),
      this.inventoryRepository.find({
        where: { id: In(uniqueProductIds), user_id: userId },
      }),
    ]);

    if (ownedProducts.length !== uniqueProductIds.length) {
      throw new BadRequestException(
        'Some selected products are not on your shelf',
      );
    }

    const ownedProductsById = new Map(
      ownedProducts.map((product) => [product.id, product]),
    );
    const orderedOwnedProducts = uniqueProductIds.map((productId) => {
      const product = ownedProductsById.get(productId);
      if (!product) {
        throw new BadRequestException(
          'Some selected products are not on your shelf',
        );
      }

      return product;
    });

    return this.analysisService.analyze({
      products: orderedOwnedProducts.map((product) =>
        this.toAnalysisProduct(product),
      ),
      skinProfile,
      language,
      tracking: {
        source: IngredientAnalysisAiMetricSource.ShelfAnalysis,
        userId,
      },
      withExplanations: dto.withExplanations ?? false,
    });
  }

  private toAnalysisProduct(product: InventoryProduct): ProductForAnalysis {
    return {
      id: product.id,
      brand: product.brand,
      name: product.name,
      category: product.category,
      inciIngredients: product.identity?.inciIngredients ?? [],
    };
  }

  private validateAnalyzeRequest(dto: AnalyzeProductsDto): void {
    const hasFocusProduct = Boolean(dto.focusProductId);
    const hasProductIds = Boolean(dto.productIds?.length);

    if (hasFocusProduct === hasProductIds) {
      throw new BadRequestException(
        'Provide either focusProductId or productIds',
      );
    }
  }
}

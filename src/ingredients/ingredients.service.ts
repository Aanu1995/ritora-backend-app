import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { AppLanguage } from '../common/i18n/i18n';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { AnalysisService } from './analysis.service';
import { AnalyzeProductsDto } from './dto/analyze-products.dto';
import type { AnalysisResult, ProductForAnalysis } from './ingredients.types';
import { SkinProfileAnalysisContextService } from './skin-profile-analysis-context.service';

@Injectable()
export class IngredientsService {
  constructor(
    @InjectRepository(InventoryProduct)
    private readonly inventoryRepository: Repository<InventoryProduct>,
    private readonly analysisService: AnalysisService,
    private readonly analysisContext: SkinProfileAnalysisContextService,
  ) {}

  async analyzeForUser(
    userId: string,
    dto: AnalyzeProductsDto,
    language: AppLanguage,
  ): Promise<AnalysisResult> {
    this.validateAnalyzeRequest(dto);

    if (dto.focusProductId) {
      const [skinProfile, focusProduct] = await Promise.all([
        this.analysisContext.loadForUser(userId),
        this.inventoryRepository.findOne({
          where: {
            id: dto.focusProductId,
            user_id: userId,
          },
        }),
      ]);
      if (!focusProduct) {
        throw new NotFoundException('Inventory product not found');
      }

      // Focus mode is purely educational — we only need the focus product
      // itself. No cross-shelf comparison (that assumption is what the
      // reframe removed).
      return this.analysisService.analyze({
        products: [this.toAnalysisProduct(focusProduct)],
        focusProductId: focusProduct.id,
        skinProfile,
        language,
        withExplanations: dto.withExplanations ?? false,
      });
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

    return this.analysisService.analyze({
      products: ownedProducts.map((product) => this.toAnalysisProduct(product)),
      skinProfile,
      language,
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

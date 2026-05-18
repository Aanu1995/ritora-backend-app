import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AppLanguage } from '../common/i18n/i18n';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { AnalysisService } from './analysis.service';
import { ProductCompareProductsDto } from './dto/compare-products.dto';
import {
  PRODUCT_COMPARE_AI_REVIEW_PORT,
  type ProductCompareAiReviewPort,
} from './product-compare-ai-review.port';
import { unavailableProductCompareAiReview } from './product-compare-ai-review.payload';
import { applyProductCompareAiReview } from './product-compare-ai-guardrails';
import { buildProductCompareDecision } from './product-compare-decision.builder';
import type {
  EvaluatedCompareItem,
  ResolvedCompareItem,
} from './product-compare-internal.types';
import {
  inventoryProductToCompareInput,
  scoreProductCompareItem,
  toProductCompareItemResult,
} from './product-compare-item-mapper';
import {
  buildProductComparePairwiseConflicts,
  buildProductComparePairwiseOverlaps,
} from './product-compare-pairwise';
import {
  ProductCompareGoal,
  ProductCompareItemKind,
  type ProductCompareAiReview,
  type ProductCompareResponse,
} from './product-compare.types';
import {
  ProductCheckPersonalizationLevel,
  type ProductCheckContextSummary,
} from './product-check.types';
import { ProductCheckService } from './product-check.service';
import { SkinProfileAnalysisContextService } from './skin-profile-analysis-context.service';

@Injectable()
export class ProductCompareService {
  private readonly logger = new Logger(ProductCompareService.name);

  constructor(
    private readonly productCheckService: ProductCheckService,
    private readonly analysisService: AnalysisService,
    private readonly analysisContext: SkinProfileAnalysisContextService,
    @InjectRepository(InventoryProduct)
    private readonly inventoryProducts: Repository<InventoryProduct>,
    @Inject(PRODUCT_COMPARE_AI_REVIEW_PORT)
    private readonly aiReviewProvider: ProductCompareAiReviewPort,
  ) {}

  async compareForUser(
    userId: string,
    dto: ProductCompareProductsDto,
    language: AppLanguage,
  ): Promise<ProductCompareResponse> {
    const resolvedItems = await this.resolveItems(userId, dto);
    const goal = this.resolveGoal(dto, resolvedItems);
    this.assertItemsMatchGoal(goal, resolvedItems);

    const skinProfile = await this.analysisContext.loadForUser(userId);
    const excludedShelfProductIds = resolvedItems
      .map((item) => item.productId)
      .filter((productId): productId is string => Boolean(productId));
    const evaluatedItems = await this.evaluateItems(
      userId,
      resolvedItems,
      excludedShelfProductIds,
      language,
    );
    const items = evaluatedItems.map((item) => item.result);
    const context =
      evaluatedItems[0]?.evaluation.response.context ??
      educationalProductCompareContext();
    const pairwiseOverlaps =
      buildProductComparePairwiseOverlaps(evaluatedItems);
    const pairwiseConflicts = await buildProductComparePairwiseConflicts({
      analysisService: this.analysisService,
      items: resolvedItems,
      skinProfile,
      language,
    });
    const deterministicComparison = buildProductCompareDecision({
      goal,
      items: evaluatedItems,
      overlaps: pairwiseOverlaps,
      conflicts: pairwiseConflicts,
      language,
    });
    const aiReview = await this.reviewWithAi({
      language,
      goal,
      context,
      items,
      deterministicComparison,
      pairwiseOverlaps,
      pairwiseConflicts,
    });
    const comparison = applyProductCompareAiReview({
      comparison: deterministicComparison,
      aiReview,
      items: evaluatedItems,
      overlaps: pairwiseOverlaps,
      conflicts: pairwiseConflicts,
      goal,
    });

    this.logComparison({
      aiReview,
      comparison,
      itemCount: items.length,
      goal,
    });

    return {
      goal,
      context,
      items,
      comparison,
      aiReview,
    };
  }

  private async resolveItems(
    userId: string,
    dto: ProductCompareProductsDto,
  ): Promise<ResolvedCompareItem[]> {
    return Promise.all(
      [dto.anchor, ...dto.candidates].map(async (item, index) => {
        const itemId = index === 0 ? 'anchor' : `candidate-${index}`;
        if (item.kind === ProductCompareItemKind.CheckedProduct) {
          if (!item.product) {
            throw new BadRequestException(
              'Checked product payload is required',
            );
          }

          return {
            itemId,
            kind: item.kind,
            productId: null,
            product: item.product,
            isOwnedShelfProduct: false,
          };
        }

        const product = await this.inventoryProducts.findOne({
          where: { id: item.productId as string, user_id: userId },
        });
        if (!product) {
          throw new NotFoundException('Inventory product not found');
        }

        return {
          itemId,
          kind: item.kind,
          productId: product.id,
          product: inventoryProductToCompareInput(product),
          isOwnedShelfProduct: true,
        };
      }),
    );
  }

  private resolveGoal(
    dto: ProductCompareProductsDto,
    items: ResolvedCompareItem[],
  ): ProductCompareGoal {
    if (dto.goal) {
      return dto.goal;
    }

    return items[0]?.kind === ProductCompareItemKind.ShelfProduct
      ? ProductCompareGoal.ShelfRoutineDecision
      : ProductCompareGoal.NewProductDecision;
  }

  private assertItemsMatchGoal(
    goal: ProductCompareGoal,
    items: ResolvedCompareItem[],
  ): void {
    if (goal === ProductCompareGoal.NewProductDecision) {
      const [anchor, ...candidates] = items;
      const valid =
        anchor?.kind === ProductCompareItemKind.CheckedProduct &&
        candidates.every(
          (item) => item.kind === ProductCompareItemKind.ShelfProduct,
        );

      if (!valid) {
        throw new BadRequestException(
          'New product comparison requires a checked product anchor and shelf product candidates',
        );
      }
      return;
    }

    const allShelfProducts = items.every(
      (item) => item.kind === ProductCompareItemKind.ShelfProduct,
    );
    if (!allShelfProducts) {
      throw new BadRequestException(
        'Shelf comparison requires shelf products only',
      );
    }
  }

  private async evaluateItems(
    userId: string,
    items: ResolvedCompareItem[],
    excludedShelfProductIds: readonly string[],
    language: AppLanguage,
  ): Promise<EvaluatedCompareItem[]> {
    return Promise.all(
      items.map(async (item) => {
        const evaluation = await this.productCheckService.evaluateForUser(
          userId,
          item.product,
          language,
          { excludeShelfProductIds: excludedShelfProductIds },
        );
        const result = toProductCompareItemResult(item, evaluation);

        return {
          ...item,
          evaluation,
          result,
          score: scoreProductCompareItem(result),
        };
      }),
    );
  }

  private async reviewWithAi(
    input: Parameters<ProductCompareAiReviewPort['review']>[0],
  ): Promise<ProductCompareAiReview> {
    try {
      return await this.aiReviewProvider.review(input);
    } catch {
      return unavailableProductCompareAiReview();
    }
  }

  private logComparison(input: {
    aiReview: ProductCompareAiReview;
    comparison: ProductCompareResponse['comparison'];
    itemCount: number;
    goal: ProductCompareGoal;
  }): void {
    this.logger.log(
      JSON.stringify({
        event: 'product_compare_completed',
        goal: input.goal,
        outcome: input.comparison.outcome,
        confidence: input.comparison.confidence,
        itemCount: input.itemCount,
        aiReviewStatus: input.aiReview.status,
        hasWinner: Boolean(input.comparison.winnerItemId),
      }),
    );
  }
}

function educationalProductCompareContext(): ProductCheckContextSummary {
  return {
    level: ProductCheckPersonalizationLevel.Educational,
    usedSignals: [],
    missingSignals: [],
    activeShelfProductCount: 0,
    recentJournalReactionCount: 0,
    recentSuggestionReactionCount: 0,
  };
}

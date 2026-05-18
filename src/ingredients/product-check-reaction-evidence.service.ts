import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApplicationItemStatus } from '../application-tracking/application-tracking.constants';
import { ApplicationLogItem } from '../application-tracking/entities/application-log-item.entity';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { SkinJournalEntry } from '../skin-journal/entities/skin-journal-entry.entity';
import {
  UserConsentType,
  UserDataAccessPurpose,
} from '../users/user-consent.constants';
import { UserDataAccessLogService } from '../users/user-data-access-log.service';
import {
  AnalysisConfidence,
  type ProductForAnalysis,
} from './ingredients.types';
import {
  ProductCheckEvidenceKind,
  type ProductCheckReactionEvidence,
} from './product-check.types';
import {
  countReactionSignalsNearUse,
  ingredientOverlapRatio,
  joinProductName,
  normalizeIngredientList,
  normalizeSignal,
  sharedIngredients,
  shiftIsoDate,
} from './product-check.utils';

const RECENT_REACTION_EVIDENCE_LIMIT = 30;
const PRODUCT_USAGE_HISTORY_DAYS = 90;
const SIMILAR_INCI_THRESHOLD = 0.8;
const REACTION_EVIDENCE_LIMIT = 3;

type ProductUsageRow = {
  productId: string;
  targetDate: string;
};

@Injectable()
export class ProductCheckReactionEvidenceService {
  constructor(
    @InjectRepository(SkinJournalEntry)
    private readonly skinJournalEntries: Repository<SkinJournalEntry>,
    @InjectRepository(ApplicationLogItem)
    private readonly applicationLogItems: Repository<ApplicationLogItem>,
    private readonly dataAccessLogService: UserDataAccessLogService,
  ) {}

  async loadForUser(input: {
    userId: string;
    product: ProductForAnalysis;
    activeConsentTypes: ReadonlySet<UserConsentType>;
    inventoryProducts: InventoryProduct[];
    reactionTriggerIngredients: string[];
  }): Promise<ProductCheckReactionEvidence[]> {
    const profileEvidence = buildProfileReactionEvidence(
      input.reactionTriggerIngredients,
    );

    if (!input.activeConsentTypes.has(UserConsentType.SkinProgressProcessing)) {
      return profileEvidence.slice(0, REACTION_EVIDENCE_LIMIT);
    }

    const shelfEvidence = await this.loadShelfReactionEvidence(input);
    return [...profileEvidence, ...shelfEvidence].slice(
      0,
      REACTION_EVIDENCE_LIMIT,
    );
  }

  private async loadShelfReactionEvidence(input: {
    userId: string;
    product: ProductForAnalysis;
    inventoryProducts: InventoryProduct[];
  }): Promise<ProductCheckReactionEvidence[]> {
    const similarShelfProducts = findSimilarShelfProducts(
      input.product,
      input.inventoryProducts,
    );
    if (similarShelfProducts.length === 0) {
      return [];
    }

    const productIds = similarShelfProducts.map((product) => product.id);
    const usageRows = await this.loadProductUsageRows(input.userId, productIds);
    if (usageRows.length === 0) {
      return [];
    }

    const reactionEntries = await this.loadJournalReactionEntriesForEvidence(
      input.userId,
    );
    const evidence = buildShelfReactionEvidence({
      checkedProduct: input.product,
      similarShelfProducts,
      usageRows,
      reactionEntries,
    });

    if (evidence.length > 0) {
      await this.dataAccessLogService.recordDataAccess(
        input.userId,
        [UserConsentType.SkinProgressProcessing],
        UserDataAccessPurpose.RecommendationAnalysis,
      );
    }

    return evidence;
  }

  private async loadProductUsageRows(
    userId: string,
    productIds: string[],
  ): Promise<ProductUsageRow[]> {
    if (productIds.length === 0) {
      return [];
    }

    const sinceDate = shiftIsoDate(new Date(), -PRODUCT_USAGE_HISTORY_DAYS);
    return this.applicationLogItems
      .createQueryBuilder('item')
      .innerJoin('item.application_log', 'log')
      .select(
        'COALESCE(item.substituted_with_product_id, item.inventory_product_id)',
        'productId',
      )
      .addSelect('log.target_date', 'targetDate')
      .where('log.user_id = :userId', { userId })
      .andWhere('log.target_date >= :sinceDate', { sinceDate })
      .andWhere(
        `(
          (item.status = :appliedStatus AND item.inventory_product_id IN (:...productIds))
          OR
          (item.status = :substitutedStatus AND item.substituted_with_product_id IN (:...productIds))
        )`,
        {
          appliedStatus: ApplicationItemStatus.Applied,
          substitutedStatus: ApplicationItemStatus.Substituted,
          productIds,
        },
      )
      .getRawMany<ProductUsageRow>();
  }

  private async loadJournalReactionEntriesForEvidence(
    userId: string,
  ): Promise<SkinJournalEntry[]> {
    return this.skinJournalEntries.find({
      select: {
        id: true,
        entry_date: true,
        has_reaction_signal: true,
      },
      where: { user_id: userId, has_reaction_signal: true },
      order: { entry_date: 'DESC' },
      take: RECENT_REACTION_EVIDENCE_LIMIT,
    });
  }
}

function buildProfileReactionEvidence(
  reactionTriggerIngredients: string[],
): ProductCheckReactionEvidence[] {
  if (reactionTriggerIngredients.length === 0) {
    return [];
  }

  return [
    {
      kind: ProductCheckEvidenceKind.ProfileReactionTrigger,
      confidence: AnalysisConfidence.High,
      productName: null,
      ingredientNames: reactionTriggerIngredients,
      reactionSignalCount: 0,
      usageDaysLast90: null,
    },
  ];
}

function findSimilarShelfProducts(
  product: ProductForAnalysis,
  inventoryProducts: InventoryProduct[],
): InventoryProduct[] {
  return inventoryProducts.filter((shelfProduct) => {
    const shelfBrand = shelfProduct.identity?.brand || shelfProduct.brand;
    const shelfName = shelfProduct.identity?.name || shelfProduct.name;
    const checkedBrand = normalizeSignal(product.brand);
    const checkedName = normalizeSignal(product.name);
    const sameKnownProduct =
      checkedBrand.length > 0 &&
      checkedName.length > 0 &&
      checkedBrand === normalizeSignal(shelfBrand) &&
      checkedName === normalizeSignal(shelfName);

    if (sameKnownProduct) {
      return true;
    }

    const shelfIngredients = normalizeIngredientList(
      shelfProduct.identity?.inciIngredients ?? [],
    );
    const checkedIngredients = normalizeIngredientList(product.inciIngredients);

    return (
      checkedIngredients.length > 0 &&
      ingredientOverlapRatio(checkedIngredients, shelfIngredients) >=
        SIMILAR_INCI_THRESHOLD
    );
  });
}

function buildShelfReactionEvidence(input: {
  checkedProduct: ProductForAnalysis;
  similarShelfProducts: InventoryProduct[];
  usageRows: ProductUsageRow[];
  reactionEntries: SkinJournalEntry[];
}): ProductCheckReactionEvidence[] {
  const evidenceByProduct = new Map<string, ProductCheckReactionEvidence>();

  for (const shelfProduct of input.similarShelfProducts) {
    const productUsageRows = input.usageRows.filter(
      (row) => row.productId === shelfProduct.id,
    );
    const reactionSignalCount = countReactionSignalsNearUse(
      productUsageRows.map((row) => row.targetDate),
      input.reactionEntries,
    );

    if (reactionSignalCount === 0) continue;

    evidenceByProduct.set(shelfProduct.id, {
      kind: ProductCheckEvidenceKind.ShelfReactionSignal,
      confidence: AnalysisConfidence.Medium,
      productName: joinProductName(
        shelfProduct.identity?.brand || shelfProduct.brand,
        shelfProduct.identity?.name || shelfProduct.name,
      ),
      ingredientNames: sharedIngredients(input.checkedProduct, shelfProduct),
      reactionSignalCount,
      usageDaysLast90: new Set(productUsageRows.map((row) => row.targetDate))
        .size,
    });
  }

  return [...evidenceByProduct.values()];
}

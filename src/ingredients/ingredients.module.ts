import { Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApplicationLogItem } from '../application-tracking/entities/application-log-item.entity';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { PlatformGlobalRestrictionsModule } from '../platform-controls/platform-global-restrictions.module';
import { SkinJournalEntry } from '../skin-journal/entities/skin-journal-entry.entity';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { SmartPickProductSuggestion } from '../smart-picks/entities/smart-pick-product-suggestion.entity';
import { SmartPickSnapshot } from '../smart-picks/entities/smart-pick-snapshot.entity';
import { SuggestionInstance } from '../suggestions/entities/suggestion-instance.entity';
import { UserConsent } from '../users/entities/user-consent.entity';
import { UsersModule } from '../users/users.module';
import { AnalysisService } from './analysis.service';
import { IngredientAlias } from './entities/ingredient-alias.entity';
import { IngredientCategoryPattern } from './entities/ingredient-category-pattern.entity';
import { IngredientConflictRule } from './entities/ingredient-conflict-rule.entity';
import { IngredientEntry } from './entities/ingredient-entry.entity';
import { IngredientTranslationCache } from './entities/ingredient-translation-cache.entity';
import { EXPLANATION_PORT } from './explanation.port';
import { IngredientCatalogService } from './ingredient-catalog.service';
import { IngredientsController } from './ingredients.controller';
import { IngredientsService } from './ingredients.service';
import { MatchingService } from './matching.service';
import { OpenAiExplanationProvider } from './openai-explanation.provider';
import { OpenAiProductCompareReviewProvider } from './openai-product-compare-review.provider';
import { OpenAiProductCheckReviewProvider } from './openai-product-check-review.provider';
import { PRODUCT_COMPARE_AI_REVIEW_PORT } from './product-compare-ai-review.port';
import { ProductCompareService } from './product-compare.service';
import { PRODUCT_CHECK_AI_REVIEW_PORT } from './product-check-ai-review.port';
import { ProductCheckContextService } from './product-check-context.service';
import { ProductCheckPurchaseGuidanceService } from './product-check-purchase-guidance.service';
import { ProductCheckReactionEvidenceService } from './product-check-reaction-evidence.service';
import { ProductCheckService } from './product-check.service';
import { ProductVerdictService } from './product-verdict.service';
import { IngredientsSeeder } from './seed/ingredients-seeder';
import { SkinProfileAnalysisContextService } from './skin-profile-analysis-context.service';
import { TranslationService } from './translation.service';

@Module({
  imports: [
    PlatformGlobalRestrictionsModule,
    TypeOrmModule.forFeature([
      InventoryProduct,
      ApplicationLogItem,
      SkinJournalEntry,
      SkinProfile,
      SmartPickSnapshot,
      SmartPickProductSuggestion,
      SuggestionInstance,
      UserConsent,
      IngredientEntry,
      IngredientAlias,
      IngredientCategoryPattern,
      IngredientConflictRule,
      IngredientTranslationCache,
    ]),
    UsersModule,
  ],
  controllers: [IngredientsController],
  providers: [
    IngredientsSeeder,
    IngredientCatalogService,
    TranslationService,
    MatchingService,
    AnalysisService,
    IngredientsService,
    ProductCompareService,
    ProductCheckService,
    ProductCheckContextService,
    ProductCheckReactionEvidenceService,
    ProductCheckPurchaseGuidanceService,
    ProductVerdictService,
    SkinProfileAnalysisContextService,
    OpenAiExplanationProvider,
    OpenAiProductCompareReviewProvider,
    OpenAiProductCheckReviewProvider,
    {
      provide: EXPLANATION_PORT,
      useExisting: OpenAiExplanationProvider,
    },
    {
      provide: PRODUCT_CHECK_AI_REVIEW_PORT,
      useExisting: OpenAiProductCheckReviewProvider,
    },
    {
      provide: PRODUCT_COMPARE_AI_REVIEW_PORT,
      useExisting: OpenAiProductCompareReviewProvider,
    },
  ],
  exports: [MatchingService],
})
export class IngredientsModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(IngredientsModule.name);

  constructor(
    private readonly catalog: IngredientCatalogService,
    private readonly explanationProvider: OpenAiExplanationProvider,
    private readonly productCheckReviewProvider: OpenAiProductCheckReviewProvider,
    private readonly productCompareReviewProvider: OpenAiProductCompareReviewProvider,
  ) {}

  /**
   * The seeder does NOT run here. Migrations + ingredient seeding are
   * handled out-of-band before the app launches (see
   * `npm run migration:run` and `npm run ingredients:seed`). All the app
   * does at boot is load the existing catalogue into the in-memory cache.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.catalog.refresh();
    } catch (error) {
      this.logger.error(
        `Ingredient catalogue refresh failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }

    this.explanationProvider.warnIfMisconfigured();
    this.productCheckReviewProvider.warnIfMisconfigured();
    this.productCompareReviewProvider.warnIfMisconfigured();
  }
}

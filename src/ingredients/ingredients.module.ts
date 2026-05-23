import { Module, type OnApplicationBootstrap } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApplicationLog } from '../application-tracking/entities/application-log.entity';
import { ApplicationLogItem } from '../application-tracking/entities/application-log-item.entity';
import { ApplicationLogVersion } from '../application-tracking/entities/application-log-version.entity';
import { EnvironmentLocationCache } from '../environment-intelligence/entities/environment-location-cache.entity';
import { EnvironmentSnapshot } from '../environment-intelligence/entities/environment-snapshot.entity';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { PlatformGlobalRestrictionsModule } from '../platform-controls/platform-global-restrictions.module';
import { RoutineStep } from '../schedule/entities/routine-step.entity';
import { ScheduleSlot } from '../schedule/entities/schedule-slot.entity';
import { SkinJournalEntry } from '../skin-journal/entities/skin-journal-entry.entity';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { SmartPickProductSuggestion } from '../smart-picks/entities/smart-pick-product-suggestion.entity';
import { SmartPickSnapshot } from '../smart-picks/entities/smart-pick-snapshot.entity';
import { SuggestionInstance } from '../suggestions/entities/suggestion-instance.entity';
import { SuggestionStep } from '../suggestions/entities/suggestion-step.entity';
import { UserConsent } from '../users/entities/user-consent.entity';
import { UsersModule } from '../users/users.module';
import { AnalysisService } from './analysis.service';
import { EXPLANATION_PORT } from './explanation.port';
import { IngredientProductAnalysisJob } from './entities/ingredient-product-analysis-job.entity';
import { INGREDIENT_CLASSIFIER_PORT } from './ingredient-classifier.port';
import { IngredientIntelligenceService } from './ingredient-intelligence.service';
import { IngredientsController } from './ingredients.controller';
import { IngredientsService } from './ingredients.service';
import { IngredientProductAnalysisQueueService } from './ingredient-product-analysis-queue.service';
import { OpenAiExplanationProvider } from './openai-explanation.provider';
import { OpenAiIngredientClassifierProvider } from './openai-ingredient-classifier.provider';
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
import { SkinProfileAnalysisContextService } from './skin-profile-analysis-context.service';
import { TranslationService } from './translation.service';
import { IngredientAiClassificationCacheEntry } from './entities/ingredient-ai-classification-cache-entry.entity';
import { IngredientProductAnalysisSnapshot } from './entities/ingredient-product-analysis-snapshot.entity';
import { IngredientProductAnalysisPreparationService } from './ingredient-product-analysis-preparation.service';
import { IngredientProductAnalysisSnapshotService } from './ingredient-product-analysis-snapshot.service';

@Module({
  imports: [
    PlatformGlobalRestrictionsModule,
    TypeOrmModule.forFeature([
      InventoryProduct,
      ApplicationLog,
      ApplicationLogItem,
      ApplicationLogVersion,
      EnvironmentLocationCache,
      EnvironmentSnapshot,
      RoutineStep,
      ScheduleSlot,
      SkinJournalEntry,
      SkinProfile,
      SmartPickSnapshot,
      SmartPickProductSuggestion,
      SuggestionInstance,
      SuggestionStep,
      UserConsent,
      IngredientAiClassificationCacheEntry,
      IngredientProductAnalysisSnapshot,
      IngredientProductAnalysisJob,
    ]),
    UsersModule,
  ],
  controllers: [IngredientsController],
  providers: [
    IngredientIntelligenceService,
    TranslationService,
    AnalysisService,
    IngredientsService,
    IngredientProductAnalysisQueueService,
    IngredientProductAnalysisSnapshotService,
    IngredientProductAnalysisPreparationService,
    ProductCompareService,
    ProductCheckService,
    ProductCheckContextService,
    ProductCheckReactionEvidenceService,
    ProductCheckPurchaseGuidanceService,
    ProductVerdictService,
    SkinProfileAnalysisContextService,
    OpenAiIngredientClassifierProvider,
    OpenAiExplanationProvider,
    OpenAiProductCompareReviewProvider,
    OpenAiProductCheckReviewProvider,
    {
      provide: INGREDIENT_CLASSIFIER_PORT,
      useExisting: OpenAiIngredientClassifierProvider,
    },
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
  exports: [
    IngredientIntelligenceService,
    IngredientProductAnalysisQueueService,
    IngredientProductAnalysisPreparationService,
    IngredientProductAnalysisSnapshotService,
  ],
})
export class IngredientsModule implements OnApplicationBootstrap {
  constructor(
    private readonly ingredientClassifierProvider: OpenAiIngredientClassifierProvider,
    private readonly explanationProvider: OpenAiExplanationProvider,
    private readonly productCheckReviewProvider: OpenAiProductCheckReviewProvider,
    private readonly productCompareReviewProvider: OpenAiProductCompareReviewProvider,
  ) {}

  onApplicationBootstrap(): void {
    this.explanationProvider.warnIfMisconfigured();
    this.ingredientClassifierProvider.warnIfMisconfigured();
    this.productCheckReviewProvider.warnIfMisconfigured();
    this.productCompareReviewProvider.warnIfMisconfigured();
  }
}

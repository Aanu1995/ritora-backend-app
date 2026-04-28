import { Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
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
import { IngredientsSeeder } from './seed/ingredients-seeder';
import { TranslationService } from './translation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InventoryProduct,
      SkinProfile,
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
    OpenAiExplanationProvider,
    {
      provide: EXPLANATION_PORT,
      useExisting: OpenAiExplanationProvider,
    },
  ],
})
export class IngredientsModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(IngredientsModule.name);

  constructor(
    private readonly catalog: IngredientCatalogService,
    private readonly explanationProvider: OpenAiExplanationProvider,
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
  }
}

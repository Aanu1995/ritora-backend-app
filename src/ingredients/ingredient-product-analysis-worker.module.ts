import { Module } from '@nestjs/common';
import { IngredientsModule } from './ingredients.module';
import { IngredientProductAnalysisWorkerRuntimeModule } from './ingredient-product-analysis-worker-runtime.module';
import { IngredientProductAnalysisWorkerService } from './ingredient-product-analysis-worker.service';

@Module({
  imports: [IngredientProductAnalysisWorkerRuntimeModule, IngredientsModule],
  providers: [IngredientProductAnalysisWorkerService],
})
export class IngredientProductAnalysisWorkerModule {}

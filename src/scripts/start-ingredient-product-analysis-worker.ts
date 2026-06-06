import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IngredientProductAnalysisWorkerModule } from '../ingredients/ingredient-product-analysis-worker.module';

async function main(): Promise<void> {
  const logger = new Logger('IngredientProductAnalysisWorker');
  const app = await NestFactory.createApplicationContext(
    IngredientProductAnalysisWorkerModule,
    {
      bufferLogs: true,
    },
  );
  app.useLogger(new Logger());
  app.enableShutdownHooks();
  logger.log('Ingredient product analysis worker started.');
}

main().catch((error) => {
  console.error(
    `Ingredient product analysis worker failed: ${
      error instanceof Error ? (error.stack ?? error.message) : 'unknown error'
    }`,
  );
  process.exit(1);
});

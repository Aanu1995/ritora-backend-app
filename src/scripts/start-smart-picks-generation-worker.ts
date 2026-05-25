import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SmartPicksGenerationWorkerModule } from '../smart-picks/smart-picks-generation-worker.module';

async function main(): Promise<void> {
  const logger = new Logger('SmartPicksGenerationWorker');
  const app = await NestFactory.createApplicationContext(
    SmartPicksGenerationWorkerModule,
    {
      bufferLogs: true,
    },
  );
  app.useLogger(new Logger());
  app.enableShutdownHooks();
  logger.log('Smart Picks generation worker started.');
}

main().catch((error) => {
  console.error(
    `Smart Picks generation worker failed: ${
      error instanceof Error ? (error.stack ?? error.message) : 'unknown error'
    }`,
  );
  process.exit(1);
});

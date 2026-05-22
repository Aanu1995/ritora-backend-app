import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SkinJournalAnalysisWorkerModule } from '../skin-journal/skin-journal-analysis-worker.module';

async function main(): Promise<void> {
  const logger = new Logger('SkinJournalAnalysisWorker');
  const app = await NestFactory.createApplicationContext(
    SkinJournalAnalysisWorkerModule,
    {
      bufferLogs: true,
    },
  );
  app.useLogger(new Logger());
  app.enableShutdownHooks();
  logger.log('Skin Journal analysis worker started.');
}

main().catch((error) => {
  console.error(
    `Skin Journal analysis worker failed: ${
      error instanceof Error ? (error.stack ?? error.message) : 'unknown error'
    }`,
  );
  process.exit(1);
});

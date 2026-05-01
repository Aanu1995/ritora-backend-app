import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SkinJournalInsightWorkerModule } from '../skin-journal/skin-journal-insight-worker.module';

async function main(): Promise<void> {
  const logger = new Logger('SkinJournalInsightWorker');
  const app = await NestFactory.createApplicationContext(
    SkinJournalInsightWorkerModule,
    {
      bufferLogs: true,
    },
  );
  app.useLogger(new Logger());
  app.enableShutdownHooks();
  logger.log('Skin Journal insight worker started.');
}

main().catch((error) => {
  console.error(
    `Skin Journal insight worker failed: ${
      error instanceof Error ? (error.stack ?? error.message) : 'unknown error'
    }`,
  );
  process.exit(1);
});

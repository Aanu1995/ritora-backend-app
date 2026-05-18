import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AccountDeletionWorkerModule } from '../auth/account-deletion-worker.module';

async function main(): Promise<void> {
  const logger = new Logger('AccountDeletionWorker');
  const app = await NestFactory.createApplicationContext(
    AccountDeletionWorkerModule,
    {
      bufferLogs: true,
    },
  );
  app.useLogger(new Logger());
  app.enableShutdownHooks();
  logger.log('Account deletion worker started.');
}

main().catch((error) => {
  console.error(
    `Account deletion worker failed: ${
      error instanceof Error ? (error.stack ?? error.message) : 'unknown error'
    }`,
  );
  process.exit(1);
});

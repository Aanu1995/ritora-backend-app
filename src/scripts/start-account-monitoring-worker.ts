import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AdminAccountMonitoringWorkerModule } from '../admin/admin-account-monitoring-worker.module';

async function main(): Promise<void> {
  const logger = new Logger('AccountMonitoringWorker');
  const app = await NestFactory.createApplicationContext(
    AdminAccountMonitoringWorkerModule,
    {
      bufferLogs: true,
    },
  );
  app.useLogger(new Logger());
  app.enableShutdownHooks();
  logger.log('Account monitoring worker started.');
}

main().catch((error) => {
  console.error(
    `Account monitoring worker failed: ${
      error instanceof Error ? (error.stack ?? error.message) : 'unknown error'
    }`,
  );
  process.exit(1);
});

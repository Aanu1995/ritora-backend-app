import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { getNumberConfig } from './config/config-value.utils';

export async function bootstrapApplication(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const configService = app.get(ConfigService);

  app.useLogger(app.get(Logger));
  configureApp(app, configService);
  app.enableShutdownHooks();

  const port = getNumberConfig(configService, 'API_PORT');
  await app.listen(port);
}

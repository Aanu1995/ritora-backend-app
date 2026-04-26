import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { getNumberConfig } from './config/config-value.utils';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  configureApp(app, configService);
  app.enableShutdownHooks();

  const port = getNumberConfig(configService, 'API_PORT', 3001);
  await app.listen(port);
}

void bootstrap();

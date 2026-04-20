import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import {
  CATALOGUE_MEDIA_ROUTE,
  resolveCatalogueMediaRootDir,
} from './catalogue/catalogue-media.constants';

function parseCorsOrigins(configService: ConfigService): string[] {
  const configuredOrigins =
    configService.get<string>('CORS_ORIGINS')?.trim() ||
    configService.get<string>('FRONTEND_URL', 'http://localhost:3000');

  return Array.from(
    new Set(
      configuredOrigins
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
        .map((origin) => new URL(origin).origin),
    ),
  );
}

export function configureApp(
  app: INestApplication,
  configService: ConfigService,
): void {
  const corsOrigins = parseCorsOrigins(configService);

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  const expressApp = app.getHttpAdapter().getInstance() as Express;
  const isProduction = configService.get<string>('NODE_ENV') === 'production';

  if (isProduction) {
    expressApp.set('trust proxy', 1);
  }

  expressApp.disable('x-powered-by');
  expressApp.use(
    CATALOGUE_MEDIA_ROUTE,
    express.static(resolveCatalogueMediaRootDir()),
  );

  const swaggerEnabled = configService.get<boolean>(
    'SWAGGER_ENABLED',
    !isProduction,
  );

  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Ritora API')
      .setDescription(
        'Backend API for Ritora, the AI-powered skincare decision support platform.',
      )
      .setVersion('0.1.0')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);

    SwaggerModule.setup('api/docs', app, document, {
      jsonDocumentUrl: 'api/docs-json',
    });
  }
}

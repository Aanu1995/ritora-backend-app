import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import helmet from 'helmet';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';

export function configureApp(
  app: INestApplication,
  configService: ConfigService,
): void {
  const corsOrigins = configService
    .get<string>('CORS_ORIGINS', 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
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

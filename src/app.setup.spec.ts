import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { configureApp } from './app.setup';

type MockApp = {
  use: jest.Mock;
  enableCors: jest.Mock;
  setGlobalPrefix: jest.Mock;
  useGlobalPipes: jest.Mock<void, [unknown]>;
  useGlobalFilters: jest.Mock<void, [unknown]>;
  getHttpAdapter: jest.Mock;
};

describe('configureApp', () => {
  const createApp = () => {
    const disable = jest.fn();
    const set = jest.fn();
    const expressUse = jest.fn();

    const app: MockApp = {
      use: jest.fn(),
      enableCors: jest.fn(),
      setGlobalPrefix: jest.fn(),
      useGlobalPipes: jest.fn<void, [unknown]>(),
      useGlobalFilters: jest.fn<void, [unknown]>(),
      getHttpAdapter: jest.fn(() => ({
        getInstance: () => ({ disable, set, use: expressUse }),
      })),
    };

    return { app, disable, set, expressUse };
  };

  const createConfigService = (
    overrides: Record<string, boolean | string> = {},
  ) =>
    ({
      get: jest.fn((key: string) => overrides[key]),
      getOrThrow: jest.fn((key: string) => {
        if (key in overrides) {
          return overrides[key];
        }
        throw new Error(`Missing config ${key}`);
      }),
    }) as unknown as ConfigService;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('configures middleware, cors, prefix, validation, filters, and swagger', () => {
    const { app, disable, expressUse } = createApp();
    const configService = createConfigService({
      CORS_ORIGINS: 'http://localhost:3000, https://ritora.com',
      NODE_ENV: 'development',
      SWAGGER_ENABLED: true,
    });
    const createDocumentSpy = jest
      .spyOn(SwaggerModule, 'createDocument')
      .mockReturnValue({} as ReturnType<typeof SwaggerModule.createDocument>);
    const setupSpy = jest.spyOn(SwaggerModule, 'setup').mockImplementation();

    configureApp(app as unknown as INestApplication, configService);

    expect(app.use).toHaveBeenCalledTimes(2);
    expect(app.enableCors).toHaveBeenCalledWith({
      origin: ['http://localhost:3000', 'https://ritora.com'],
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Accept-Language',
        'X-Timezone',
        'X-Time-Zone',
      ],
      maxAge: 86400,
    });
    expect(app.setGlobalPrefix).toHaveBeenCalledWith('api/v1');

    const validationPipe = app.useGlobalPipes.mock.calls[0][0];
    expect(validationPipe).toBeInstanceOf(ValidationPipe);

    const filter = app.useGlobalFilters.mock.calls[0][0];
    expect(filter).toBeInstanceOf(GlobalExceptionFilter);

    expect(disable).toHaveBeenCalledWith('x-powered-by');
    expect(expressUse).toHaveBeenCalledWith('/media', expect.any(Function));
    expect(expressUse).not.toHaveBeenCalledWith(
      '/static/skin-journal',
      expect.any(Function),
    );
    expect(createDocumentSpy).toHaveBeenCalled();
    expect(setupSpy).toHaveBeenCalledWith(
      'api/docs',
      app,
      expect.any(Object),
      expect.objectContaining({ jsonDocumentUrl: 'api/docs-json' }),
    );
  });

  it('skips swagger setup when disabled', () => {
    const { app } = createApp();
    const configService = createConfigService({
      CORS_ORIGINS: 'http://localhost:3000',
      NODE_ENV: 'development',
      SWAGGER_ENABLED: false,
    });
    const createDocumentSpy = jest.spyOn(SwaggerModule, 'createDocument');
    const setupSpy = jest.spyOn(SwaggerModule, 'setup');

    configureApp(app as unknown as INestApplication, configService);

    expect(createDocumentSpy).not.toHaveBeenCalled();
    expect(setupSpy).not.toHaveBeenCalled();
  });

  it('skips swagger setup when production config disables it', () => {
    const { app, set } = createApp();
    const configService = createConfigService({
      CORS_ORIGINS: 'https://ritora.com',
      NODE_ENV: 'production',
      SWAGGER_ENABLED: false,
    });
    const createDocumentSpy = jest.spyOn(SwaggerModule, 'createDocument');
    const setupSpy = jest.spyOn(SwaggerModule, 'setup');

    configureApp(app as unknown as INestApplication, configService);

    expect(set).toHaveBeenCalledWith('trust proxy', 1);
    expect(createDocumentSpy).not.toHaveBeenCalled();
    expect(setupSpy).not.toHaveBeenCalled();
  });
});

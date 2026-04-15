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
  useGlobalPipes: jest.Mock;
  useGlobalFilters: jest.Mock;
  getHttpAdapter: jest.Mock;
};

describe('configureApp', () => {
  const createApp = () => {
    const disable = jest.fn();

    const app: MockApp = {
      use: jest.fn(),
      enableCors: jest.fn(),
      setGlobalPrefix: jest.fn(),
      useGlobalPipes: jest.fn(),
      useGlobalFilters: jest.fn(),
      getHttpAdapter: jest.fn(() => ({
        getInstance: () => ({ disable }),
      })),
    };

    return { app, disable };
  };

  const createConfigService = (
    overrides: Record<string, boolean | string> = {},
  ) =>
    ({
      get: jest.fn((key: string, fallback?: boolean | string) =>
        key in overrides ? overrides[key] : fallback,
      ),
    }) as unknown as ConfigService;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('configures middleware, cors, prefix, validation, filters, and swagger', () => {
    const { app, disable } = createApp();
    const configService = createConfigService({
      CORS_ORIGINS: 'http://localhost:3000, https://ritora.com',
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
    });
    expect(app.setGlobalPrefix).toHaveBeenCalledWith('api/v1');

    const validationPipe = (app.useGlobalPipes as jest.Mock).mock.calls[0][0];
    expect(validationPipe).toBeInstanceOf(ValidationPipe);

    const filter = (app.useGlobalFilters as jest.Mock).mock.calls[0][0];
    expect(filter).toBeInstanceOf(GlobalExceptionFilter);

    expect(disable).toHaveBeenCalledWith('x-powered-by');
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
    const configService = createConfigService({ SWAGGER_ENABLED: false });
    const createDocumentSpy = jest.spyOn(SwaggerModule, 'createDocument');
    const setupSpy = jest.spyOn(SwaggerModule, 'setup');

    configureApp(app as unknown as INestApplication, configService);

    expect(createDocumentSpy).not.toHaveBeenCalled();
    expect(setupSpy).not.toHaveBeenCalled();
  });
});

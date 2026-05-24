import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { getNumberConfig } from './config/config-value.utils';
import { bootstrapApplication } from './bootstrap';

jest.mock('@nestjs/core', () => ({
  NestFactory: {
    create: jest.fn(),
  },
}));

jest.mock('./app.module', () => ({
  AppModule: class MockAppModule {},
}));

jest.mock('./app.setup', () => ({
  configureApp: jest.fn(),
}));

jest.mock('./config/config-value.utils', () => ({
  getNumberConfig: jest.fn(),
}));

describe('bootstrapApplication', () => {
  it('creates, configures, and starts the Nest application', async () => {
    const configService = { get: jest.fn() };
    const logger = { logger: true };
    const app = {
      enableShutdownHooks: jest.fn(),
      get: jest.fn((token: unknown) => {
        if (token === Logger) return logger;
        return configService;
      }),
      listen: jest.fn().mockResolvedValue(undefined),
      useLogger: jest.fn(),
    };

    jest.mocked(NestFactory.create).mockResolvedValue(app as never);
    jest.mocked(getNumberConfig).mockReturnValue(3001);

    await bootstrapApplication();

    expect(NestFactory.create).toHaveBeenCalledWith(AppModule, {
      bufferLogs: true,
    });
    expect(app.useLogger).toHaveBeenCalledWith(logger);
    expect(configureApp).toHaveBeenCalledWith(app, configService);
    expect(app.enableShutdownHooks).toHaveBeenCalledTimes(1);
    expect(getNumberConfig).toHaveBeenCalledWith(configService, 'API_PORT');
    expect(app.listen).toHaveBeenCalledWith(3001);
  });
});

import { ConfigService } from '@nestjs/config';
import { databaseConfig } from './database.config';

function createConfigService(
  overrides: Record<string, string | number | boolean>,
): ConfigService {
  return {
    get: jest.fn((key: string) => overrides[key]),
  } as unknown as ConfigService;
}

describe('databaseConfig', () => {
  it('enables strict SSL verification when configured', () => {
    const configService = createConfigService({
      DATABASE_HOST: 'localhost',
      DATABASE_PORT: 5432,
      DATABASE_NAME: 'ritora',
      DATABASE_USER: 'postgres',
      DATABASE_PASSWORD: 'password',
      DATABASE_SSL: true,
      DATABASE_SSL_REJECT_UNAUTHORIZED: true,
      NODE_ENV: 'production',
    });

    const options = databaseConfig.useFactory?.(configService) as {
      ssl: false | { rejectUnauthorized: boolean };
      logging: boolean;
    };

    expect(options.ssl).toEqual({ rejectUnauthorized: true });
    expect(options.logging).toBe(false);
  });

  it('disables SSL and query logging by default in development', () => {
    const configService = createConfigService({
      DATABASE_HOST: 'localhost',
      DATABASE_PORT: 5432,
      DATABASE_NAME: 'ritora',
      DATABASE_USER: 'postgres',
      DATABASE_PASSWORD: 'password',
      DATABASE_SSL: false,
      DATABASE_SSL_REJECT_UNAUTHORIZED: false,
      NODE_ENV: 'development',
    });

    const options = databaseConfig.useFactory?.(configService) as {
      ssl: false | { rejectUnauthorized: boolean };
      logging: boolean;
    };

    expect(options.ssl).toBe(false);
    expect(options.logging).toBe(false);
  });

  it('enables query logging only when explicitly configured', () => {
    const configService = createConfigService({
      DATABASE_HOST: 'localhost',
      DATABASE_PORT: 5432,
      DATABASE_NAME: 'ritora',
      DATABASE_USER: 'postgres',
      DATABASE_PASSWORD: 'password',
      DATABASE_SSL: false,
      DATABASE_LOGGING: true,
      NODE_ENV: 'development',
    });

    const options = databaseConfig.useFactory?.(configService) as {
      logging: boolean;
    };

    expect(options.logging).toBe(true);
  });
});

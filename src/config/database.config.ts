import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleAsyncOptions } from '@nestjs/typeorm';
import { getBooleanConfig, getNumberConfig } from './config-value.utils';

const POOL_MAX_CONNECTIONS = 20;
const POOL_CONNECTION_TIMEOUT_MS = 5000;
const POOL_IDLE_TIMEOUT_MS = 30000;
const STATEMENT_TIMEOUT_MS = 30000;
const IDLE_IN_TRANSACTION_TIMEOUT_MS = 60000;

export const databaseConfig: TypeOrmModuleAsyncOptions = {
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
    const databaseSslEnabled = getBooleanConfig(configService, 'DATABASE_SSL');
    const rejectUnauthorized = getBooleanConfig(
      configService,
      'DATABASE_SSL_REJECT_UNAUTHORIZED',
    );
    const databaseLoggingEnabled = getBooleanConfig(
      configService,
      'DATABASE_LOGGING',
    );

    return {
      type: 'postgres',
      host: configService.getOrThrow<string>('DATABASE_HOST'),
      port: getNumberConfig(configService, 'DATABASE_PORT'),
      database: configService.getOrThrow<string>('DATABASE_NAME'),
      username: configService.getOrThrow<string>('DATABASE_USER'),
      password: configService.getOrThrow<string>('DATABASE_PASSWORD'),
      ssl: databaseSslEnabled ? { rejectUnauthorized } : false,
      autoLoadEntities: true,
      synchronize: false,
      migrationsRun: false,
      migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
      logging: databaseLoggingEnabled,
      extra: {
        max: POOL_MAX_CONNECTIONS,
        connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
        idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
        statement_timeout: STATEMENT_TIMEOUT_MS,
        idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
      },
    };
  },
};

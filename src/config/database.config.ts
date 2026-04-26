import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleAsyncOptions } from '@nestjs/typeorm';
import { getBooleanConfig, getNumberConfig } from './config-value.utils';

export const databaseConfig: TypeOrmModuleAsyncOptions = {
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
    const databaseSslEnabled = getBooleanConfig(
      configService,
      'DATABASE_SSL',
      false,
    );
    const rejectUnauthorized = getBooleanConfig(
      configService,
      'DATABASE_SSL_REJECT_UNAUTHORIZED',
      false,
    );
    const databaseLoggingEnabled = getBooleanConfig(
      configService,
      'DATABASE_LOGGING',
      false,
    );

    return {
      type: 'postgres',
      host: configService.get<string>('DATABASE_HOST'),
      port: getNumberConfig(configService, 'DATABASE_PORT', 5432),
      database: configService.get<string>('DATABASE_NAME'),
      username: configService.get<string>('DATABASE_USER'),
      password: String(configService.get('DATABASE_PASSWORD') ?? ''),
      ssl: databaseSslEnabled ? { rejectUnauthorized } : false,
      autoLoadEntities: true,
      synchronize: false,
      migrationsRun: false,
      migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
      logging: databaseLoggingEnabled,
    };
  },
};

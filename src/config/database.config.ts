import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleAsyncOptions } from '@nestjs/typeorm';
import { getBooleanConfig, getNumberConfig } from './config-value.utils';

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
    };
  },
};

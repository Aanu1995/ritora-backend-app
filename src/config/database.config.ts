import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleAsyncOptions } from '@nestjs/typeorm';

export const databaseConfig: TypeOrmModuleAsyncOptions = {
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
    const databaseSslEnabled = configService.get<boolean>('DATABASE_SSL');
    const rejectUnauthorized = configService.get<boolean>(
      'DATABASE_SSL_REJECT_UNAUTHORIZED',
      false,
    );

    return {
      type: 'postgres',
      host: configService.get<string>('DATABASE_HOST'),
      port: configService.get<number>('DATABASE_PORT'),
      database: configService.get<string>('DATABASE_NAME'),
      username: configService.get<string>('DATABASE_USER'),
      password: String(configService.get('DATABASE_PASSWORD') ?? ''),
      ssl: databaseSslEnabled ? { rejectUnauthorized } : false,
      autoLoadEntities: true,
      synchronize: false,
      migrationsRun: false,
      migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
      logging: configService.get<string>('NODE_ENV') === 'development',
    };
  },
};

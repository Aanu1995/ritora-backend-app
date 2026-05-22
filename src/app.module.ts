import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { AuthenticatedTimezoneCaptureInterceptor } from './common/interceptors/authenticated-timezone-capture.interceptor';
import { NoCacheInterceptor } from './common/interceptors/no-cache.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { databaseConfig } from './config/database.config';
import { AppConfigModule } from './config/app-config.module';
import { buildPinoHttpOptions } from './observability/logging.config';
import { HttpRequestMetricsInterceptor } from './observability/http-request-metrics.interceptor';
import { AdminModule } from './admin/admin.module';
import { AppBadgesModule } from './app-badges/app-badges.module';
import { ApplicationTrackingModule } from './application-tracking/application-tracking.module';
import { AuthModule } from './auth/auth.module';
import { CatalogueModule } from './catalogue/catalogue.module';
import { HealthModule } from './health/health.module';
import { IngredientsModule } from './ingredients/ingredients.module';
import { InventoryModule } from './inventory/inventory.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ScheduleModule } from './schedule/schedule.module';
import { SkinJournalModule } from './skin-journal/skin-journal.module';
import { SkinProfileModule } from './skin-profile/skin-profile.module';
import { SmartPicksModule } from './smart-picks/smart-picks.module';
import { SuggestionsModule } from './suggestions/suggestions.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        pinoHttp: buildPinoHttpOptions(configService),
      }),
    }),
    TypeOrmModule.forRootAsync(databaseConfig),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    AdminModule,
    AppBadgesModule,
    ApplicationTrackingModule,
    HealthModule,
    AuthModule,
    CatalogueModule,
    IngredientsModule,
    InventoryModule,
    NotificationsModule,
    ScheduleModule,
    SkinJournalModule,
    SkinProfileModule,
    SmartPicksModule,
    SuggestionsModule,
    UsersModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuthenticatedTimezoneCaptureInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: NoCacheInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpRequestMetricsInterceptor,
    },
  ],
})
export class AppModule {}

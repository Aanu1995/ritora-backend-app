import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { OriginCheckGuard } from '../common/guards/origin-check.guard';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { SkinJournalModule } from '../skin-journal/skin-journal.module';
import { SmartPickProductSuggestion } from '../smart-picks/entities/smart-pick-product-suggestion.entity';
import { SmartPickSnapshot } from '../smart-picks/entities/smart-pick-snapshot.entity';
import { SuggestionGapAction } from '../suggestions/entities/suggestion-gap-action.entity';
import { AccountMonitoringEvent } from '../users/entities/account-monitoring-event.entity';
import { UserConsent } from '../users/entities/user-consent.entity';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../mail/mail.module';
import { PlatformGlobalRestrictionsModule } from '../platform-controls/platform-global-restrictions.module';
import { AuthController } from './auth.controller';
import { AccountDeletionSchedulerService } from './account-deletion-scheduler.service';
import { AuthService } from './auth.service';
import { AuthSession } from './entities/auth-session.entity';
import { AppleOAuthCallbackGuard } from './guards/apple-oauth-callback.guard';
import { AppleOAuthGuard } from './guards/apple-oauth.guard';
import { GoogleOAuthCallbackGuard } from './guards/google-oauth-callback.guard';
import { GoogleOAuthGuard } from './guards/google-oauth.guard';
import { AppleStrategy } from './strategies/apple.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          issuer: configService.getOrThrow<string>('JWT_ISSUER'),
          audience: configService.getOrThrow<string>('JWT_AUDIENCE'),
        },
      }),
    }),
    TypeOrmModule.forFeature([
      AuthSession,
      UserConsent,
      SkinProfile,
      SmartPickSnapshot,
      SmartPickProductSuggestion,
      SuggestionGapAction,
      AccountMonitoringEvent,
      InventoryProduct,
    ]),
    CatalogueModule,
    PlatformGlobalRestrictionsModule,
    UsersModule,
    MailModule,
    SkinJournalModule,
  ],
  controllers: [AuthController],
  providers: [
    AccountDeletionSchedulerService,
    AuthService,
    AppleOAuthGuard,
    AppleOAuthCallbackGuard,
    GoogleOAuthGuard,
    GoogleOAuthCallbackGuard,
    AppleStrategy,
    GoogleStrategy,
    JwtStrategy,
    OriginCheckGuard,
  ],
  exports: [AuthService, AccountDeletionSchedulerService],
})
export class AuthModule {}

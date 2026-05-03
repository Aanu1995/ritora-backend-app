import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { SkinJournalModule } from '../skin-journal/skin-journal.module';
import { UserConsent } from '../users/entities/user-consent.entity';
import { UsersModule } from '../users/users.module';
import { MailModule } from '../mail/mail.module';
import { AuthController } from './auth.controller';
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
    TypeOrmModule.forFeature([AuthSession, UserConsent, SkinProfile]),
    UsersModule,
    MailModule,
    SkinJournalModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AppleOAuthGuard,
    AppleOAuthCallbackGuard,
    GoogleOAuthGuard,
    GoogleOAuthCallbackGuard,
    AppleStrategy,
    GoogleStrategy,
    JwtStrategy,
  ],
})
export class AuthModule {}

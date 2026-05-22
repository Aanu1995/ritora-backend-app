import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-google-oauth20';
import { OAuthIdentityProfile, OAuthProvider } from '../oauth/oauth-profile';

const GOOGLE_AUTH_SCOPE = ['profile', 'email'];

@Injectable()
export class GoogleStrategy extends PassportStrategy(
  Strategy,
  OAuthProvider.Google,
) {
  constructor(configService: ConfigService) {
    super({
      clientID: configService.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      clientSecret: configService.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL: configService.getOrThrow<string>('GOOGLE_CALLBACK_URL'),
      scope: GOOGLE_AUTH_SCOPE,
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
  ): OAuthIdentityProfile {
    const email = profile._json.email ?? profile.emails?.[0]?.value;
    const emailVerified =
      profile._json.email_verified === true ||
      profile.emails?.some((entry) => entry.verified === true) === true;

    if (!profile.id || !email || !emailVerified) {
      throw new UnauthorizedException('Invalid Google profile');
    }

    return {
      provider: OAuthProvider.Google,
      providerSubject: profile.id,
      email,
      emailVerified,
      firstName: this.resolveNamePart(profile._json.given_name, email),
      lastName: this.resolveNamePart(profile._json.family_name, ''),
      isEmailAuthoritative: this.isAuthoritativeEmail(email, profile._json.hd),
    };
  }

  private resolveNamePart(value: string | undefined, fallback: string): string {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed.slice(0, 100);
    }

    const fallbackName = fallback.split('@')[0]?.trim() || 'Ritora';
    return fallbackName.slice(0, 100);
  }

  private isAuthoritativeEmail(email: string, hostedDomain?: string): boolean {
    if (email.trim().toLowerCase().endsWith('@gmail.com')) {
      return true;
    }

    return Boolean(hostedDomain?.trim());
  }
}

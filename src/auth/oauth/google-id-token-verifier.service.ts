import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { OAuthIdentityProfile, OAuthProvider } from './oauth-profile';

export const GOOGLE_ID_TOKEN_CLIENT = Symbol('GOOGLE_ID_TOKEN_CLIENT');

type GoogleIdTokenPayload = {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  given_name?: unknown;
  family_name?: unknown;
  hd?: unknown;
};

type GoogleIdTokenTicket = {
  getPayload(): GoogleIdTokenPayload | undefined;
};

export interface GoogleIdTokenClient {
  verifyIdToken(options: {
    idToken: string;
    audience: string[];
  }): Promise<GoogleIdTokenTicket>;
}

@Injectable()
export class GoogleIdTokenVerifierService {
  private readonly audiences: string[];

  constructor(
    configService: ConfigService,
    @Inject(GOOGLE_ID_TOKEN_CLIENT)
    private readonly client: GoogleIdTokenClient,
  ) {
    this.audiences = configService
      .getOrThrow<string>('GOOGLE_ID_TOKEN_AUDIENCES')
      .split(',')
      .map((audience) => audience.trim())
      .filter(Boolean);
  }

  async verify(idToken: string): Promise<OAuthIdentityProfile> {
    const trimmedToken = idToken.trim();
    if (!trimmedToken) {
      throw new UnauthorizedException('Invalid Google sign-in token');
    }

    try {
      const ticket = await this.client.verifyIdToken({
        idToken: trimmedToken,
        audience: this.audiences,
      });

      return this.toOAuthProfile(ticket.getPayload());
    } catch {
      throw new UnauthorizedException('Invalid Google sign-in token');
    }
  }

  private toOAuthProfile(
    payload: GoogleIdTokenPayload | undefined,
  ): OAuthIdentityProfile {
    const providerSubject = this.requiredString(payload?.sub);
    const email = this.requiredString(payload?.email);
    const emailVerified = payload?.email_verified === true;

    if (!providerSubject || !email || !emailVerified) {
      throw new UnauthorizedException('Invalid Google sign-in token');
    }

    return {
      provider: OAuthProvider.Google,
      providerSubject,
      email,
      emailVerified,
      firstName: this.resolveNamePart(
        this.optionalString(payload?.given_name),
        email,
      ),
      lastName: this.resolveNamePart(
        this.optionalString(payload?.family_name),
        '',
      ),
      isEmailAuthoritative: this.isAuthoritativeEmail(
        email,
        this.optionalString(payload?.hd),
      ),
    };
  }

  private requiredString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private optionalString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
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

export function createGoogleIdTokenClient(): GoogleIdTokenClient {
  return new OAuth2Client();
}

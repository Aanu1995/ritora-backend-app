import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { createPublicKey, type JsonWebKey } from 'crypto';
import { Request } from 'express';
import { decode, verify, type JwtPayload } from 'jsonwebtoken';
import AppleStrategyPackage from 'passport-apple';
import { OAuthIdentityProfile, OAuthProvider } from '../oauth/oauth-profile';

type ApplePostedProfile = {
  name?: {
    firstName?: unknown;
    lastName?: unknown;
  };
};

type AppleProfileRequest = Request & {
  appleProfile?: ApplePostedProfile;
};

const AppleStrategyBase = AppleStrategyPackage.Strategy;
const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_JWKS_CACHE_MS = 6 * 60 * 60 * 1000;

type AppleJwtPayload = JwtPayload & {
  email?: unknown;
  email_verified?: unknown;
};

type AppleJwk = Record<string, unknown> & {
  kid?: string;
};

type AppleJwksResponse = {
  keys?: AppleJwk[];
};

@Injectable()
export class AppleStrategy extends PassportStrategy(
  AppleStrategyBase,
  OAuthProvider.Apple,
) {
  private static cachedPublicKeys = new Map<string, string>();
  private static cachedPublicKeysExpiresAt = 0;
  private readonly clientId: string;

  constructor(configService: ConfigService) {
    const clientId = configService.getOrThrow<string>('APPLE_CLIENT_ID');
    super({
      clientID: clientId,
      teamID: configService.getOrThrow<string>('APPLE_TEAM_ID'),
      keyID: configService.getOrThrow<string>('APPLE_KEY_ID'),
      privateKeyString: configService
        .getOrThrow<string>('APPLE_PRIVATE_KEY')
        .replace(/\\n/g, '\n'),
      callbackURL: configService.getOrThrow<string>('APPLE_CALLBACK_URL'),
      passReqToCallback: true,
    });
    this.clientId = clientId;
  }

  async validate(
    req: AppleProfileRequest,
    _accessToken: string,
    _refreshToken: string,
    idToken: string,
  ): Promise<OAuthIdentityProfile> {
    const payload = await this.verifyIdToken(idToken);
    const providerSubject =
      typeof payload?.sub === 'string' ? payload.sub : undefined;
    const email =
      typeof payload?.email === 'string' ? payload.email : undefined;
    const emailVerified = this.isEmailVerified(payload?.email_verified);

    if (!providerSubject || !email || !emailVerified) {
      throw new UnauthorizedException('Invalid Apple profile');
    }

    return {
      provider: OAuthProvider.Apple,
      providerSubject,
      email,
      emailVerified,
      firstName: this.resolveNamePart(req.appleProfile?.name?.firstName, email),
      lastName: this.resolveNamePart(req.appleProfile?.name?.lastName, ''),
      isEmailAuthoritative: true,
    };
  }

  private isEmailVerified(value: unknown): boolean {
    return value === true || value === 'true';
  }

  private resolveNamePart(value: unknown, fallback: string): string {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) {
      return trimmed.slice(0, 100);
    }

    const fallbackName = fallback.split('@')[0]?.trim() || 'Ritora';
    return fallbackName.slice(0, 100);
  }

  private async verifyIdToken(idToken: string): Promise<AppleJwtPayload> {
    const decoded = decode(idToken, { complete: true });
    const kid =
      decoded && typeof decoded.header.kid === 'string'
        ? decoded.header.kid
        : undefined;

    if (!kid) {
      throw new UnauthorizedException('Invalid Apple profile');
    }

    const publicKey = await this.getApplePublicKey(kid);

    return new Promise<AppleJwtPayload>((resolve, reject) => {
      verify(
        idToken,
        publicKey,
        {
          algorithms: ['RS256'],
          audience: this.clientId,
          issuer: APPLE_ISSUER,
        },
        (error, verifiedPayload) => {
          if (error || typeof verifiedPayload !== 'object') {
            reject(new UnauthorizedException('Invalid Apple profile'));
            return;
          }

          resolve(verifiedPayload);
        },
      );
    });
  }

  private async getApplePublicKey(kid: string): Promise<string> {
    const now = Date.now();
    if (
      now < AppleStrategy.cachedPublicKeysExpiresAt &&
      AppleStrategy.cachedPublicKeys.has(kid)
    ) {
      return AppleStrategy.cachedPublicKeys.get(kid) as string;
    }

    const publicKeys = new Map<string, string>();

    try {
      const response = await fetch(APPLE_JWKS_URL);
      if (!response.ok) {
        throw new Error('Apple JWKS request failed');
      }

      const jwks = (await response.json()) as AppleJwksResponse;
      const keys = Array.isArray(jwks.keys) ? jwks.keys : [];

      for (const key of keys) {
        if (typeof key.kid !== 'string') {
          continue;
        }

        const jwk = { ...key };
        delete jwk.kid;
        const publicKey = createPublicKey({
          key: jwk as JsonWebKey,
          format: 'jwk',
        }).export({
          format: 'pem',
          type: 'spki',
        });
        publicKeys.set(key.kid, publicKey.toString());
      }
    } catch {
      throw new UnauthorizedException('Invalid Apple profile');
    }

    AppleStrategy.cachedPublicKeys = publicKeys;
    AppleStrategy.cachedPublicKeysExpiresAt = now + APPLE_JWKS_CACHE_MS;

    const publicKey = publicKeys.get(kid);
    if (!publicKey) {
      throw new UnauthorizedException('Invalid Apple profile');
    }

    return publicKey;
  }
}

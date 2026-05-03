import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync } from 'crypto';
import { sign } from 'jsonwebtoken';
import { OAuthProvider } from '../oauth/oauth-profile';
import { AppleStrategy } from './apple.strategy';

const APPLE_KEY_ID = 'KEY1234567';
const APPLE_CLIENT_ID = 'com.ritora.web';
const APPLE_ISSUER = 'https://appleid.apple.com';
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

function createStrategy(): AppleStrategy {
  const values: Record<string, string> = {
    APPLE_CLIENT_ID,
    APPLE_TEAM_ID: 'TEAM123456',
    APPLE_KEY_ID,
    APPLE_PRIVATE_KEY:
      '-----BEGIN PRIVATE KEY-----\\nmock\\n-----END PRIVATE KEY-----',
    APPLE_CALLBACK_URL: 'http://localhost:3001/api/v1/auth/apple/callback',
  };

  return new AppleStrategy({
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService);
}

function appleIdToken(
  overrides: Record<string, string | boolean> = {},
): string {
  return sign(
    {
      sub: 'apple-subject',
      email: 'user@privaterelay.appleid.com',
      email_verified: 'true',
      ...overrides,
    },
    privateKey,
    {
      algorithm: 'RS256',
      audience: APPLE_CLIENT_ID,
      expiresIn: '5m',
      issuer: APPLE_ISSUER,
      keyid: APPLE_KEY_ID,
    },
  );
}

describe('AppleStrategy', () => {
  beforeEach(() => {
    const jwk = publicKey.export({ format: 'jwk' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        keys: [{ ...jwk, kid: APPLE_KEY_ID }],
      }),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps verified Apple id tokens into provider-neutral auth profiles', async () => {
    const result = await createStrategy().validate(
      {
        appleProfile: {
          name: {
            firstName: 'Ada',
            lastName: 'Lovelace',
          },
        },
      } as never,
      '',
      '',
      appleIdToken(),
    );

    expect(result).toEqual({
      provider: OAuthProvider.Apple,
      providerSubject: 'apple-subject',
      email: 'user@privaterelay.appleid.com',
      emailVerified: true,
      firstName: 'Ada',
      lastName: 'Lovelace',
      isEmailAuthoritative: true,
    });
  });

  it('falls back to the email prefix when Apple only returns name once', async () => {
    const result = await createStrategy().validate(
      {} as never,
      '',
      '',
      appleIdToken({ email: 'jane@example.com' }),
    );

    expect(result.firstName).toBe('jane');
    expect(result.lastName).toBe('Ritora');
  });

  it('rejects id tokens without a verified email', async () => {
    await expect(
      createStrategy().validate(
        {} as never,
        '',
        '',
        appleIdToken({ email_verified: 'false' }),
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects id tokens with a different audience', async () => {
    const token = sign(
      {
        sub: 'apple-subject',
        email: 'user@privaterelay.appleid.com',
        email_verified: 'true',
      },
      privateKey,
      {
        algorithm: 'RS256',
        audience: 'com.attacker.web',
        expiresIn: '5m',
        issuer: APPLE_ISSUER,
        keyid: APPLE_KEY_ID,
      },
    );

    await expect(
      createStrategy().validate({} as never, '', '', token),
    ).rejects.toThrow(UnauthorizedException);
  });
});

import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Profile } from 'passport-google-oauth20';
import { OAuthProvider } from '../oauth/oauth-profile';
import { GoogleStrategy } from './google.strategy';

function createStrategy(): GoogleStrategy {
  const values: Record<string, string> = {
    GOOGLE_CLIENT_ID: 'google-client-id',
    GOOGLE_CLIENT_SECRET: 'google-client-secret',
    GOOGLE_CALLBACK_URL: 'http://localhost:3001/api/v1/auth/google/callback',
  };

  return new GoogleStrategy({
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService);
}

function googleProfile(overrides: Partial<Profile['_json']> = {}): Profile {
  const json = {
    iss: 'https://accounts.google.com',
    aud: 'google-client-id',
    sub: 'google-subject',
    iat: 1,
    exp: 2,
    email: 'user@example.com',
    email_verified: true,
    given_name: 'Ada',
    family_name: 'Lovelace',
    ...overrides,
  };

  return {
    provider: OAuthProvider.Google,
    id: json.sub,
    displayName: json.name ?? '',
    profileUrl: '',
    emails: json.email
      ? [{ value: json.email, verified: json.email_verified === true }]
      : undefined,
    _raw: JSON.stringify(json),
    _json: json,
  };
}

describe('GoogleStrategy', () => {
  it('maps verified Google profiles into provider-neutral auth profiles', () => {
    const result = createStrategy().validate('', '', googleProfile());

    expect(result).toEqual({
      provider: OAuthProvider.Google,
      providerSubject: 'google-subject',
      email: 'user@example.com',
      emailVerified: true,
      firstName: 'Ada',
      lastName: 'Lovelace',
      isEmailAuthoritative: false,
    });
  });

  it('marks verified Gmail accounts as authoritative for email ownership', () => {
    const result = createStrategy().validate(
      '',
      '',
      googleProfile({ email: 'user@gmail.com' }),
    );

    expect(result.isEmailAuthoritative).toBe(true);
  });

  it('marks verified Workspace accounts with hosted domain as authoritative', () => {
    const result = createStrategy().validate(
      '',
      '',
      googleProfile({ hd: 'example.com' }),
    );

    expect(result.isEmailAuthoritative).toBe(true);
  });

  it('rejects profiles without a verified email', () => {
    expect(() =>
      createStrategy().validate(
        '',
        '',
        googleProfile({ email_verified: false }),
      ),
    ).toThrow(UnauthorizedException);
  });
});

import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { GoogleIdTokenVerifierService } from './google-id-token-verifier.service';
import { OAuthProvider } from './oauth-profile';

describe('GoogleIdTokenVerifierService', () => {
  const config = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'GOOGLE_ID_TOKEN_AUDIENCES') {
        return 'web-client-id,ios-client-id';
      }
      throw new Error(`Missing config ${key}`);
    }),
  } as unknown as ConfigService;

  it('verifies the id token against the configured audiences', async () => {
    const client = {
      verifyIdToken: jest.fn().mockResolvedValue({
        getPayload: () => ({
          sub: 'google-subject',
          email: 'jane@gmail.com',
          email_verified: true,
          given_name: ' Jane ',
          family_name: ' Doe ',
        }),
      }),
    };
    const service = new GoogleIdTokenVerifierService(config, client);

    const profile = await service.verify(' google-id-token ');

    expect(client.verifyIdToken).toHaveBeenCalledWith({
      idToken: 'google-id-token',
      audience: ['web-client-id', 'ios-client-id'],
    });
    expect(profile).toEqual({
      provider: OAuthProvider.Google,
      providerSubject: 'google-subject',
      email: 'jane@gmail.com',
      emailVerified: true,
      firstName: 'Jane',
      lastName: 'Doe',
      isEmailAuthoritative: true,
    });
  });

  it('rejects invalid Google tokens', async () => {
    const client = {
      verifyIdToken: jest.fn().mockRejectedValue(new Error('bad token')),
    };
    const service = new GoogleIdTokenVerifierService(config, client);

    await expect(service.verify('bad-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects unverified or incomplete Google profiles', async () => {
    const client = {
      verifyIdToken: jest.fn().mockResolvedValue({
        getPayload: () => ({
          sub: 'google-subject',
          email: 'jane@example.com',
          email_verified: false,
        }),
      }),
    };
    const service = new GoogleIdTokenVerifierService(config, client);

    await expect(service.verify('google-id-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

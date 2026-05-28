import { Test, TestingModule } from '@nestjs/testing';
import type { Request, Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConfigService } from '@nestjs/config';
import { AccountDeletionStatus } from './dto/account-deletion-response.dto';
import { GoogleIdTokenVerifierService } from './oauth/google-id-token-verifier.service';

const mockAuthService = () => ({
  register: jest.fn(),
  login: jest.fn(),
  loginWithGoogle: jest.fn(),
  loginWithApple: jest.fn(),
  recordOAuthFailureForMonitoring: jest.fn(),
  refreshTokens: jest.fn(),
  verifyEmail: jest.fn(),
  resendVerification: jest.fn(),
  forgotPassword: jest.fn(),
  resetPassword: jest.fn(),
  getMe: jest.fn(),
  getSessions: jest.fn(),
  logout: jest.fn(),
  logoutSession: jest.fn(),
  logoutAll: jest.fn(),
  clearRefreshCookie: jest.fn(),
  exportData: jest.fn(),
  deleteAccount: jest.fn(),
  confirmAccountDeletion: jest.fn(),
  cancelAccountDeletion: jest.fn(),
});

const mockRes = () => ({
  cookie: jest.fn(),
  clearCookie: jest.fn(),
  redirect: jest.fn(),
});

type MockRequest = Pick<Request, 'ip' | 'headers'> & {
  cookies: Record<string, string>;
  user?: unknown;
};

type MockResponse = Pick<Response, 'cookie' | 'clearCookie' | 'redirect'>;

const mockReq = (overrides: Record<string, unknown> = {}) =>
  ({
    ip: '127.0.0.1',
    headers: { 'user-agent': 'TestAgent', origin: 'http://localhost:3000' },
    cookies: {},
    ...overrides,
  }) as MockRequest;

const asRequest = (request: MockRequest): Request =>
  request as unknown as Request;

const asOAuthRequest = (
  request: MockRequest,
): Parameters<AuthController['completeGoogleOAuth']>[0] =>
  request as unknown as Parameters<AuthController['completeGoogleOAuth']>[0];

const asResponse = (response: MockResponse): Response =>
  response as unknown as Response;

describe('AuthController', () => {
  let controller: AuthController;
  let authService: ReturnType<typeof mockAuthService>;
  let googleIdTokenVerifier: { verify: jest.Mock };
  const cookieName = 'custom_refresh';

  beforeEach(async () => {
    authService = mockAuthService();
    googleIdTokenVerifier = { verify: jest.fn() };
    const configValues: Record<string, unknown> = {
      CORS_ORIGINS: 'http://localhost:3000',
      WEB_APP_URL: 'http://localhost:3000',
      COOKIE_REFRESH_NAME: cookieName,
      COOKIE_DOMAIN: '',
      COOKIE_SECURE: false,
      COOKIE_SAME_SITE: 'lax',
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        {
          provide: GoogleIdTokenVerifierService,
          useValue: googleIdTokenVerifier,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => configValues[key]),
            getOrThrow: jest.fn((key: string) => {
              if (key in configValues) {
                return configValues[key];
              }
              throw new Error(`Missing config ${key}`);
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('register calls authService.register', async () => {
    const authResponse = {
      message: 'Verify your email to activate your account',
      user: { id: '01' },
    };
    authService.register.mockResolvedValue(authResponse);

    const result = await controller.register(
      {
        email: 'test@example.com',
        password: 'Password1',
        firstName: 'Jane',
        lastName: 'Doe',
        preferredLanguage: 'en',
        termsAccepted: true,
        privacyPolicyAccepted: true,
      },
      asRequest(mockReq()),
    );

    expect(result).toEqual(authResponse);
    expect(authService.register).toHaveBeenCalled();
  });

  it('login calls authService.login', async () => {
    const res = mockRes();
    const authResponse = {
      accessToken: 'tok',
      user: { id: '01', preferredLanguage: 'sv' },
    };
    authService.login.mockResolvedValue(authResponse);

    const result = await controller.login(
      { email: 'test@example.com', password: 'Password1' },
      asResponse(res),
      asRequest(mockReq()),
    );

    expect(result).toEqual(authResponse);
    expect(res.cookie).toHaveBeenCalledWith(
      'NEXT_LOCALE',
      'sv',
      expect.objectContaining({
        httpOnly: false,
        path: '/',
      }),
    );
  });

  it('google callback creates a session and redirects to post-login', async () => {
    const res = mockRes();
    const authResponse = {
      accessToken: 'tok',
      user: { id: '01', preferredLanguage: 'sv' },
    };
    authService.loginWithGoogle.mockResolvedValue(authResponse);
    const oauthContext = Buffer.from(
      JSON.stringify({
        preferredLanguage: 'sv',
        termsAccepted: true,
        privacyPolicyAccepted: true,
      }),
    ).toString('base64url');
    const profile = {
      provider: 'google',
      providerSubject: 'google-subject',
      email: 'test@gmail.com',
      emailVerified: true,
      firstName: 'Jane',
      lastName: 'Doe',
      isEmailAuthoritative: true,
    };

    await controller.completeGoogleOAuth(
      asOAuthRequest(
        mockReq({
          user: profile,
          cookies: {
            ritora_google_oauth_context: oauthContext,
          },
        }),
      ),
      asResponse(res),
    );

    expect(authService.loginWithGoogle).toHaveBeenCalledWith(
      profile,
      {
        preferredLanguage: 'sv',
        termsAccepted: true,
        privacyPolicyAccepted: true,
      },
      res,
      '127.0.0.1',
      'TestAgent',
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'NEXT_LOCALE',
      'sv',
      expect.objectContaining({
        httpOnly: false,
        path: '/',
      }),
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      'ritora_google_oauth_state',
      expect.objectContaining({ path: '/api/v1/auth/google' }),
    );
    expect(res.redirect).toHaveBeenCalledWith(
      'http://localhost:3000/post-login',
    );
  });

  it('mobile google sign-in verifies the id token and returns a session', async () => {
    const res = mockRes();
    const authResponse = {
      accessToken: 'tok',
      user: { id: '01', preferredLanguage: 'sv' },
    };
    const profile = {
      provider: 'google',
      providerSubject: 'google-subject',
      email: 'test@gmail.com',
      emailVerified: true,
      firstName: 'Jane',
      lastName: 'Doe',
      isEmailAuthoritative: true,
    };
    googleIdTokenVerifier.verify.mockResolvedValue(profile);
    authService.loginWithGoogle.mockResolvedValue(authResponse);

    const result = await controller.loginWithGoogleMobile(
      {
        idToken: 'google-id-token',
        preferredLanguage: 'sv',
        termsAccepted: true,
        privacyPolicyAccepted: true,
      },
      asResponse(res),
      asRequest(mockReq()),
    );

    expect(googleIdTokenVerifier.verify).toHaveBeenCalledWith(
      'google-id-token',
    );
    expect(authService.loginWithGoogle).toHaveBeenCalledWith(
      profile,
      {
        preferredLanguage: 'sv',
        termsAccepted: true,
        privacyPolicyAccepted: true,
      },
      res,
      '127.0.0.1',
      'TestAgent',
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'NEXT_LOCALE',
      'sv',
      expect.objectContaining({
        httpOnly: false,
        path: '/',
      }),
    );
    expect(result).toEqual(authResponse);
  });

  it('mobile google sign-in records invalid token failures for monitoring', async () => {
    const res = mockRes();
    const error = new Error('Invalid Google sign-in token');
    googleIdTokenVerifier.verify.mockRejectedValue(error);

    await expect(
      controller.loginWithGoogleMobile(
        {
          idToken: 'invalid-google-id-token',
          preferredLanguage: 'en',
          termsAccepted: true,
          privacyPolicyAccepted: true,
        },
        asResponse(res),
        asRequest(mockReq()),
      ),
    ).rejects.toThrow(error);

    expect(authService.recordOAuthFailureForMonitoring).toHaveBeenCalledWith(
      'google',
      {
        ip: '127.0.0.1',
        reason: 'invalid_id_token',
      },
    );
    expect(authService.loginWithGoogle).not.toHaveBeenCalled();
  });

  it('apple callback creates a session and redirects to post-login', async () => {
    const res = mockRes();
    const authResponse = {
      accessToken: 'tok',
      user: { id: '01', preferredLanguage: 'sv' },
    };
    authService.loginWithApple.mockResolvedValue(authResponse);
    const oauthContext = Buffer.from(
      JSON.stringify({
        preferredLanguage: 'sv',
        termsAccepted: true,
        privacyPolicyAccepted: true,
      }),
    ).toString('base64url');
    const profile = {
      provider: 'apple',
      providerSubject: 'apple-subject',
      email: 'user@privaterelay.appleid.com',
      emailVerified: true,
      firstName: 'Jane',
      lastName: 'Doe',
      isEmailAuthoritative: true,
    };

    await controller.completeAppleOAuth(
      asOAuthRequest(
        mockReq({
          user: profile,
          cookies: {
            ritora_apple_oauth_context: oauthContext,
          },
        }),
      ),
      asResponse(res),
    );

    expect(authService.loginWithApple).toHaveBeenCalledWith(
      profile,
      {
        preferredLanguage: 'sv',
        termsAccepted: true,
        privacyPolicyAccepted: true,
      },
      res,
      '127.0.0.1',
      'TestAgent',
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      'ritora_apple_oauth_state',
      expect.objectContaining({ path: '/api/v1/auth/apple' }),
    );
    expect(res.redirect).toHaveBeenCalledWith(
      'http://localhost:3000/post-login',
    );
  });

  it('verify-email calls authService.verifyEmail', async () => {
    authService.verifyEmail.mockResolvedValue(undefined);

    const result = await controller.verifyEmail({
      token: 'abc',
      language: 'sv',
    });

    expect(result.message).toBe('E-postadressen har verifierats');
  });

  it('forgot-password always returns success message', async () => {
    authService.forgotPassword.mockResolvedValue(undefined);

    const result = await controller.forgotPassword(
      {
        email: 'test@example.com',
        language: 'sv',
      },
      { ip: '127.0.0.1' } as never,
    );

    expect(authService.forgotPassword).toHaveBeenCalledWith(
      'test@example.com',
      'sv',
      '127.0.0.1',
    );
    expect(result.message).toContain('Om e-postadressen är registrerad');
  });

  it('reset-password calls authService.resetPassword', async () => {
    authService.resetPassword.mockResolvedValue(undefined);

    const result = await controller.resetPassword({
      token: 'abc',
      newPassword: 'NewPass1',
      language: 'sv',
    });

    expect(result.message).toBe('Lösenordet har återställts');
  });

  it('me calls authService.getMe', async () => {
    const user = { id: '01', email: 'test@example.com' };
    authService.getMe.mockResolvedValue(user);

    const result = await controller.me('01');

    expect(result).toEqual(user);
  });

  it('sessions calls authService.getSessions', async () => {
    authService.getSessions.mockResolvedValue([]);

    const result = await controller.sessions('01');

    expect(result).toEqual([]);
  });

  it('logout clears session from cookie', async () => {
    const res = mockRes();
    authService.logout.mockResolvedValue(undefined);

    const result = await controller.logout(
      'sv',
      '01USER',
      '01SESSION',
      asRequest(mockReq({ cookies: { [cookieName]: '01SESSION.secret' } })),
      asResponse(res),
    );

    expect(result.message).toBe('Du har loggats ut');
    expect(authService.logout).toHaveBeenCalledWith('01SESSION.secret', res);
    expect(authService.logoutSession).not.toHaveBeenCalled();
  });

  it('logout revokes the bearer session when no refresh cookie is present', async () => {
    const res = mockRes();
    authService.logoutSession.mockResolvedValue(undefined);

    const result = await controller.logout(
      'sv',
      '01USER',
      '01SESSION',
      asRequest(mockReq()),
      asResponse(res),
    );

    expect(result.message).toBe('Du har loggats ut');
    expect(authService.logout).not.toHaveBeenCalled();
    expect(authService.logoutSession).toHaveBeenCalledWith(
      '01USER',
      '01SESSION',
      res,
    );
  });

  it('refresh reads the configured refresh cookie name', async () => {
    const res = mockRes();
    authService.refreshTokens.mockResolvedValue({
      accessToken: 'refreshed',
      preferredLanguage: 'sv',
    });

    const result = await controller.refresh(
      asRequest(mockReq({ cookies: { [cookieName]: '01SESSION.secret' } })),
      asResponse(res),
    );

    expect(result).toEqual({ accessToken: 'refreshed' });
    expect(authService.refreshTokens).toHaveBeenCalledWith(
      '01SESSION.secret',
      res,
      '127.0.0.1',
      'TestAgent',
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'NEXT_LOCALE',
      'sv',
      expect.objectContaining({
        httpOnly: false,
        path: '/',
      }),
    );
  });

  it('logout-all revokes all sessions', async () => {
    const res = mockRes();
    authService.logoutAll.mockResolvedValue(undefined);

    const result = await controller.logoutAll('01', 'sv', asResponse(res));

    expect(result.message).toBe('Alla sessioner har avslutats');
  });

  it('export requires password confirmation', async () => {
    const data = { user: {}, skinProfile: null, consents: [], sessions: [] };
    authService.exportData.mockResolvedValue(data);

    const result = await controller.exportData('01', { password: 'Password1' });

    expect(authService.exportData).toHaveBeenCalledWith('01', 'Password1');
    expect(result).toEqual(data);
  });

  it('delete-account requires password confirmation', async () => {
    const res = mockRes();
    authService.deleteAccount.mockResolvedValue({
      status: AccountDeletionStatus.Scheduled,
      scheduledFor: '2026-06-13T12:00:00.000Z',
    });

    const result = await controller.deleteAccount(
      '01',
      'sv',
      { password: 'Password1' },
      asResponse(res),
    );

    expect(result).toEqual({
      status: AccountDeletionStatus.Scheduled,
      message: 'Kontot är schemalagt för radering',
      scheduledFor: '2026-06-13T12:00:00.000Z',
    });
    expect(authService.deleteAccount).toHaveBeenCalledWith(
      '01',
      'Password1',
      res,
      'sv',
    );
  });

  it('confirms OAuth account deletion from an email token', async () => {
    authService.confirmAccountDeletion.mockResolvedValue({
      status: AccountDeletionStatus.Scheduled,
      scheduledFor: '2026-06-13T12:00:00.000Z',
    });

    const result = await controller.confirmAccountDeletion({
      token: 'a'.repeat(64),
      language: 'en',
    });

    expect(result.status).toBe(AccountDeletionStatus.Scheduled);
    expect(result.message).toBe('Account deletion scheduled');
    expect(authService.confirmAccountDeletion).toHaveBeenCalledWith(
      'a'.repeat(64),
      'en',
    );
  });

  it('cancels account deletion from an email token', async () => {
    authService.cancelAccountDeletion.mockResolvedValue(undefined);

    const result = await controller.cancelAccountDeletion({
      token: 'b'.repeat(64),
      language: 'sv',
    });

    expect(result.message).toBe('Kontoraderingen har avbrutits');
    expect(authService.cancelAccountDeletion).toHaveBeenCalledWith(
      'b'.repeat(64),
      'sv',
    );
  });
});

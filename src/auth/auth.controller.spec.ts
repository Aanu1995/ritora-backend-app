import { Test, TestingModule } from '@nestjs/testing';
import type { Request, Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConfigService } from '@nestjs/config';

const mockAuthService = () => ({
  register: jest.fn(),
  login: jest.fn(),
  refreshTokens: jest.fn(),
  verifyEmail: jest.fn(),
  resendVerification: jest.fn(),
  forgotPassword: jest.fn(),
  resetPassword: jest.fn(),
  getMe: jest.fn(),
  getSessions: jest.fn(),
  logout: jest.fn(),
  logoutAll: jest.fn(),
  exportData: jest.fn(),
  deleteAccount: jest.fn(),
});

const mockRes = () => ({
  cookie: jest.fn(),
  clearCookie: jest.fn(),
});

type MockRequest = Pick<Request, 'ip' | 'headers'> & {
  cookies: Record<string, string>;
};

type MockResponse = Pick<Response, 'cookie' | 'clearCookie'>;

const mockReq = (overrides: Record<string, unknown> = {}) =>
  ({
    ip: '127.0.0.1',
    headers: { 'user-agent': 'TestAgent', origin: 'http://localhost:3000' },
    cookies: {},
    ...overrides,
  }) as MockRequest;

const asRequest = (request: MockRequest): Request =>
  request as unknown as Request;

const asResponse = (response: MockResponse): Response =>
  response as unknown as Response;

describe('AuthController', () => {
  let controller: AuthController;
  let authService: ReturnType<typeof mockAuthService>;
  const cookieName = 'custom_refresh';

  beforeEach(async () => {
    authService = mockAuthService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, def?: unknown) => {
              if (key === 'WEB_APP_URL') return 'http://localhost:3000';
              if (key === 'COOKIE_REFRESH_NAME') return cookieName;
              return def;
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

    const result = await controller.forgotPassword({
      email: 'test@example.com',
      language: 'sv',
    });

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
      asRequest(mockReq({ cookies: { [cookieName]: '01SESSION.secret' } })),
      asResponse(res),
    );

    expect(result.message).toBe('Du har loggats ut');
    expect(authService.logout).toHaveBeenCalledWith('01SESSION.secret', res);
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
    authService.deleteAccount.mockResolvedValue(undefined);

    const result = await controller.deleteAccount(
      '01',
      'sv',
      { password: 'Password1' },
      asResponse(res),
    );

    expect(result.message).toBe('Kontot har raderats');
    expect(authService.deleteAccount).toHaveBeenCalledWith(
      '01',
      'Password1',
      res,
    );
  });
});

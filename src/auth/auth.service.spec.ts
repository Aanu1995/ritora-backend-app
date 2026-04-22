import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import type { Response } from 'express';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { UserConsent } from '../users/entities/user-consent.entity';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { AuthSession } from './entities/auth-session.entity';
import { AuthService } from './auth.service';

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

const mockRes = () => ({
  cookie: jest.fn(),
  clearCookie: jest.fn(),
});

type MockResponse = Pick<Response, 'cookie' | 'clearCookie'>;

const asResponse = (response: MockResponse): Response =>
  response as unknown as Response;

const mockConfigValues: Record<string, string | number | boolean> = {
  JWT_ACCESS_EXPIRY: '15m',
  JWT_REFRESH_EXPIRY: '7d',
  JWT_ISSUER: 'ritora',
  JWT_AUDIENCE: 'ritora-web',
  JWT_REFRESH_SECRET: 'test-refresh-secret',
  BCRYPT_SALT_ROUNDS: 4,
  COOKIE_DOMAIN: '',
  COOKIE_SECURE: false,
  COOKIE_SAME_SITE: 'lax',
  COOKIE_REFRESH_NAME: 'ritora_refresh',
  EMAIL_VERIFICATION_EXPIRY: '24h',
  PASSWORD_RESET_EXPIRY: '1h',
  LEGAL_TERMS_VERSION: '1.0.0',
  LEGAL_PRIVACY_VERSION: '1.0.0',
  WEB_APP_URL: 'http://localhost:3000',
  NODE_ENV: 'development',
  RESEND_API_KEY: 're_test_mock',
};

describe('AuthService', () => {
  let service: AuthService;
  let usersService: Record<string, jest.Mock>;
  let jwtService: Record<string, jest.Mock>;
  let mailService: Record<string, jest.Mock>;
  let sessionsRepo: Record<string, jest.Mock>;
  let consentsRepo: Record<string, jest.Mock>;
  let skinProfileRepo: Record<string, jest.Mock>;

  beforeEach(async () => {
    usersService = {
      findByEmail: jest.fn(),
      findByEmailForAuth: jest.fn(),
      findById: jest.fn(),
      findByIdForAuth: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      findByVerificationTokenHash: jest.fn(),
      findByResetTokenHash: jest.fn(),
    } as Record<string, jest.Mock>;

    jwtService = {
      sign: jest.fn().mockReturnValue('access-token-123'),
    } as Record<string, jest.Mock>;

    mailService = {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    } as Record<string, jest.Mock>;

    sessionsRepo = {
      create: jest.fn().mockImplementation((data) => data),
      save: jest.fn().mockImplementation((data) => Promise.resolve(data)),
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(undefined),
    };

    consentsRepo = {
      create: jest.fn().mockImplementation((data) => data),
      save: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue([]),
    };

    skinProfileRepo = {
      findOne: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        { provide: MailService, useValue: mailService },
        { provide: getRepositoryToken(AuthSession), useValue: sessionsRepo },
        { provide: getRepositoryToken(UserConsent), useValue: consentsRepo },
        { provide: getRepositoryToken(SkinProfile), useValue: skinProfileRepo },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultVal?: unknown) =>
              key in mockConfigValues ? mockConfigValues[key] : defaultVal,
            ),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  const fakeUser = (overrides: Partial<User> = {}): User =>
    ({
      id: '01TESTUSER',
      email: 'test@example.com',
      password_hash: bcrypt.hashSync('Password1', 4),
      first_name: 'Jane',
      last_name: 'Doe',
      email_verified: false,
      email_verification_token_hash: null,
      email_verification_expires: null,
      password_reset_token_hash: null,
      password_reset_expires: null,
      preferred_language: 'en',
      created_at: new Date('2024-01-01'),
      updated_at: new Date('2024-01-01'),
      ...overrides,
    }) as User;

  // --- register ---

  describe('register', () => {
    it('creates user, records consents, sends email, and does not create a session', async () => {
      const user = fakeUser();
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue(user);

      const result = await service.register(
        {
          email: 'test@example.com',
          password: 'Password1',
          firstName: 'Jane',
          lastName: 'Doe',
          preferredLanguage: 'en',
          termsAccepted: true,
          privacyPolicyAccepted: true,
        },
        '127.0.0.1',
      );

      expect(result.message).toContain('Verify your email');
      expect(result.user.email).toBe('test@example.com');
      expect(consentsRepo.save).toHaveBeenCalled();
      expect(mailService.sendVerificationEmail).toHaveBeenCalledWith(
        'test@example.com',
        expect.any(String),
        'Jane',
        'en',
      );
      expect(sessionsRepo.save).not.toHaveBeenCalled();
    });

    it('rejects duplicate email', async () => {
      usersService.findByEmail.mockResolvedValue(fakeUser());

      await expect(
        service.register({
          email: 'test@example.com',
          password: 'Password1',
          firstName: 'Jane',
          lastName: 'Doe',
          preferredLanguage: 'en',
          termsAccepted: true,
          privacyPolicyAccepted: true,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects if terms not accepted', async () => {
      try {
        await service.register({
          email: 'test@example.com',
          password: 'Password1',
          firstName: 'Jane',
          lastName: 'Doe',
          preferredLanguage: 'en',
          termsAccepted: false,
          privacyPolicyAccepted: true,
        });
        fail('Expected registration to reject');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toEqual(
          expect.objectContaining({
            message: [
              'You must accept the terms of service and privacy policy',
            ],
            fieldErrors: {
              termsAccepted: [
                'You must accept the terms of service and privacy policy',
              ],
            },
          }),
        );
      }
    });
  });

  // --- login ---

  describe('login', () => {
    it('returns auth response on valid credentials', async () => {
      const res = mockRes();
      const user = fakeUser({ email_verified: true });
      usersService.findByEmailForAuth.mockResolvedValue(user);

      const result = await service.login(
        'test@example.com',
        'Password1',
        asResponse(res),
      );

      expect(result.accessToken).toBe('access-token-123');
      expect(result.user.email).toBe('test@example.com');
      expect(res.cookie).toHaveBeenCalled();
    });

    it('sanitizes stored session metadata from request headers', async () => {
      const res = mockRes();
      const user = fakeUser({ email_verified: true });
      usersService.findByEmailForAuth.mockResolvedValue(user);

      await service.login(
        'test@example.com',
        'Password1',
        asResponse(res),
        'not-an-ip-address',
        'Bad\r\nAgent\tValue',
      );

      expect(sessionsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ip_address: null,
          user_agent: 'Bad Agent Value',
        }),
      );
    });

    it('rejects invalid password with generic message', async () => {
      const res = mockRes();
      usersService.findByEmailForAuth.mockResolvedValue(fakeUser());

      await expect(
        service.login('test@example.com', 'WrongPassword1', asResponse(res)),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects unknown email with generic message', async () => {
      const res = mockRes();
      usersService.findByEmailForAuth.mockResolvedValue(null);

      await expect(
        service.login('nobody@example.com', 'Password1', asResponse(res)),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects unverified users before creating a session', async () => {
      const res = mockRes();
      usersService.findByEmailForAuth.mockResolvedValue(fakeUser());

      await expect(
        service.login('test@example.com', 'Password1', asResponse(res)),
      ).rejects.toThrow(ForbiddenException);
      expect(res.cookie).not.toHaveBeenCalled();
    });
  });

  // --- refreshTokens ---

  describe('refreshTokens', () => {
    it('rotates token and returns new access token', async () => {
      const res = mockRes();
      const secret = 'a'.repeat(64);
      const secretHash = sha256(secret);
      const user = fakeUser();

      sessionsRepo.findOne.mockResolvedValue({
        id: '01SESSION',
        user_id: user.id,
        refresh_token_hash: secretHash,
        expires_at: new Date(Date.now() + 86400000),
        revoked_at: null,
        user,
      });

      const result = await service.refreshTokens(
        `01SESSION.${secret}`,
        asResponse(res),
      );

      expect(result.accessToken).toBe('access-token-123');
      expect(result.preferredLanguage).toBe('en');
      expect(sessionsRepo.save).toHaveBeenCalled();
      expect(res.cookie).toHaveBeenCalled();
    });

    it('sanitizes refreshed session metadata before saving', async () => {
      const res = mockRes();
      const secret = 'a'.repeat(64);
      const user = fakeUser();
      sessionsRepo.findOne.mockResolvedValue({
        id: '01SESSION',
        user_id: user.id,
        refresh_token_hash: sha256(secret),
        expires_at: new Date(Date.now() + 86400000),
        revoked_at: null,
        ip_address: '127.0.0.1',
        user_agent: 'Existing Agent',
        user,
      });

      await service.refreshTokens(
        `01SESSION.${secret}`,
        asResponse(res),
        'invalid-ip',
        'Next\r\nAgent',
      );

      expect(sessionsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          ip_address: '127.0.0.1',
          user_agent: 'Next Agent',
        }),
      );
    });

    it('revokes all sessions if revoked token is reused', async () => {
      const res = mockRes();

      sessionsRepo.findOne.mockResolvedValue({
        id: '01SESSION',
        user_id: '01TESTUSER',
        revoked_at: new Date(),
      });

      await expect(
        service.refreshTokens('01SESSION.fakesecret', asResponse(res)),
      ).rejects.toThrow(UnauthorizedException);

      expect(sessionsRepo.update).toHaveBeenCalled();
    });

    it('rejects expired session', async () => {
      const res = mockRes();

      sessionsRepo.findOne.mockResolvedValue({
        id: '01SESSION',
        user_id: '01TESTUSER',
        revoked_at: null,
        expires_at: new Date(Date.now() - 1000),
      });

      await expect(
        service.refreshTokens('01SESSION.fakesecret', asResponse(res)),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // --- verifyEmail ---

  describe('verifyEmail', () => {
    it('marks email as verified on valid token', async () => {
      const rawToken = 'a'.repeat(64);
      const tokenHash = sha256(rawToken);
      const user = fakeUser({
        email_verification_token_hash: tokenHash,
        email_verification_expires: new Date(Date.now() + 86400000),
      });

      usersService.findByVerificationTokenHash.mockResolvedValue(user);

      await service.verifyEmail(rawToken);

      expect(usersService.update).toHaveBeenCalledWith(
        user.id,
        expect.objectContaining({
          email_verified: true,
          email_verification_token_hash: null,
        }),
      );
    });

    it('rejects expired token', async () => {
      const rawToken = 'b'.repeat(64);
      const tokenHash = sha256(rawToken);
      const user = fakeUser({
        email_verification_token_hash: tokenHash,
        email_verification_expires: new Date(Date.now() - 1000),
      });

      usersService.findByVerificationTokenHash.mockResolvedValue(user);

      await expect(service.verifyEmail(rawToken)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects invalid token', async () => {
      usersService.findByVerificationTokenHash.mockResolvedValue(null);

      await expect(service.verifyEmail('invalidtoken')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // --- forgotPassword ---

  describe('forgotPassword', () => {
    it('sends reset email for existing user', async () => {
      usersService.findByEmail.mockResolvedValue(fakeUser());

      await service.forgotPassword('test@example.com');

      expect(usersService.update).toHaveBeenCalled();
      expect(mailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        'test@example.com',
        expect.any(String),
        'Jane',
        'en',
      );
    });

    it('does nothing for unknown email (no info leak)', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await service.forgotPassword('nobody@example.com');

      expect(usersService.update).not.toHaveBeenCalled();
      expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });

  // --- resetPassword ---

  describe('resetPassword', () => {
    it('updates password and revokes all sessions', async () => {
      const rawToken = 'c'.repeat(64);
      const tokenHash = sha256(rawToken);
      const user = fakeUser({
        password_reset_token_hash: tokenHash,
        password_reset_expires: new Date(Date.now() + 3600000),
      });

      usersService.findByResetTokenHash.mockResolvedValue(user);

      await service.resetPassword(rawToken, 'NewPassword1');

      expect(usersService.update).toHaveBeenCalledWith(
        user.id,
        expect.objectContaining({
          password_reset_token_hash: null,
          password_reset_expires: null,
        }),
      );
      expect(sessionsRepo.update).toHaveBeenCalled();
    });

    it('rejects expired token', async () => {
      const rawToken = 'd'.repeat(64);
      const tokenHash = sha256(rawToken);
      const user = fakeUser({
        password_reset_token_hash: tokenHash,
        password_reset_expires: new Date(Date.now() - 1000),
      });

      usersService.findByResetTokenHash.mockResolvedValue(user);

      await expect(
        service.resetPassword(rawToken, 'NewPassword1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // --- logout ---

  describe('logout', () => {
    it('revokes session only when the refresh token secret matches', async () => {
      const res = mockRes();
      const secret = 'a'.repeat(64);
      sessionsRepo.findOne.mockResolvedValue({
        id: '01SESSION',
        refresh_token_hash: sha256(secret),
        expires_at: new Date(Date.now() + 86400000),
        revoked_at: null,
      });

      await service.logout(`01SESSION.${secret}`, asResponse(res));

      expect(sessionsRepo.save).toHaveBeenCalled();
      expect(res.clearCookie).toHaveBeenCalled();
    });

    it('clears the cookie without revoking another session on invalid token secret', async () => {
      const res = mockRes();
      sessionsRepo.findOne.mockResolvedValue({
        id: '01SESSION',
        refresh_token_hash: sha256('a'.repeat(64)),
        expires_at: new Date(Date.now() + 86400000),
        revoked_at: null,
      });

      await service.logout(`01SESSION.${'b'.repeat(64)}`, asResponse(res));

      expect(sessionsRepo.save).not.toHaveBeenCalled();
      expect(res.clearCookie).toHaveBeenCalled();
    });
  });

  // --- logoutAll ---

  describe('logoutAll', () => {
    it('revokes all sessions and clears cookie', async () => {
      const res = mockRes();

      await service.logoutAll('01TESTUSER', asResponse(res));

      expect(sessionsRepo.update).toHaveBeenCalled();
      expect(res.clearCookie).toHaveBeenCalled();
    });
  });

  // --- getSessions ---

  describe('getSessions', () => {
    it('masks ip addresses in the routine session list', async () => {
      sessionsRepo.find.mockResolvedValue([
        {
          id: '01SESSION',
          user_agent: 'Browser',
          ip_address: '127.0.0.1',
          created_at: new Date('2024-01-01'),
          last_used_at: new Date(Date.now() + 60_000),
          expires_at: new Date(Date.now() + 60_000),
          revoked_at: null,
        },
      ]);

      const result = await service.getSessions('01TESTUSER');

      expect(result).toEqual([
        expect.objectContaining({
          id: '01SESSION',
          ipAddress: '127.0.0.0',
          userAgent: 'Browser',
        }),
      ]);
    });
  });

  // --- exportData ---

  describe('exportData', () => {
    it('returns user, skin profile, consents, and sessions', async () => {
      const user = fakeUser();
      usersService.findByIdForAuth.mockResolvedValue(user);
      consentsRepo.find.mockResolvedValue([
        {
          consent_type: 'privacy_policy',
          consent_version: '1.0.0',
          granted: true,
          granted_at: new Date('2024-01-01'),
          revoked_at: null,
          created_at: new Date('2024-01-01'),
        },
      ]);
      sessionsRepo.find.mockResolvedValue([
        {
          id: '01SESSION',
          user_agent: 'TestAgent',
          ip_address: '127.0.0.1',
          created_at: new Date('2024-01-01'),
          last_used_at: new Date('2024-01-02'),
          revoked_at: null,
        },
      ]);
      skinProfileRepo.findOne.mockResolvedValue({
        id: '01PROFILE',
        user_id: user.id,
        skin_type: 'oily',
        skin_tone: 'medium',
        age_range: '25_34',
        ethnicity: 'black',
        current_concerns: ['acne'],
        known_sensitivities: ['retinol'],
        skin_goals: ['clear_acne'],
        country_code: 'SE',
        city: 'Stockholm',
        routine_complexity: 'moderate',
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      });

      const result = await service.exportData(user.id, 'Password1');

      expect(usersService.findByIdForAuth).toHaveBeenCalledWith(user.id);
      expect(result.user).toMatchObject({ email: 'test@example.com' });
      expect(result.skinProfile).toMatchObject({
        skinType: 'oily',
        knownSensitivities: ['retinol'],
        countryCode: 'SE',
      });
      expect(result.consents).toHaveLength(1);
      expect(result.sessions).toHaveLength(1);
    });

    it('rejects when password confirmation is wrong', async () => {
      const user = fakeUser();
      usersService.findByIdForAuth.mockResolvedValue(user);

      await expect(
        service.exportData(user.id, 'WrongPassword1'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // --- deleteAccount ---

  describe('deleteAccount', () => {
    it('deletes user after password confirmation', async () => {
      const res = mockRes();
      const user = fakeUser();
      usersService.findByIdForAuth.mockResolvedValue(user);

      await service.deleteAccount(user.id, 'Password1', asResponse(res));

      expect(usersService.remove).toHaveBeenCalledWith(user.id);
      expect(res.clearCookie).toHaveBeenCalled();
    });

    it('rejects with wrong password', async () => {
      const res = mockRes();
      const user = fakeUser();
      usersService.findByIdForAuth.mockResolvedValue(user);

      await expect(
        service.deleteAccount(user.id, 'WrongPassword1', asResponse(res)),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});

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
import { hashSync } from 'bcrypt';
import { createHash } from 'crypto';
import type { Response } from 'express';
import { CataloguePhotoStorageService } from '../catalogue/catalogue-photo-storage.service';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { SmartPickProductSuggestion } from '../smart-picks/entities/smart-pick-product-suggestion.entity';
import { SmartPickSnapshot } from '../smart-picks/entities/smart-pick-snapshot.entity';
import { SkinJournalService } from '../skin-journal/skin-journal.service';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { SuggestionGapAction } from '../suggestions/entities/suggestion-gap-action.entity';
import { UserConsent } from '../users/entities/user-consent.entity';
import { User } from '../users/entities/user.entity';
import { UserDataAccessLogService } from '../users/user-data-access-log.service';
import {
  UserConsentType,
  UserDataAccessPurpose,
} from '../users/user-consent.constants';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { AuthSession } from './entities/auth-session.entity';
import { AuthService } from './auth.service';
import { AccountDeletionSchedulerService } from './account-deletion-scheduler.service';
import { AccountDeletionStatus } from './dto/account-deletion-response.dto';
import { OAuthProvider } from './oauth/oauth-profile';

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

const mockRes = () => ({
  cookie: jest.fn(),
  clearCookie: jest.fn(),
});

type MockResponse = Pick<Response, 'cookie' | 'clearCookie'>;

const asResponse = (response: MockResponse): Response =>
  response as MockResponse & Response;

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
  let smartPickSnapshotsRepo: Record<string, jest.Mock>;
  let smartPickSuggestionsRepo: Record<string, jest.Mock>;
  let suggestionGapActionsRepo: Record<string, jest.Mock>;
  let inventoryProductsRepo: Record<string, jest.Mock>;
  let dataAccessLogService: Record<string, jest.Mock>;
  let cataloguePhotoStorageService: Record<string, jest.Mock>;
  let accountDeletionScheduler: Record<string, jest.Mock>;

  beforeEach(async () => {
    usersService = {
      findByEmail: jest.fn(),
      findByEmailForAuth: jest.fn(),
      findByGoogleSubject: jest.fn(),
      findByAppleSubject: jest.fn(),
      findById: jest.fn(),
      findByIdForAuth: jest.fn(),
      create: jest.fn(),
      createGoogleUser: jest.fn(),
      createAppleUser: jest.fn(),
      update: jest.fn(),
      linkGoogleSubject: jest.fn(),
      linkAppleSubject: jest.fn(),
      remove: jest.fn(),
      findByVerificationTokenHash: jest.fn(),
      findByResetTokenHash: jest.fn(),
      findByAccountDeletionCancelTokenHash: jest.fn(),
      findByAccountDeletionConfirmTokenHash: jest.fn(),
      findDueAccountDeletions: jest.fn(),
      setAccountDeletionState: jest.fn(),
      clearAccountDeletionState: jest.fn(),
    };

    jwtService = {
      sign: jest.fn().mockReturnValue('access-token-123'),
    };

    mailService = {
      sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
      sendAccountDeletionConfirmationEmail: jest
        .fn()
        .mockResolvedValue(undefined),
      sendAccountDeletionScheduledEmail: jest.fn().mockResolvedValue(undefined),
      sendAccountDeletionCancelledEmail: jest.fn().mockResolvedValue(undefined),
    };

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

    smartPickSnapshotsRepo = {
      find: jest.fn().mockResolvedValue([]),
    };
    smartPickSuggestionsRepo = {
      find: jest.fn().mockResolvedValue([]),
    };
    suggestionGapActionsRepo = {
      find: jest.fn().mockResolvedValue([]),
    };
    inventoryProductsRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    dataAccessLogService = {
      recordDataAccess: jest.fn().mockResolvedValue(undefined),
    };
    cataloguePhotoStorageService = {
      deleteManagedImageUrls: jest.fn().mockResolvedValue(undefined),
      deleteManagedImagesForOwner: jest.fn().mockResolvedValue(undefined),
    };
    accountDeletionScheduler = {
      scheduleFinalization: jest.fn().mockResolvedValue(undefined),
      cancelFinalization: jest.fn().mockResolvedValue(undefined),
    };
    const skinJournalService = {
      exportAllDataForAccount: jest.fn().mockResolvedValue(null),
      deleteAllMediaForUser: jest.fn().mockResolvedValue(undefined),
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
          provide: getRepositoryToken(SmartPickSnapshot),
          useValue: smartPickSnapshotsRepo,
        },
        {
          provide: getRepositoryToken(SmartPickProductSuggestion),
          useValue: smartPickSuggestionsRepo,
        },
        {
          provide: getRepositoryToken(SuggestionGapAction),
          useValue: suggestionGapActionsRepo,
        },
        {
          provide: getRepositoryToken(InventoryProduct),
          useValue: inventoryProductsRepo,
        },
        { provide: UserDataAccessLogService, useValue: dataAccessLogService },
        { provide: SkinJournalService, useValue: skinJournalService },
        {
          provide: CataloguePhotoStorageService,
          useValue: cataloguePhotoStorageService,
        },
        {
          provide: AccountDeletionSchedulerService,
          useValue: accountDeletionScheduler,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => mockConfigValues[key]),
            getOrThrow: jest.fn((key: string) => {
              if (key in mockConfigValues) {
                return mockConfigValues[key];
              }
              throw new Error(`Missing config ${key}`);
            }),
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
      password_hash: hashSync('Password1', 4),
      first_name: 'Jane',
      last_name: 'Doe',
      email_verified: false,
      email_verification_token_hash: null,
      email_verification_expires: null,
      password_reset_token_hash: null,
      password_reset_expires: null,
      account_deletion_requested_at: null,
      account_deletion_scheduled_for: null,
      account_deletion_cancel_token_hash: null,
      account_deletion_confirm_token_hash: null,
      account_deletion_confirm_expires: null,
      preferred_language: 'en',
      google_subject: null,
      apple_subject: null,
      created_at: new Date('2024-01-01'),
      updated_at: new Date('2024-01-01'),
      ...overrides,
    }) as User;

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
        expect.stringMatching(/^[a-f0-9]{64}$/),
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

    it('rejects missing email with generic message', async () => {
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

  describe('loginWithGoogle', () => {
    const googleProfile = {
      provider: OAuthProvider.Google,
      providerSubject: 'google-subject-123',
      email: 'test@example.com',
      emailVerified: true,
      firstName: 'Jane',
      lastName: 'Doe',
      isEmailAuthoritative: false,
    };
    const authoritativeGoogleProfile = {
      ...googleProfile,
      email: 'test@gmail.com',
      isEmailAuthoritative: true,
    };

    it('creates a verified user, records legal consents, and starts a session for first-time Google sign-in', async () => {
      const res = mockRes();
      const user = fakeUser({
        email_verified: true,
        password_hash: null,
        google_subject: googleProfile.providerSubject,
      });
      usersService.findByGoogleSubject.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(null);
      usersService.createGoogleUser.mockResolvedValue(user);

      const result = await service.loginWithGoogle(
        googleProfile,
        {
          preferredLanguage: 'sv',
          termsAccepted: true,
          privacyPolicyAccepted: true,
        },
        asResponse(res),
        '127.0.0.1',
        'Google Agent',
      );

      expect(result.accessToken).toBe('access-token-123');
      expect(usersService.createGoogleUser).toHaveBeenCalledWith({
        email: googleProfile.email,
        google_subject: googleProfile.providerSubject,
        first_name: googleProfile.firstName,
        last_name: googleProfile.lastName,
        preferred_language: 'sv',
      });
      expect(consentsRepo.save).toHaveBeenCalled();
      expect(res.cookie).toHaveBeenCalled();
    });

    it('requires legal consent before creating a new Google user', async () => {
      const res = mockRes();
      usersService.findByGoogleSubject.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.loginWithGoogle(
          googleProfile,
          {
            preferredLanguage: 'en',
            termsAccepted: false,
            privacyPolicyAccepted: true,
          },
          asResponse(res),
        ),
      ).rejects.toThrow(BadRequestException);

      expect(usersService.createGoogleUser).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('links authoritative Gmail Google identity to an existing email account', async () => {
      const res = mockRes();
      const existing = fakeUser({
        email: authoritativeGoogleProfile.email,
        email_verified: true,
        google_subject: null,
      });
      usersService.findByGoogleSubject.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(existing);
      usersService.linkGoogleSubject.mockResolvedValue({
        ...existing,
        google_subject: authoritativeGoogleProfile.providerSubject,
      });

      await service.loginWithGoogle(
        authoritativeGoogleProfile,
        {
          preferredLanguage: 'en',
          termsAccepted: false,
          privacyPolicyAccepted: false,
        },
        asResponse(res),
      );

      expect(usersService.linkGoogleSubject).toHaveBeenCalledWith(
        existing.id,
        authoritativeGoogleProfile.providerSubject,
      );
      expect(consentsRepo.save).not.toHaveBeenCalled();
      expect(res.cookie).toHaveBeenCalled();
    });

    it('links authoritative Workspace Google identity to an existing email account', async () => {
      const res = mockRes();
      const workspaceGoogleProfile = {
        ...googleProfile,
        isEmailAuthoritative: true,
      };
      const existing = fakeUser({
        email: workspaceGoogleProfile.email,
        email_verified: true,
        google_subject: null,
      });
      usersService.findByGoogleSubject.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(existing);
      usersService.linkGoogleSubject.mockResolvedValue({
        ...existing,
        google_subject: workspaceGoogleProfile.providerSubject,
      });

      await service.loginWithGoogle(
        workspaceGoogleProfile,
        {
          preferredLanguage: 'en',
          termsAccepted: false,
          privacyPolicyAccepted: false,
        },
        asResponse(res),
      );

      expect(usersService.linkGoogleSubject).toHaveBeenCalledWith(
        existing.id,
        workspaceGoogleProfile.providerSubject,
      );
      expect(res.cookie).toHaveBeenCalled();
    });

    it('rejects non-authoritative Google email when an email-password account already exists', async () => {
      const res = mockRes();
      const existing = fakeUser({
        email: googleProfile.email,
        email_verified: true,
        google_subject: null,
      });
      usersService.findByGoogleSubject.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(existing);

      await expect(
        service.loginWithGoogle(
          googleProfile,
          {
            preferredLanguage: 'en',
            termsAccepted: false,
            privacyPolicyAccepted: false,
          },
          asResponse(res),
        ),
      ).rejects.toThrow(ConflictException);

      expect(usersService.linkGoogleSubject).not.toHaveBeenCalled();
      expect(sessionsRepo.create).not.toHaveBeenCalled();
      expect(sessionsRepo.save).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('rejects if the email account is already linked to a different Google subject', async () => {
      const res = mockRes();
      usersService.findByGoogleSubject.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(
        fakeUser({ google_subject: 'different-subject' }),
      );

      await expect(
        service.loginWithGoogle(
          googleProfile,
          {
            preferredLanguage: 'en',
            termsAccepted: true,
            privacyPolicyAccepted: true,
          },
          asResponse(res),
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('loginWithApple', () => {
    const appleProfile = {
      provider: OAuthProvider.Apple,
      providerSubject: 'apple-subject-123',
      email: 'user@privaterelay.appleid.com',
      emailVerified: true,
      firstName: 'Jane',
      lastName: 'Doe',
      isEmailAuthoritative: true,
    };

    it('creates a verified user, records legal consents, and starts a session for first-time Apple sign-in', async () => {
      const res = mockRes();
      const user = fakeUser({
        email: appleProfile.email,
        email_verified: true,
        password_hash: null,
        apple_subject: appleProfile.providerSubject,
      });
      usersService.findByAppleSubject.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(null);
      usersService.createAppleUser.mockResolvedValue(user);

      const result = await service.loginWithApple(
        appleProfile,
        {
          preferredLanguage: 'sv',
          termsAccepted: true,
          privacyPolicyAccepted: true,
        },
        asResponse(res),
        '127.0.0.1',
        'Apple Agent',
      );

      expect(result.accessToken).toBe('access-token-123');
      expect(usersService.createAppleUser).toHaveBeenCalledWith({
        email: appleProfile.email,
        apple_subject: appleProfile.providerSubject,
        first_name: appleProfile.firstName,
        last_name: appleProfile.lastName,
        preferred_language: 'sv',
      });
      expect(consentsRepo.save).toHaveBeenCalled();
      expect(res.cookie).toHaveBeenCalled();
    });

    it('links a verified Apple identity to an existing email account', async () => {
      const res = mockRes();
      const existing = fakeUser({
        email: appleProfile.email,
        email_verified: true,
        apple_subject: null,
      });
      usersService.findByAppleSubject.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(existing);
      usersService.linkAppleSubject.mockResolvedValue({
        ...existing,
        apple_subject: appleProfile.providerSubject,
      });

      await service.loginWithApple(
        appleProfile,
        {
          preferredLanguage: 'en',
          termsAccepted: false,
          privacyPolicyAccepted: false,
        },
        asResponse(res),
      );

      expect(usersService.linkAppleSubject).toHaveBeenCalledWith(
        existing.id,
        appleProfile.providerSubject,
      );
      expect(consentsRepo.save).not.toHaveBeenCalled();
      expect(res.cookie).toHaveBeenCalled();
    });

    it('rejects if the email account is already linked to a different Apple subject', async () => {
      const res = mockRes();
      usersService.findByAppleSubject.mockResolvedValue(null);
      usersService.findByEmail.mockResolvedValue(
        fakeUser({ apple_subject: 'different-subject' }),
      );

      await expect(
        service.loginWithApple(
          appleProfile,
          {
            preferredLanguage: 'en',
            termsAccepted: true,
            privacyPolicyAccepted: true,
          },
          asResponse(res),
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

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

    it('rejects revoked refresh tokens without revoking other sessions', async () => {
      const res = mockRes();

      sessionsRepo.findOne.mockResolvedValue({
        id: '01SESSION',
        user_id: '01TESTUSER',
        revoked_at: new Date(),
      });

      await expect(
        service.refreshTokens('01SESSION.fakesecret', asResponse(res)),
      ).rejects.toThrow(UnauthorizedException);

      expect(sessionsRepo.update).not.toHaveBeenCalled();
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

  describe('forgotPassword', () => {
    it('sends reset email for existing user', async () => {
      usersService.findByEmail.mockResolvedValue(fakeUser());

      await service.forgotPassword('test@example.com');

      expect(usersService.update).toHaveBeenCalled();
      expect(mailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        'test@example.com',
        expect.stringMatching(/^[a-f0-9]{64}$/),
        'Jane',
        'en',
      );
    });

    it('does nothing for missing email (no info leak)', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await service.forgotPassword('nobody@example.com');

      expect(usersService.update).not.toHaveBeenCalled();
      expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });

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

  describe('logoutAll', () => {
    it('revokes all sessions and clears cookie', async () => {
      const res = mockRes();

      await service.logoutAll('01TESTUSER', asResponse(res));

      expect(sessionsRepo.update).toHaveBeenCalled();
      expect(res.clearCookie).toHaveBeenCalled();
    });
  });

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

  describe('exportData', () => {
    it('returns user, skin profile, consents, and sessions', async () => {
      const user = fakeUser();
      usersService.findByIdForAuth.mockResolvedValue(user);
      consentsRepo.find.mockResolvedValue([
        {
          consent_type: UserConsentType.PrivacyPolicy,
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
        ethnicity: 'black',
        current_concerns: ['acne'],
        country_code: 'SE',
        city: 'Stockholm',
        fitzpatrick_phototype: 'IV',
        primary_goal: 'acne',
        allow_smart_picks: true,
        budget_tier: 'mid',
        safety_context: {},
        reaction_history: {
          entries: [{ trigger: 'retinol', trigger_type: 'ingredient' }],
        },
        concern_details: {},
        skin_behavior: {},
        active_tolerances: {},
        routine_preferences: {},
        lifestyle_context: {},
        shopping_preferences: {},
        hormonal_context: {},
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-02'),
      });
      smartPickSnapshotsRepo.find.mockResolvedValue([
        {
          mode: 'refine',
          coverage_json: { filled: 4, total: 5, slots: [] },
          gaps_json: [
            {
              ingredientOrCategory: 'Replacement for Serum',
              normalizedKey: 'replacement-for-serum',
              priority: 'priority',
              reason: 'History suggests a replacement.',
              goalAlignment: 'acne',
              sourceIds: [],
              gapKind: 'replacement',
              replacementFor: null,
            },
          ],
          covered_json: [],
          redundancy_json: [],
          recap_json: {
            primaryGoal: 'acne',
            skinType: 'oily',
            location: { city: 'Stockholm', countryCode: 'SE' },
            budgetTier: 'mid',
            ethnicity: 'black',
          },
          inputs_hash: 'hash-1',
          generated_at: new Date('2026-05-12T09:00:00.000Z'),
        },
      ]);
      smartPickSuggestionsRepo.find.mockResolvedValue([
        {
          ingredient_or_category: 'Replacement for Serum',
          normalized_key: 'replacement-for-serum',
          brand: 'Better Brand',
          product_name: 'Gentle Serum',
          budget_tier: 'mid',
          seller_names_json: ['Stylevana', 'Derm Store'],
          recommendation_rank_reason: 'Better fit for the goal.',
          source_ids: [],
          gap_reason: 'History suggests a replacement.',
          goal_alignment: 'acne',
          created_at: new Date('2026-05-12T09:00:00.000Z'),
          updated_at: new Date('2026-05-12T09:00:00.000Z'),
        },
      ]);
      suggestionGapActionsRepo.find.mockResolvedValue([
        {
          source_type: 'smart_pick',
          ingredient_or_category: 'Replacement for Serum',
          normalized_key: 'replacement-for-serum',
          action: 'saved',
          created_at: new Date('2026-05-12T10:00:00.000Z'),
          updated_at: new Date('2026-05-12T10:00:00.000Z'),
        },
      ]);

      const result = await service.exportData(user.id, 'Password1');

      expect(usersService.findByIdForAuth).toHaveBeenCalledWith(user.id);
      expect(result.user).toMatchObject({ email: 'test@example.com' });
      expect(result.skinProfile).toMatchObject({
        skinType: 'oily',
        reactionHistory: {
          entries: [{ trigger: 'retinol', trigger_type: 'ingredient' }],
        },
        countryCode: 'SE',
      });
      expect(result.consents).toHaveLength(1);
      expect(result.sessions).toHaveLength(1);
      expect(result.smartPicks.snapshots).toHaveLength(1);
      expect(result.smartPicks.productSuggestions[0]).toMatchObject({
        ingredientOrCategory: 'Replacement for Serum',
        productName: 'Gentle Serum',
        sellerNames: ['Stylevana', 'Derm Store'],
      });
      expect(result.smartPicks.actions[0]).toMatchObject({
        sourceType: 'smart_pick',
        normalizedKey: 'replacement-for-serum',
        action: 'saved',
      });
      expect(suggestionGapActionsRepo.find).toHaveBeenCalledWith({
        where: { user_id: user.id, source_type: 'smart_pick' },
        order: { created_at: 'DESC' },
      });
      expect(dataAccessLogService.recordDataAccess).toHaveBeenCalledWith(
        user.id,
        [UserConsentType.LocationProcessing],
        UserDataAccessPurpose.AccountExport,
      );
      expect(dataAccessLogService.recordDataAccess).toHaveBeenCalledWith(
        user.id,
        [UserConsentType.AiSuggestionProcessing],
        UserDataAccessPurpose.AccountExport,
      );
    });

    it('rejects when password confirmation is wrong', async () => {
      const user = fakeUser();
      usersService.findByIdForAuth.mockResolvedValue(user);

      await expect(
        service.exportData(user.id, 'WrongPassword1'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('deleteAccount', () => {
    it('schedules deletion after password confirmation and revokes sessions', async () => {
      const res = mockRes();
      const user = fakeUser();
      usersService.findByIdForAuth.mockResolvedValue(user);
      usersService.setAccountDeletionState.mockImplementation(
        async (_id: string, data: { scheduledFor: Date }) =>
          fakeUser({
            account_deletion_requested_at: new Date('2026-05-14T12:00:00.000Z'),
            account_deletion_scheduled_for: data.scheduledFor,
          }),
      );

      const result = await service.deleteAccount(
        user.id,
        'Password1',
        asResponse(res),
        'en',
      );

      expect(result.status).toBe(AccountDeletionStatus.Scheduled);
      expect(result.scheduledFor).toEqual(expect.any(String));
      expect(usersService.setAccountDeletionState).toHaveBeenCalledWith(
        user.id,
        expect.objectContaining({
          requestedAt: expect.any(Date),
          scheduledFor: expect.any(Date),
          cancelTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          confirmTokenHash: null,
          confirmExpires: null,
        }),
      );
      expect(sessionsRepo.update).toHaveBeenCalledWith(
        { user_id: user.id, revoked_at: expect.any(Object) },
        { revoked_at: expect.any(Date) },
      );
      expect(
        mailService.sendAccountDeletionScheduledEmail,
      ).toHaveBeenCalledWith(
        user.email,
        expect.stringMatching(/^[a-f0-9]{64}$/),
        user.first_name,
        'en',
        expect.any(String),
      );
      expect(
        accountDeletionScheduler.scheduleFinalization,
      ).toHaveBeenCalledWith(user.id, expect.any(Date));
      expect(usersService.remove).not.toHaveBeenCalled();
      expect(res.clearCookie).toHaveBeenCalled();
    });

    it('clears pending deletion state when durable schedule creation fails', async () => {
      const res = mockRes();
      const user = fakeUser();
      usersService.findByIdForAuth.mockResolvedValue(user);
      usersService.setAccountDeletionState.mockResolvedValue(user);
      accountDeletionScheduler.scheduleFinalization.mockRejectedValueOnce(
        new Error('scheduler unavailable'),
      );

      await expect(
        service.deleteAccount(user.id, 'Password1', asResponse(res), 'en'),
      ).rejects.toThrow('Account deletion could not be scheduled');

      expect(usersService.clearAccountDeletionState).toHaveBeenCalledWith(
        user.id,
      );
      expect(
        mailService.sendAccountDeletionScheduledEmail,
      ).not.toHaveBeenCalled();
      expect(sessionsRepo.update).not.toHaveBeenCalled();
      expect(res.clearCookie).not.toHaveBeenCalled();
    });

    it('clears pending deletion state when scheduled email delivery fails', async () => {
      const logger = {
        error: jest.fn(),
        warn: jest.fn(),
      };
      Object.defineProperty(service, 'logger', { value: logger });
      const res = mockRes();
      const user = fakeUser();
      usersService.findByIdForAuth.mockResolvedValue(user);
      usersService.setAccountDeletionState.mockResolvedValue(user);
      mailService.sendAccountDeletionScheduledEmail.mockRejectedValueOnce(
        new Error('Delivery failed'),
      );

      await expect(
        service.deleteAccount(user.id, 'Password1', asResponse(res), 'en'),
      ).rejects.toThrow('Account deletion email could not be sent');

      const scheduledEmailCall = mailService.sendAccountDeletionScheduledEmail
        .mock.calls[0] as [string, string, string, string, string];
      const rawToken = scheduledEmailCall[1];
      const warnOutput = logger.warn.mock.calls.flat().join('\n');

      expect(rawToken).toMatch(/^[a-f0-9]{64}$/);
      expect(warnOutput).not.toContain(rawToken);
      expect(warnOutput).not.toContain(`/cancel-account-deletion/${rawToken}`);
      expect(warnOutput).toContain('account deletion action URL withheld');
      expect(accountDeletionScheduler.cancelFinalization).toHaveBeenCalledWith(
        user.id,
      );
      expect(usersService.clearAccountDeletionState).toHaveBeenCalledWith(
        user.id,
      );
      expect(sessionsRepo.update).not.toHaveBeenCalled();
      expect(res.clearCookie).not.toHaveBeenCalled();
    });

    it('rejects with wrong password', async () => {
      const res = mockRes();
      const user = fakeUser();
      usersService.findByIdForAuth.mockResolvedValue(user);

      await expect(
        service.deleteAccount(user.id, 'WrongPassword1', asResponse(res)),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('sends an email confirmation before scheduling OAuth-only accounts', async () => {
      const res = mockRes();
      const user = fakeUser({
        password_hash: null,
        google_subject: 'google-subject',
      });
      usersService.findByIdForAuth.mockResolvedValue(user);
      usersService.setAccountDeletionState.mockResolvedValue(user);

      const result = await service.deleteAccount(
        user.id,
        '',
        asResponse(res),
        'en',
      );

      expect(result.status).toBe(AccountDeletionStatus.ConfirmationRequired);
      expect(usersService.setAccountDeletionState).toHaveBeenCalledWith(
        user.id,
        expect.objectContaining({
          requestedAt: expect.any(Date),
          scheduledFor: null,
          cancelTokenHash: null,
          confirmTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          confirmExpires: expect.any(Date),
        }),
      );
      expect(
        mailService.sendAccountDeletionConfirmationEmail,
      ).toHaveBeenCalledWith(
        user.email,
        expect.stringMatching(/^[a-f0-9]{64}$/),
        user.first_name,
        'en',
      );
      expect(sessionsRepo.update).toHaveBeenCalled();
      expect(res.clearCookie).toHaveBeenCalled();
    });

    it('clears pending OAuth confirmation state when confirmation email delivery fails', async () => {
      const res = mockRes();
      const user = fakeUser({
        password_hash: null,
        google_subject: 'google-subject',
      });
      usersService.findByIdForAuth.mockResolvedValue(user);
      usersService.setAccountDeletionState.mockResolvedValue(user);
      mailService.sendAccountDeletionConfirmationEmail.mockRejectedValueOnce(
        new Error('Delivery failed'),
      );

      await expect(
        service.deleteAccount(user.id, '', asResponse(res), 'en'),
      ).rejects.toThrow('Account deletion email could not be sent');

      expect(usersService.clearAccountDeletionState).toHaveBeenCalledWith(
        user.id,
      );
      expect(sessionsRepo.update).not.toHaveBeenCalled();
      expect(res.clearCookie).not.toHaveBeenCalled();
    });

    it('confirms OAuth deletion tokens and schedules the 30-day grace period', async () => {
      const user = fakeUser({
        password_hash: null,
        account_deletion_confirm_expires: new Date('2999-01-01T00:00:00.000Z'),
      });
      usersService.findByAccountDeletionConfirmTokenHash.mockResolvedValue(
        user,
      );
      usersService.setAccountDeletionState.mockResolvedValue(user);

      const result = await service.confirmAccountDeletion('a'.repeat(64), 'en');

      expect(result.status).toBe(AccountDeletionStatus.Scheduled);
      expect(usersService.setAccountDeletionState).toHaveBeenCalledWith(
        user.id,
        expect.objectContaining({
          scheduledFor: expect.any(Date),
          cancelTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          confirmTokenHash: null,
          confirmExpires: null,
        }),
      );
      expect(mailService.sendAccountDeletionScheduledEmail).toHaveBeenCalled();
      expect(sessionsRepo.update).toHaveBeenCalled();
    });

    it('rounds scheduled deletion timestamps up to a whole second', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-05-14T12:00:00.123Z'));
      const user = fakeUser({
        password_hash: null,
        account_deletion_confirm_expires: new Date('2026-05-14T12:15:00.000Z'),
      });
      usersService.findByAccountDeletionConfirmTokenHash.mockResolvedValue(
        user,
      );
      usersService.setAccountDeletionState.mockResolvedValue(user);

      try {
        const result = await service.confirmAccountDeletion(
          'a'.repeat(64),
          'en',
        );

        const expectedScheduledFor = new Date('2026-06-13T12:00:01.000Z');
        expect(result.scheduledFor).toBe(expectedScheduledFor.toISOString());
        expect(usersService.setAccountDeletionState).toHaveBeenCalledWith(
          user.id,
          expect.objectContaining({
            scheduledFor: expectedScheduledFor,
          }),
        );
        expect(
          accountDeletionScheduler.scheduleFinalization,
        ).toHaveBeenCalledWith(user.id, expectedScheduledFor);
        expect(
          mailService.sendAccountDeletionScheduledEmail,
        ).toHaveBeenCalledWith(
          user.email,
          expect.stringMatching(/^[a-f0-9]{64}$/),
          user.first_name,
          'en',
          expectedScheduledFor.toISOString(),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('cancels scheduled deletion from a cancellation token', async () => {
      const user = fakeUser({
        account_deletion_scheduled_for: new Date('2999-01-01T00:00:00.000Z'),
      });
      usersService.findByAccountDeletionCancelTokenHash.mockResolvedValue(user);

      await service.cancelAccountDeletion('b'.repeat(64), 'en');

      expect(usersService.clearAccountDeletionState).toHaveBeenCalledWith(
        user.id,
      );
      expect(
        mailService.sendAccountDeletionCancelledEmail,
      ).toHaveBeenCalledWith(user.email, user.first_name, 'en');
      expect(accountDeletionScheduler.cancelFinalization).toHaveBeenCalledWith(
        user.id,
      );
    });

    it('cancels pending deletion on successful login within the grace period', async () => {
      const user = fakeUser({
        email_verified: true,
        account_deletion_scheduled_for: new Date('2999-01-01T00:00:00.000Z'),
      });
      usersService.findByEmailForAuth.mockResolvedValue(user);
      const res = mockRes();

      await service.login(
        user.email,
        'Password1',
        asResponse(res),
        '127.0.0.1',
      );

      expect(usersService.clearAccountDeletionState).toHaveBeenCalledWith(
        user.id,
      );
      expect(mailService.sendAccountDeletionCancelledEmail).toHaveBeenCalled();
      expect(accountDeletionScheduler.cancelFinalization).toHaveBeenCalledWith(
        user.id,
      );
    });

    it('finalizes due deletions and removes managed media', async () => {
      const user = fakeUser({
        account_deletion_scheduled_for: new Date('2999-01-01T00:00:00.000Z'),
      });
      usersService.findDueAccountDeletions.mockResolvedValue([user]);
      usersService.findById.mockResolvedValue(user);
      inventoryProductsRepo.find.mockResolvedValue([
        {
          identity: {
            imageUrls: ['https://media.example.com/product.webp'],
          },
        },
      ]);

      const deleted = await service.processDueAccountDeletions(
        new Date('2999-01-01T00:00:01.000Z'),
      );

      expect(deleted).toBe(1);
      expect(
        cataloguePhotoStorageService.deleteManagedImageUrls,
      ).toHaveBeenCalledWith(['https://media.example.com/product.webp']);
      expect(
        cataloguePhotoStorageService.deleteManagedImagesForOwner,
      ).toHaveBeenCalledWith(user.id);
      expect(usersService.remove).toHaveBeenCalledWith(user.id);
    });

    it('keeps the account pending when managed product media cleanup fails', async () => {
      const scheduledFor = new Date('2999-01-01T00:00:00.000Z');
      const user = fakeUser({
        account_deletion_scheduled_for: scheduledFor,
      });
      usersService.findById.mockResolvedValue(user);
      inventoryProductsRepo.find.mockResolvedValue([
        {
          identity: {
            imageUrls: ['https://media.example.com/product.webp'],
          },
        },
      ]);
      cataloguePhotoStorageService.deleteManagedImageUrls.mockRejectedValueOnce(
        new Error('s3 unavailable'),
      );

      await expect(
        service.processScheduledAccountDeletion(
          user.id,
          scheduledFor,
          new Date('2999-01-01T00:00:01.000Z'),
        ),
      ).rejects.toThrow('s3 unavailable');

      expect(usersService.remove).not.toHaveBeenCalled();
    });

    it('does not finalize scheduler messages before the exact scheduled instant', async () => {
      const scheduledFor = new Date('2999-01-01T00:00:00.500Z');
      const user = fakeUser({
        account_deletion_scheduled_for: scheduledFor,
      });
      usersService.findById.mockResolvedValue(user);

      const deleted = await service.processScheduledAccountDeletion(
        user.id,
        scheduledFor,
        new Date('2999-01-01T00:00:00.499Z'),
      );

      expect(deleted).toBe(false);
      expect(usersService.remove).not.toHaveBeenCalled();
    });

    it('ignores stale scheduler messages for a newer deletion request', async () => {
      const user = fakeUser({
        account_deletion_scheduled_for: new Date('2999-01-02T00:00:00.000Z'),
      });
      usersService.findById.mockResolvedValue(user);

      const deleted = await service.processScheduledAccountDeletion(
        user.id,
        new Date('2999-01-01T00:00:00.000Z'),
      );

      expect(deleted).toBe(false);
      expect(usersService.remove).not.toHaveBeenCalled();
    });

    it('finalizes due scheduler messages when the DB state still matches', async () => {
      const scheduledFor = new Date('2999-01-01T00:00:00.000Z');
      const user = fakeUser({
        account_deletion_scheduled_for: scheduledFor,
      });
      usersService.findById.mockResolvedValue(user);

      const deleted = await service.processScheduledAccountDeletion(
        user.id,
        scheduledFor,
        new Date('2999-01-01T00:00:01.000Z'),
      );

      expect(deleted).toBe(true);
      expect(usersService.remove).toHaveBeenCalledWith(user.id);
    });
  });
});

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserConsent } from '../users/entities/user-consent.entity';
import { User } from '../users/entities/user.entity';
import { UserDataAccessLogService } from '../users/user-data-access-log.service';
import {
  UserConsentType,
  UserDataAccessActorType,
  UserDataAccessEventType,
  UserDataAccessPurpose,
} from '../users/user-consent.constants';
import { UsersService } from '../users/users.service';
import { SkinProfile } from './entities/skin-profile.entity';
import { SkinProfileService } from './skin-profile.service';

const mockRepo = () => ({
  findOne: jest.fn(),
  create: jest.fn().mockImplementation((data) => data),
  save: jest.fn().mockImplementation((data) => Promise.resolve(data)),
  remove: jest.fn().mockResolvedValue(undefined),
});

describe('SkinProfileService', () => {
  let service: SkinProfileService;
  let repo: Record<string, jest.Mock>;
  let consentsRepo: Record<string, jest.Mock>;
  let usersService: Record<string, jest.Mock>;
  let dataAccessLogService: Record<string, jest.Mock>;

  beforeEach(async () => {
    repo = mockRepo();
    consentsRepo = mockRepo();
    consentsRepo.findOne = jest.fn().mockResolvedValue(null);
    usersService = {
      findById: jest.fn(),
      update: jest.fn().mockResolvedValue(null),
    };
    dataAccessLogService = {
      recordDataAccess: jest.fn().mockResolvedValue(undefined),
      recordConsentEvent: jest.fn().mockResolvedValue(undefined),
      listForUser: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SkinProfileService,
        { provide: getRepositoryToken(SkinProfile), useValue: repo },
        { provide: getRepositoryToken(UserConsent), useValue: consentsRepo },
        { provide: UsersService, useValue: usersService },
        { provide: UserDataAccessLogService, useValue: dataAccessLogService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'LEGAL_PRIVACY_VERSION' ? '1.0.0' : undefined,
            ),
            getOrThrow: jest.fn((key: string) => {
              if (key === 'LEGAL_PRIVACY_VERSION') {
                return '1.0.0';
              }
              throw new Error(`Missing config ${key}`);
            }),
          },
        },
      ],
    }).compile();

    service = module.get<SkinProfileService>(SkinProfileService);
  });

  const fakeUser = (overrides: Partial<User> = {}): User =>
    ({
      id: '01TESTUSER',
      email: 'test@example.com',
      email_verified: true,
      ...overrides,
    }) as User;

  const fakeProfile = (overrides: Partial<SkinProfile> = {}): SkinProfile =>
    ({
      id: '01PROFILE',
      user_id: '01TESTUSER',
      skin_type: 'oily',
      skin_tone: 'medium',
      ethnicity: 'black',
      current_concerns: ['acne'],
      country_code: 'NG',
      city: 'Lagos',
      fitzpatrick_phototype: 'IV',
      primary_goal: 'acne',
      allow_smart_picks: true,
      budget_tier: 'mid',
      skin_behavior: {
        pih_tendency: 'often',
        melasma_tendency: 'never',
        keloid_tendency: 'never',
        sunscreen_habit: 'most_days',
        sunscreen_tolerance: 'fine',
      },
      routine_preferences: {
        pace: 'cautious',
        fragrance_free: true,
        non_comedogenic: true,
        sunscreen_filter: 'hybrid',
        sunscreen_finish: 'natural',
      },
      concern_details: {
        per_concern: [{ concern: 'acne', severity: 'moderate', priority: 1 }],
      },
      hormonal_context: {},
      created_at: new Date(),
      updated_at: new Date(),
      ...overrides,
    }) as SkinProfile;

  const validCreateDto = () => ({
    skinType: 'oily',
    skinTone: 'medium',
    fitzpatrickPhototype: 'IV',
    dateOfBirth: '1992-04-15',
    sexAtBirth: 'female',
    ethnicity: 'black',
    currentConcerns: ['acne'],
    primaryGoal: 'acne',
    budgetTier: 'mid',
    allowSmartPicks: true,
    skinBehavior: {
      pih_tendency: 'often',
      melasma_tendency: 'never',
      keloid_tendency: 'never',
      sunscreen_habit: 'most_days',
      sunscreen_tolerance: 'fine',
    },
    routinePreferences: {
      pace: 'cautious',
      fragrance_free: true,
      non_comedogenic: true,
      sunscreen_filter: 'hybrid',
      sunscreen_finish: 'natural',
    },
    concernDetails: {
      per_concern: [{ concern: 'acne', severity: 'moderate', priority: 1 }],
    },
  });

  describe('create', () => {
    it('creates profile for verified user', async () => {
      usersService.findById.mockResolvedValue(fakeUser());
      repo.findOne.mockResolvedValue(null);

      const result = await service.create('01TESTUSER', validCreateDto());

      expect(repo.save).toHaveBeenCalled();
      expect(result.skin_type).toBe('oily');
      expect(usersService.update).toHaveBeenCalledWith(
        '01TESTUSER',
        expect.objectContaining({
          date_of_birth: '1992-04-15',
          sex_at_birth: 'female',
        }),
      );
    });

    it('rejects incomplete essentials', async () => {
      usersService.findById.mockResolvedValue(fakeUser());
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.create('01TESTUSER', {
          ...validCreateDto(),
          skinBehavior: { sunscreen_habit: 'most_days' },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects out-of-range date of birth', async () => {
      usersService.findById.mockResolvedValue(fakeUser());
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.create('01TESTUSER', {
          ...validCreateDto(),
          dateOfBirth: '2025-01-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('requires explicit location consent when saving location', async () => {
      usersService.findById.mockResolvedValue(fakeUser());
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.create('01TESTUSER', {
          ...validCreateDto(),
          countryCode: 'SE',
          city: 'Stockholm',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('records location consent when saving location', async () => {
      usersService.findById.mockResolvedValue(fakeUser());
      repo.findOne.mockResolvedValue(null);

      await service.create('01TESTUSER', {
        ...validCreateDto(),
        countryCode: 'SE',
        city: 'Stockholm',
        locationConsent: true,
      });

      expect(consentsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: '01TESTUSER',
          consent_type: UserConsentType.LocationProcessing,
          granted: true,
          consent_version: '1.0.0',
        }),
      );
      expect(dataAccessLogService.recordConsentEvent).toHaveBeenCalledWith(
        '01TESTUSER',
        UserConsentType.LocationProcessing,
        UserDataAccessEventType.ConsentGranted,
        UserDataAccessPurpose.ConsentGrant,
      );
    });

    it('rejects unverified user', async () => {
      usersService.findById.mockResolvedValue(
        fakeUser({ email_verified: false }),
      );

      await expect(
        service.create('01TESTUSER', validCreateDto()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects duplicate profile', async () => {
      usersService.findById.mockResolvedValue(fakeUser());
      repo.findOne.mockResolvedValue(fakeProfile());

      await expect(
        service.create('01TESTUSER', validCreateDto()),
      ).rejects.toThrow(ConflictException);
    });

    it('requires health consent for health context', async () => {
      usersService.findById.mockResolvedValue(fakeUser());
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.create('01TESTUSER', {
          ...validCreateDto(),
          pregnancyStatus: 'pregnant',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('records hormonal consent when hormonal context is saved', async () => {
      usersService.findById.mockResolvedValue(fakeUser());
      repo.findOne.mockResolvedValue(null);

      await service.create('01TESTUSER', {
        ...validCreateDto(),
        hormonalContext: { cycle_pattern: 'regular' },
        hormonalContextConsent: true,
      });

      expect(consentsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: '01TESTUSER',
          consent_type: UserConsentType.HormonalContextProcessing,
          granted: true,
          consent_version: '1.0.0',
        }),
      );
    });

    it('rejects hormonal context when sex at birth is male', async () => {
      usersService.findById.mockResolvedValue(fakeUser());
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.create('01TESTUSER', {
          ...validCreateDto(),
          sexAtBirth: 'male',
          hormonalContext: { cycle_pattern: 'regular' },
          hormonalContextConsent: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findByUserId', () => {
    it('returns profile when found', async () => {
      const profile = fakeProfile();
      repo.findOne.mockResolvedValue(profile);

      const result = await service.findByUserId('01TESTUSER');

      expect(result).toEqual(profile);
      expect(dataAccessLogService.recordDataAccess).not.toHaveBeenCalled();
    });

    it('returns null when not found', async () => {
      repo.findOne.mockResolvedValue(null);

      const result = await service.findByUserId('01TESTUSER');

      expect(result).toBeNull();
    });

    it('records sensitive access when requested', async () => {
      const profile = fakeProfile();
      repo.findOne.mockResolvedValue(profile);

      await service.findByUserId('01TESTUSER', {
        recordSensitiveAccess: true,
      });

      expect(dataAccessLogService.recordDataAccess).toHaveBeenCalledWith(
        '01TESTUSER',
        [UserConsentType.LocationProcessing],
        UserDataAccessPurpose.SkinProfileRead,
        UserDataAccessActorType.User,
      );
    });
  });

  describe('update', () => {
    it('updates partial fields', async () => {
      const profile = fakeProfile();
      repo.findOne.mockResolvedValue(profile);

      await service.update('01TESTUSER', { skinType: 'dry' });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ skin_type: 'dry' }),
      );
    });

    it('revokes location consent when location data is removed', async () => {
      const profile = fakeProfile();
      repo.findOne.mockResolvedValue(profile);
      consentsRepo.findOne.mockResolvedValue({
        id: '01CONSENT',
        user_id: '01TESTUSER',
        consent_type: UserConsentType.LocationProcessing,
        granted: true,
        revoked_at: null,
        created_at: new Date(),
      });

      await service.update('01TESTUSER', {
        countryCode: null,
        city: null,
      });

      expect(consentsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '01CONSENT',
          granted: false,
        }),
      );
      expect(dataAccessLogService.recordConsentEvent).toHaveBeenCalledWith(
        '01TESTUSER',
        UserConsentType.LocationProcessing,
        UserDataAccessEventType.ConsentRevoked,
        UserDataAccessPurpose.ConsentRevoke,
      );
    });

    it('does not persist user fields when consent validation fails', async () => {
      const profile = fakeProfile();
      repo.findOne.mockResolvedValue(profile);

      await expect(
        service.update('01TESTUSER', {
          dateOfBirth: '1991-04-15',
          pregnancyStatus: 'pregnant',
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(usersService.update).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('rejects active tolerances for unknown ingredients', async () => {
      repo.findOne.mockResolvedValue(fakeProfile());

      await expect(
        service.update('01TESTUSER', {
          activeTolerances: {
            unknown_active: { tolerance: 'tolerates_well' },
          },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects malformed active tolerance entries', async () => {
      repo.findOne.mockResolvedValue(fakeProfile());

      await expect(
        service.update('01TESTUSER', {
          activeTolerances: {
            retinoids: {
              tolerance: 'tolerates_well',
              last_used: '2025-02-31',
            },
          },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when profile not found', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.update('01TESTUSER', { skinType: 'dry' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('clears hormonal context when sex at birth changes to male', async () => {
      const profile = fakeProfile({
        user: fakeUser({ sex_at_birth: 'female' }),
        hormonal_context: { cycle_pattern: 'regular' },
      });
      repo.findOne.mockResolvedValue(profile);

      await service.update('01TESTUSER', { sexAtBirth: 'male' });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ hormonal_context: {} }),
      );
    });

    it('rejects hormonal context updates for a male profile', async () => {
      repo.findOne.mockResolvedValue(
        fakeProfile({ user: fakeUser({ sex_at_birth: 'male' }) }),
      );

      await expect(
        service.update('01TESTUSER', {
          hormonalContext: { cycle_pattern: 'regular' },
          hormonalContextConsent: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('computeCompleteness', () => {
    it('does not require hormonal context for male profiles', () => {
      const profile = fakeProfile({
        user: fakeUser({ sex_at_birth: 'male' }),
        active_tolerances: {
          retinoids: { tolerance: 'tolerates_well' },
        },
        reaction_history: {
          entries: [{ trigger: 'Salicylic acid' }],
        },
        lifestyle_context: {
          sleep: '6_to_8',
        },
        pregnancy_status: 'not_pregnant',
        safety_context: {
          conditions: ['eczema'],
        },
        hormonal_context: {},
      });

      expect(service.computeCompleteness(profile)).toBe(100);
    });
  });

  describe('remove', () => {
    it('deletes profile', async () => {
      repo.findOne.mockResolvedValue(fakeProfile());

      await service.remove('01TESTUSER');

      expect(repo.remove).toHaveBeenCalled();
    });

    it('throws when profile not found', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.remove('01TESTUSER')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

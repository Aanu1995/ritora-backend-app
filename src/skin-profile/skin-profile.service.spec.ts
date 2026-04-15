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

  beforeEach(async () => {
    repo = mockRepo();
    consentsRepo = mockRepo();
    consentsRepo.findOne = jest.fn().mockResolvedValue(null);
    usersService = {
      findById: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SkinProfileService,
        { provide: getRepositoryToken(SkinProfile), useValue: repo },
        { provide: getRepositoryToken(UserConsent), useValue: consentsRepo },
        { provide: UsersService, useValue: usersService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: unknown) =>
              key === 'LEGAL_PRIVACY_VERSION' ? '1.0.0' : fallback,
            ),
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
      age_range: '25_34',
      ethnicity: 'black',
      current_concerns: ['acne'],
      known_sensitivities: [],
      skin_goals: ['clear_acne'],
      country_code: 'NG',
      city: 'Lagos',
      routine_complexity: 'moderate',
      created_at: new Date(),
      updated_at: new Date(),
      ...overrides,
    }) as SkinProfile;

  describe('create', () => {
    it('creates profile for verified user', async () => {
      usersService.findById.mockResolvedValue(fakeUser());
      repo.findOne.mockResolvedValue(null);

      const result = await service.create('01TESTUSER', {
        skinType: 'oily',
        currentConcerns: ['acne'],
      });

      expect(repo.save).toHaveBeenCalled();
      expect(result.skin_type).toBe('oily');
    });

    it('requires explicit location consent when saving location', async () => {
      usersService.findById.mockResolvedValue(fakeUser());
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.create('01TESTUSER', {
          countryCode: 'SE',
          city: 'Stockholm',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('records location consent when saving location', async () => {
      usersService.findById.mockResolvedValue(fakeUser());
      repo.findOne.mockResolvedValue(null);

      await service.create('01TESTUSER', {
        countryCode: 'SE',
        city: 'Stockholm',
        locationConsent: true,
      });

      expect(consentsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: '01TESTUSER',
          consent_type: 'location_processing',
          granted: true,
          consent_version: '1.0.0',
        }),
      );
    });

    it('rejects unverified user', async () => {
      usersService.findById.mockResolvedValue(
        fakeUser({ email_verified: false }),
      );

      await expect(
        service.create('01TESTUSER', { skinType: 'oily' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects duplicate profile', async () => {
      usersService.findById.mockResolvedValue(fakeUser());
      repo.findOne.mockResolvedValue(fakeProfile());

      await expect(
        service.create('01TESTUSER', { skinType: 'oily' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findByUserId', () => {
    it('returns profile when found', async () => {
      const profile = fakeProfile();
      repo.findOne.mockResolvedValue(profile);

      const result = await service.findByUserId('01TESTUSER');

      expect(result).toEqual(profile);
    });

    it('returns null when not found', async () => {
      repo.findOne.mockResolvedValue(null);

      const result = await service.findByUserId('01TESTUSER');

      expect(result).toBeNull();
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
        consent_type: 'location_processing',
        granted: true,
        revoked_at: null,
        created_at: new Date(),
      });

      await service.update('01TESTUSER', {
        countryCode: null as unknown as string,
        city: null as unknown as string,
      });

      expect(consentsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '01CONSENT',
          granted: false,
        }),
      );
    });

    it('throws when profile not found', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.update('01TESTUSER', { skinType: 'dry' }),
      ).rejects.toThrow(NotFoundException);
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

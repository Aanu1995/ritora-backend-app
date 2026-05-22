import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SkinProfile } from './entities/skin-profile.entity';
import { SkinProfileController } from './skin-profile.controller';
import { SkinProfileService } from './skin-profile.service';
import { User } from '../users/entities/user.entity';
import {
  UserConsentType,
  UserDataAccessActorType,
  UserDataAccessEventType,
  UserDataAccessPurpose,
} from '../users/user-consent.constants';

const mockService = () => ({
  findByUserId: jest.fn(),
  listDataAccessLogs: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  clearHealthContext: jest.fn(),
  clearHormonalContext: jest.fn(),
  computeCompleteness: jest.fn().mockReturnValue(0),
  hasActiveHealthContextConsent: jest.fn().mockResolvedValue(false),
  hasActiveLocationContextConsent: jest.fn().mockResolvedValue(false),
  hasActiveHormonalContextConsent: jest.fn().mockResolvedValue(false),
});

describe('SkinProfileController', () => {
  let controller: SkinProfileController;
  let service: ReturnType<typeof mockService>;

  beforeEach(async () => {
    service = mockService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SkinProfileController],
      providers: [{ provide: SkinProfileService, useValue: service }],
    }).compile();

    controller = module.get<SkinProfileController>(SkinProfileController);
  });

  const fakeProfile = (): SkinProfile => ({
    id: '01PROFILE',
    user_id: '01TESTUSER',
    skin_type: 'oily',
    skin_tone: null,
    ethnicity: null,
    current_concerns: [],
    country_code: null,
    city: null,
    fitzpatrick_phototype: null,
    sensitivity_level: null,
    hydration_level: null,
    primary_goal: null,
    pregnancy_status: null,
    under_dermatologist_care: null,
    allow_smart_picks: true,
    budget_tier: null,
    safety_context: {},
    reaction_history: {},
    concern_details: {},
    skin_behavior: {},
    active_tolerances: {},
    routine_preferences: {},
    lifestyle_context: {},
    shopping_preferences: {},
    hormonal_context: {},
    created_at: new Date('2024-01-01'),
    updated_at: new Date('2024-01-01'),
    user: { id: '01TESTUSER' } as User,
    generateId: jest.fn(),
  });

  it('getOptions returns all constant arrays', () => {
    const result = controller.getOptions();

    expect(result.skinTypes).toContain('oily');
    expect(result.skinTones).toContain('medium');
    expect(result.concerns).toContain('acne');
    expect(result.cyclePatterns).toContain('regular');
    expect(result.hormonalBreakoutPatterns).toContain('before_period');
  });

  it('getProfile returns profile DTO', async () => {
    service.findByUserId.mockResolvedValue(fakeProfile());

    const result = await controller.getProfile('01TESTUSER');

    expect(result.id).toBe('01PROFILE');
    expect(result.skinType).toBe('oily');
    expect(service.findByUserId).toHaveBeenCalledWith('01TESTUSER', {
      recordSensitiveAccess: true,
      accessPurpose: UserDataAccessPurpose.SkinProfileRead,
    });
  });

  it('getProfile throws when not found', async () => {
    service.findByUserId.mockResolvedValue(null);

    await expect(controller.getProfile('01TESTUSER')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('getAccessLogs returns access log DTOs', async () => {
    service.listDataAccessLogs.mockResolvedValue([
      {
        id: '01ACCESSLOG',
        user_id: '01TESTUSER',
        consent_type: UserConsentType.HealthContextProcessing,
        event_type: UserDataAccessEventType.DataAccessed,
        actor_type: UserDataAccessActorType.User,
        purpose: UserDataAccessPurpose.SkinProfileRead,
        metadata: {},
        created_at: new Date('2024-01-03'),
      },
    ]);

    const result = await controller.getAccessLogs('01TESTUSER');

    expect(result).toEqual([
      expect.objectContaining({
        id: '01ACCESSLOG',
        consentType: UserConsentType.HealthContextProcessing,
        eventType: UserDataAccessEventType.DataAccessed,
        purpose: UserDataAccessPurpose.SkinProfileRead,
        createdAt: '2024-01-03T00:00:00.000Z',
      }),
    ]);
  });

  it('createProfile returns new profile DTO', async () => {
    service.create.mockResolvedValue(fakeProfile());

    const result = await controller.createProfile('01TESTUSER', {
      skinType: 'oily',
    });

    expect(result.skinType).toBe('oily');
    expect(service.create).toHaveBeenCalledWith('01TESTUSER', {
      skinType: 'oily',
    });
  });

  it('updateProfile returns updated profile DTO', async () => {
    const updated = { ...fakeProfile(), skin_type: 'dry' } as SkinProfile;
    service.update.mockResolvedValue(updated);

    const result = await controller.updateProfile('01TESTUSER', {
      skinType: 'dry',
    });

    expect(result.skinType).toBe('dry');
  });

  it('deleteProfile returns success message', async () => {
    service.remove.mockResolvedValue(undefined);

    const result = await controller.deleteProfile('01TESTUSER');

    expect(result.message).toBe('Skin profile deleted');
  });

  it('deleteHormonalContext clears hormonal context', async () => {
    service.clearHormonalContext.mockResolvedValue(fakeProfile());

    const result = await controller.deleteHormonalContext('01TESTUSER');

    expect(service.clearHormonalContext).toHaveBeenCalledWith('01TESTUSER');
    expect(result.hormonalContext).toEqual({});
  });
});

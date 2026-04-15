import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SkinProfile } from './entities/skin-profile.entity';
import { SkinProfileController } from './skin-profile.controller';
import { SkinProfileService } from './skin-profile.service';

const mockService = () => ({
  findByUserId: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
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

  const fakeProfile = (): SkinProfile =>
    ({
      id: '01PROFILE',
      user_id: '01TESTUSER',
      skin_type: 'oily',
      skin_tone: null,
      age_range: null,
      ethnicity: null,
      current_concerns: [],
      known_sensitivities: [],
      skin_goals: [],
      country_code: null,
      city: null,
      routine_complexity: null,
      created_at: new Date('2024-01-01'),
      updated_at: new Date('2024-01-01'),
      user: {} as any,
      generateId: jest.fn(),
    }) as SkinProfile;

  it('getOptions returns all constant arrays', () => {
    const result = controller.getOptions();

    expect(result.skinTypes).toContain('oily');
    expect(result.skinTones).toContain('medium');
    expect(result.ageRanges).toContain('25_34');
    expect(result.concerns).toContain('acne');
    expect(result.goals).toContain('clear_acne');
    expect(result.complexities).toContain('moderate');
  });

  it('getProfile returns profile DTO', async () => {
    service.findByUserId.mockResolvedValue(fakeProfile());

    const result = await controller.getProfile('01TESTUSER');

    expect(result.id).toBe('01PROFILE');
    expect(result.skinType).toBe('oily');
  });

  it('getProfile throws when not found', async () => {
    service.findByUserId.mockResolvedValue(null);

    await expect(controller.getProfile('01TESTUSER')).rejects.toThrow(
      NotFoundException,
    );
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
});

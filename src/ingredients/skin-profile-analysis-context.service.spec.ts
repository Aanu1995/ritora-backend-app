import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { UserDataAccessLogService } from '../users/user-data-access-log.service';
import {
  UserConsentType,
  UserDataAccessPurpose,
} from '../users/user-consent.constants';
import { SkinProfileAnalysisContextService } from './skin-profile-analysis-context.service';

describe('SkinProfileAnalysisContextService', () => {
  const skinProfileRepository = {
    findOne: jest.fn(),
  };
  const consentsRepository = {
    find: jest.fn(),
  };
  const dataAccessLogService = {
    recordDataAccess: jest.fn(),
  };
  let service: SkinProfileAnalysisContextService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SkinProfileAnalysisContextService(
      skinProfileRepository as never,
      consentsRepository as never,
      dataAccessLogService as unknown as UserDataAccessLogService,
    );
  });

  it('returns null when the user has no skin profile', async () => {
    skinProfileRepository.findOne.mockResolvedValue(null);

    await expect(service.loadForUser('user-1')).resolves.toBeNull();

    expect(dataAccessLogService.recordDataAccess).not.toHaveBeenCalled();
    expect(consentsRepository.find).not.toHaveBeenCalled();
  });

  it('records requested sensitive access and masks reaction history without health consent', async () => {
    const profile = Object.assign(new SkinProfile(), {
      user_id: 'user-1',
      skin_type: 'sensitive',
      pregnancy_status: 'pregnant',
      safety_context: { conditions: ['eczema'] },
      reaction_history: {
        entries: [{ trigger: 'Niacinamide' }],
      },
      hormonal_context: { cycle_pattern: 'regular' },
    });
    skinProfileRepository.findOne.mockResolvedValue(profile);
    consentsRepository.find.mockResolvedValue([]);

    const result = await service.loadForUser('user-1');

    expect(dataAccessLogService.recordDataAccess).toHaveBeenCalledWith(
      'user-1',
      expect.arrayContaining([UserConsentType.HealthContextProcessing]),
      UserDataAccessPurpose.RecommendationAnalysis,
    );
    expect(result).toEqual(
      expect.objectContaining({
        skin_type: 'sensitive',
        pregnancy_status: null,
        safety_context: {},
        reaction_history: {},
        hormonal_context: {},
      }),
    );
  });

  it('keeps reaction history when health-context consent is active', async () => {
    const profile = Object.assign(new SkinProfile(), {
      user_id: 'user-1',
      skin_type: 'sensitive',
      pregnancy_status: 'not-pregnant',
      safety_context: { conditions: ['eczema'] },
      reaction_history: {
        entries: [{ trigger: 'Niacinamide' }],
      },
    });
    skinProfileRepository.findOne.mockResolvedValue(profile);
    consentsRepository.find.mockResolvedValue([
      { consent_type: UserConsentType.HealthContextProcessing },
    ]);

    const result = await service.loadForUser('user-1');

    expect(result?.reaction_history).toEqual({
      entries: [{ trigger: 'Niacinamide' }],
    });
    expect(result?.pregnancy_status).toBe('not-pregnant');
  });
});

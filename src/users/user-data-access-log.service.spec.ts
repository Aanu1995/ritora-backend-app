import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserConsent } from './entities/user-consent.entity';
import { UserDataAccessLog } from './entities/user-data-access-log.entity';
import { UserDataAccessLogService } from './user-data-access-log.service';
import {
  UserConsentType,
  UserDataAccessEventType,
  UserDataAccessPurpose,
} from './user-consent.constants';

const mockRepo = () => ({
  create: jest.fn().mockImplementation((data) => data),
  find: jest.fn().mockResolvedValue([]),
  save: jest.fn().mockResolvedValue(undefined),
});

describe('UserDataAccessLogService', () => {
  let service: UserDataAccessLogService;
  let accessLogRepo: ReturnType<typeof mockRepo>;
  let consentsRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    accessLogRepo = mockRepo();
    consentsRepo = mockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserDataAccessLogService,
        {
          provide: getRepositoryToken(UserDataAccessLog),
          useValue: accessLogRepo,
        },
        { provide: getRepositoryToken(UserConsent), useValue: consentsRepo },
      ],
    }).compile();

    service = module.get<UserDataAccessLogService>(UserDataAccessLogService);
  });

  it('records data access only for active consent types', async () => {
    consentsRepo.find.mockResolvedValue([
      { consent_type: UserConsentType.HealthContextProcessing },
    ]);

    await service.recordDataAccess(
      '01TESTUSER',
      [
        UserConsentType.LocationProcessing,
        UserConsentType.HealthContextProcessing,
      ],
      UserDataAccessPurpose.SkinProfileRead,
    );

    expect(accessLogRepo.save).toHaveBeenCalledWith([
      expect.objectContaining({
        user_id: '01TESTUSER',
        consent_type: UserConsentType.HealthContextProcessing,
        event_type: UserDataAccessEventType.DataAccessed,
        purpose: UserDataAccessPurpose.SkinProfileRead,
      }),
    ]);
  });

  it('does not write an access log when no consent is active', async () => {
    consentsRepo.find.mockResolvedValue([]);

    await service.recordDataAccess(
      '01TESTUSER',
      [UserConsentType.LocationProcessing],
      UserDataAccessPurpose.RecommendationAnalysis,
    );

    expect(accessLogRepo.save).not.toHaveBeenCalled();
  });

  it('lists AI suggestion consent audit events with privacy access logs', async () => {
    await service.listForUser('01TESTUSER');

    const consentTypeFilter = accessLogRepo.find.mock.calls[0]?.[0].where
      .consent_type as { _value?: UserConsentType[] };
    expect(consentTypeFilter._value).toEqual(
      expect.arrayContaining([
        UserConsentType.HealthContextProcessing,
        UserConsentType.AiSuggestionProcessing,
      ]),
    );
  });
});

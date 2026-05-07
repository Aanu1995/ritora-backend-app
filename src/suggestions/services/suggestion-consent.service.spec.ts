import { ObjectLiteral, Repository } from 'typeorm';
import { UserConsent } from '../../users/entities/user-consent.entity';
import { UserDataAccessLogService } from '../../users/user-data-access-log.service';
import { UserConsentType } from '../../users/user-consent.constants';
import { SuggestionConsentService } from './suggestion-consent.service';

describe('SuggestionConsentService', () => {
  const consentsRepo = repo<UserConsent>();
  const dataAccessLog = {
    recordConsentEvent: jest.fn(),
  } as unknown as jest.Mocked<UserDataAccessLogService>;
  const service = new SuggestionConsentService(consentsRepo, dataAccessLog);

  beforeEach(() => {
    jest.clearAllMocks();
    consentsRepo.findOne.mockResolvedValue(null);
    consentsRepo.create.mockImplementation((value) => value as UserConsent);
    consentsRepo.save.mockImplementation(async (value) => value as UserConsent);
  });

  it('blocks AI personalization and sensitive reads without explicit consent', async () => {
    consentsRepo.find.mockResolvedValue([
      consent(UserConsentType.HealthContextProcessing),
    ]);

    await expect(service.evaluate('user-1')).resolves.toEqual({
      aiPersonalizationAllowed: false,
      canReadSensitiveContext: false,
      blockedReason: 'ai_suggestion_processing_consent_missing',
      grantedAt: null,
      activeSensitiveConsentTypes: [],
    });
  });

  it('allows sensitive context only when AI and sensitive consents are active', async () => {
    const grantedAt = new Date('2026-05-07T09:00:00.000Z');
    consentsRepo.find.mockResolvedValue([
      consent(UserConsentType.AiSuggestionProcessing, {
        granted_at: grantedAt,
      }),
      consent(UserConsentType.HealthContextProcessing),
      consent(UserConsentType.SkinProgressProcessing),
    ]);

    await expect(service.evaluate('user-1')).resolves.toEqual(
      expect.objectContaining({
        aiPersonalizationAllowed: true,
        canReadSensitiveContext: true,
        blockedReason: null,
        grantedAt,
        activeSensitiveConsentTypes: [
          UserConsentType.HealthContextProcessing,
          UserConsentType.SkinProgressProcessing,
        ],
      }),
    );
  });

  it('records explicit AI suggestion consent changes for auditability', async () => {
    consentsRepo.find.mockResolvedValue([
      consent(UserConsentType.AiSuggestionProcessing),
    ]);

    await service.updateAiSuggestionConsent('user-1', true, '127.0.0.1');

    expect(consentsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        consent_type: UserConsentType.AiSuggestionProcessing,
        granted: true,
        ip_address: '127.0.0.1',
      }),
    );
    expect(dataAccessLog.recordConsentEvent).toHaveBeenCalledWith(
      'user-1',
      UserConsentType.AiSuggestionProcessing,
      'consent_granted',
      'consent_grant',
      'user',
    );
  });
});

function repo<T extends ObjectLiteral>() {
  return {
    create: jest.fn((value) => value),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function consent(
  consentType: UserConsentType,
  overrides: Partial<UserConsent> = {},
): UserConsent {
  return {
    consent_type: consentType,
    granted_at: null,
    ...overrides,
  } as UserConsent;
}

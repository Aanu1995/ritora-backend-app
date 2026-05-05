import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { nowDate } from '../../common/utils/date';
import { UserConsent } from '../../users/entities/user-consent.entity';
import { UserDataAccessLogService } from '../../users/user-data-access-log.service';
import {
  SENSITIVE_SKIN_PROFILE_CONSENT_TYPES,
  SensitiveSkinProfileConsentType,
  UserDataAccessActorType,
  UserDataAccessEventType,
  UserDataAccessPurpose,
  UserConsentType,
} from '../../users/user-consent.constants';
import { SUGGESTION_AI_CONSENT_VERSION } from '../suggestions.constants';

export interface SuggestionConsentDecision {
  aiPersonalizationAllowed: boolean;
  canReadSensitiveContext: boolean;
  blockedReason: string | null;
  activeSensitiveConsentTypes: SensitiveSkinProfileConsentType[];
}

@Injectable()
export class SuggestionConsentService {
  constructor(
    @InjectRepository(UserConsent)
    private readonly consentsRepo: Repository<UserConsent>,
    private readonly dataAccessLog: UserDataAccessLogService,
  ) {}

  async evaluate(userId: string): Promise<SuggestionConsentDecision> {
    const requestedTypes: UserConsentType[] = [
      UserConsentType.AiSuggestionProcessing,
      ...SENSITIVE_SKIN_PROFILE_CONSENT_TYPES,
    ];
    const consents = await this.consentsRepo.find({
      where: {
        user_id: userId,
        consent_type: In(requestedTypes),
        granted: true,
        revoked_at: IsNull(),
      },
    });
    const activeTypes = new Set(
      consents.map((consent) => consent.consent_type),
    );
    const aiPersonalizationAllowed = activeTypes.has(
      UserConsentType.AiSuggestionProcessing,
    );
    const activeSensitiveConsentTypes =
      SENSITIVE_SKIN_PROFILE_CONSENT_TYPES.filter((consentType) =>
        activeTypes.has(consentType),
      );

    if (!aiPersonalizationAllowed) {
      return {
        aiPersonalizationAllowed: false,
        canReadSensitiveContext: false,
        blockedReason: 'ai_suggestion_processing_consent_missing',
        activeSensitiveConsentTypes: [],
      };
    }

    return {
      aiPersonalizationAllowed: true,
      canReadSensitiveContext: activeSensitiveConsentTypes.length > 0,
      blockedReason:
        activeSensitiveConsentTypes.length > 0
          ? null
          : 'sensitive_recommendation_context_consent_missing',
      activeSensitiveConsentTypes,
    };
  }

  async updateAiSuggestionConsent(
    userId: string,
    granted: boolean,
    ipAddress: string | null,
  ): Promise<SuggestionConsentDecision> {
    const activeConsent = await this.findActiveAiSuggestionConsent(userId);
    if (granted && !activeConsent) {
      await this.consentsRepo.save(
        this.consentsRepo.create({
          user_id: userId,
          consent_type: UserConsentType.AiSuggestionProcessing,
          consent_version: SUGGESTION_AI_CONSENT_VERSION,
          granted: true,
          granted_at: nowDate(),
          revoked_at: null,
          ip_address: ipAddress,
        }),
      );
      await this.recordConsentEvent(
        userId,
        UserDataAccessEventType.ConsentGranted,
      );
    }
    if (!granted && activeConsent) {
      activeConsent.granted = false;
      activeConsent.revoked_at = nowDate();
      await this.consentsRepo.save(activeConsent);
      await this.recordConsentEvent(
        userId,
        UserDataAccessEventType.ConsentRevoked,
      );
    }
    return this.evaluate(userId);
  }

  private async findActiveAiSuggestionConsent(
    userId: string,
  ): Promise<UserConsent | null> {
    return this.consentsRepo.findOne({
      where: {
        user_id: userId,
        consent_type: UserConsentType.AiSuggestionProcessing,
        granted: true,
        revoked_at: IsNull(),
      },
    });
  }

  private async recordConsentEvent(
    userId: string,
    eventType:
      | UserDataAccessEventType.ConsentGranted
      | UserDataAccessEventType.ConsentRevoked,
  ): Promise<void> {
    await this.dataAccessLog.recordConsentEvent(
      userId,
      UserConsentType.AiSuggestionProcessing,
      eventType,
      eventType === UserDataAccessEventType.ConsentGranted
        ? UserDataAccessPurpose.ConsentGrant
        : UserDataAccessPurpose.ConsentRevoke,
      UserDataAccessActorType.User,
    );
  }
}

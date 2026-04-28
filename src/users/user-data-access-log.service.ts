import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { nowDate } from '../common/utils/date';
import { UserConsent } from './entities/user-consent.entity';
import { UserDataAccessLog } from './entities/user-data-access-log.entity';
import {
  SENSITIVE_SKIN_PROFILE_CONSENT_TYPES,
  type SensitiveSkinProfileConsentType,
  UserDataAccessActorType,
  UserDataAccessEventType,
  UserDataAccessPurpose,
} from './user-consent.constants';

const DEFAULT_LOG_LIMIT = 100;

@Injectable()
export class UserDataAccessLogService {
  constructor(
    @InjectRepository(UserDataAccessLog)
    private readonly accessLogRepository: Repository<UserDataAccessLog>,
    @InjectRepository(UserConsent)
    private readonly consentsRepository: Repository<UserConsent>,
  ) {}

  async recordDataAccess(
    userId: string,
    consentTypes: SensitiveSkinProfileConsentType[],
    purpose: UserDataAccessPurpose,
    actorType: UserDataAccessActorType = UserDataAccessActorType.User,
  ): Promise<void> {
    if (consentTypes.length === 0) {
      return;
    }

    const uniqueConsentTypes = Array.from(new Set(consentTypes));
    const activeConsentTypes = await this.findActiveConsentTypes(
      userId,
      uniqueConsentTypes,
    );
    const now = nowDate();
    const logs = uniqueConsentTypes
      .filter((consentType) => activeConsentTypes.has(consentType))
      .map((consentType) =>
        this.accessLogRepository.create({
          user_id: userId,
          consent_type: consentType,
          event_type: UserDataAccessEventType.DataAccessed,
          actor_type: actorType,
          purpose,
          metadata: {},
          created_at: now,
        }),
      );

    if (logs.length > 0) {
      await this.accessLogRepository.save(logs);
    }
  }

  async recordConsentEvent(
    userId: string,
    consentType: SensitiveSkinProfileConsentType,
    eventType:
      | UserDataAccessEventType.ConsentGranted
      | UserDataAccessEventType.ConsentRevoked,
    purpose: UserDataAccessPurpose,
    actorType: UserDataAccessActorType = UserDataAccessActorType.User,
  ): Promise<void> {
    await this.accessLogRepository.save(
      this.accessLogRepository.create({
        user_id: userId,
        consent_type: consentType,
        event_type: eventType,
        actor_type: actorType,
        purpose,
        metadata: {},
      }),
    );
  }

  async listForUser(
    userId: string,
    limit: number = DEFAULT_LOG_LIMIT,
  ): Promise<UserDataAccessLog[]> {
    return this.accessLogRepository.find({
      where: {
        user_id: userId,
        consent_type: In([...SENSITIVE_SKIN_PROFILE_CONSENT_TYPES]),
      },
      order: { created_at: 'DESC' },
      take: limit,
    });
  }

  private async findActiveConsentTypes(
    userId: string,
    consentTypes: SensitiveSkinProfileConsentType[],
  ): Promise<Set<SensitiveSkinProfileConsentType>> {
    const consents = await this.consentsRepository.find({
      where: {
        user_id: userId,
        consent_type: In(consentTypes),
        granted: true,
        revoked_at: IsNull(),
      },
    });

    return new Set(
      consents.map(
        (consent) => consent.consent_type as SensitiveSkinProfileConsentType,
      ),
    );
  }
}

import { ApiProperty } from '@nestjs/swagger';
import { toIsoString } from '../../common/utils/date';
import { UserDataAccessLog } from '../entities/user-data-access-log.entity';
import {
  UserConsentType,
  UserDataAccessActorType,
  UserDataAccessEventType,
  UserDataAccessPurpose,
} from '../user-consent.constants';

export class UserDataAccessLogResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: UserConsentType })
  consentType: UserConsentType;

  @ApiProperty({ enum: UserDataAccessEventType })
  eventType: UserDataAccessEventType;

  @ApiProperty({ enum: UserDataAccessActorType })
  actorType: UserDataAccessActorType;

  @ApiProperty({ enum: UserDataAccessPurpose })
  purpose: UserDataAccessPurpose;

  @ApiProperty()
  createdAt: string;

  constructor(init: Partial<UserDataAccessLogResponseDto>) {
    Object.assign(this, init);
  }

  static fromEntity(log: UserDataAccessLog): UserDataAccessLogResponseDto {
    return new UserDataAccessLogResponseDto({
      id: log.id,
      consentType: log.consent_type,
      eventType: log.event_type,
      actorType: log.actor_type,
      purpose: log.purpose,
      createdAt: toIsoString(log.created_at),
    });
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { getSensitiveSkinProfileConsentTypes } from '../skin-profile/skin-profile-sensitive-data';
import { UserConsent } from '../users/entities/user-consent.entity';
import { UserDataAccessLogService } from '../users/user-data-access-log.service';
import {
  UserConsentType,
  UserDataAccessPurpose,
} from '../users/user-consent.constants';

@Injectable()
export class SkinProfileAnalysisContextService {
  constructor(
    @InjectRepository(SkinProfile)
    private readonly skinProfileRepository: Repository<SkinProfile>,
    @InjectRepository(UserConsent)
    private readonly consentsRepository: Repository<UserConsent>,
    private readonly dataAccessLogService: UserDataAccessLogService,
  ) {}

  async loadForUser(userId: string): Promise<SkinProfile | null> {
    const profile = await this.skinProfileRepository.findOne({
      where: { user_id: userId },
    });

    if (!profile) {
      return null;
    }

    const requestedConsentTypes = getSensitiveSkinProfileConsentTypes(profile);
    await this.dataAccessLogService.recordDataAccess(
      userId,
      requestedConsentTypes,
      UserDataAccessPurpose.RecommendationAnalysis,
    );

    if (requestedConsentTypes.length === 0) {
      return profile;
    }

    const activeConsentTypes = await this.findActiveConsentTypes(
      userId,
      requestedConsentTypes,
    );

    return scopeSkinProfileForIngredientAnalysis(profile, activeConsentTypes);
  }

  private async findActiveConsentTypes(
    userId: string,
    consentTypes: readonly UserConsentType[],
  ): Promise<Set<UserConsentType>> {
    const consents = await this.consentsRepository.find({
      where: {
        user_id: userId,
        consent_type: In(consentTypes),
        granted: true,
        revoked_at: IsNull(),
      },
    });

    return new Set(consents.map((consent) => consent.consent_type));
  }
}

export function scopeSkinProfileForIngredientAnalysis(
  profile: SkinProfile,
  activeConsentTypes: ReadonlySet<UserConsentType>,
): SkinProfile {
  return Object.assign(new SkinProfile(), profile, {
    country_code: activeConsentTypes.has(UserConsentType.LocationProcessing)
      ? profile.country_code
      : null,
    city: activeConsentTypes.has(UserConsentType.LocationProcessing)
      ? profile.city
      : null,
    pregnancy_status: activeConsentTypes.has(
      UserConsentType.HealthContextProcessing,
    )
      ? profile.pregnancy_status
      : null,
    under_dermatologist_care: activeConsentTypes.has(
      UserConsentType.HealthContextProcessing,
    )
      ? profile.under_dermatologist_care
      : null,
    safety_context: activeConsentTypes.has(
      UserConsentType.HealthContextProcessing,
    )
      ? profile.safety_context
      : {},
    reaction_history: activeConsentTypes.has(
      UserConsentType.HealthContextProcessing,
    )
      ? profile.reaction_history
      : {},
    hormonal_context: activeConsentTypes.has(
      UserConsentType.HormonalContextProcessing,
    )
      ? profile.hormonal_context
      : {},
  });
}

import { SkinProfile } from './entities/skin-profile.entity';
import {
  type SensitiveSkinProfileConsentType,
  UserConsentType,
} from '../users/user-consent.constants';

export function hasSkinProfileLocationData(profile: SkinProfile): boolean {
  return Boolean(profile.country_code?.trim() || profile.city?.trim());
}

export function hasSkinProfileHealthContextData(profile: SkinProfile): boolean {
  if (profile.pregnancy_status) return true;
  if (profile.under_dermatologist_care) return true;
  if (typeof profile.reaction_history?.has_known_reactions === 'boolean') {
    return true;
  }
  if ((profile.reaction_history?.entries ?? []).length > 0) return true;

  const ctx = profile.safety_context ?? {};
  if ((ctx.conditions?.length ?? 0) > 0) return true;
  if ((ctx.medications?.length ?? 0) > 0) return true;
  if ((ctx.recent_procedures?.length ?? 0) > 0) return true;
  if (ctx.photosensitizing_other) return true;

  return false;
}

export function hasSkinProfileHormonalContextData(
  profile: SkinProfile,
): boolean {
  return Object.keys(profile.hormonal_context ?? {}).length > 0;
}

export function getSensitiveSkinProfileConsentTypes(
  profile: SkinProfile,
): SensitiveSkinProfileConsentType[] {
  const consentTypes: SensitiveSkinProfileConsentType[] = [];

  if (hasSkinProfileLocationData(profile)) {
    consentTypes.push(UserConsentType.LocationProcessing);
  }

  if (hasSkinProfileHealthContextData(profile)) {
    consentTypes.push(UserConsentType.HealthContextProcessing);
  }

  if (hasSkinProfileHormonalContextData(profile)) {
    consentTypes.push(UserConsentType.HormonalContextProcessing);
  }

  return consentTypes;
}

import type { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import type { CommunitySafeProfileFacets } from './community.types';

export function normalizeCommunityTags(
  values: string[] | null | undefined,
): string[] {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => value.trim().toLowerCase().replace(/\s+/g, '-'))
        .filter(Boolean),
    ),
  ).slice(0, 12);
}

export function buildCommunitySafeFacets(
  profile: SkinProfile | null | undefined,
): CommunitySafeProfileFacets {
  return {
    skinType: profile?.skin_type ?? null,
    concernTags: normalizeCommunityTags(profile?.current_concerns ?? []),
    sensitivityLevel: profile?.sensitivity_level ?? null,
    skinToneRange: profile?.skin_tone ?? null,
    climateBucket:
      normalizeCommunityTags(
        profile?.lifestyle_context?.climate_sensitivities,
      )[0] ?? null,
    routinePace: profile?.routine_preferences?.pace ?? null,
    goalTags: normalizeCommunityTags(
      profile?.concern_details?.per_concern?.map((item) => item.concern) ??
        profile?.current_concerns ??
        [],
    ),
  };
}

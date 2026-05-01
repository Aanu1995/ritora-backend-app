import { BadRequestException } from '@nestjs/common';
import type { SkinProfile } from './entities/skin-profile.entity';

export const SKIN_PROFILE_REQUIRED_ERROR_CODE = 'skin_profile_required';
export const SKIN_PROFILE_REQUIRED_MESSAGE =
  'Complete your skin profile before continuing';

export function skinProfileRequiredException(): BadRequestException {
  return new BadRequestException({
    code: SKIN_PROFILE_REQUIRED_ERROR_CODE,
    message: SKIN_PROFILE_REQUIRED_MESSAGE,
  });
}

export function hasCompletedEssentialSkinProfile(
  profile: SkinProfile | null | undefined,
): boolean {
  if (!profile) {
    return false;
  }

  const behavior = profile.skin_behavior ?? {};
  const routine = profile.routine_preferences ?? {};
  const concernDetails = profile.concern_details?.per_concern ?? [];
  const hasConcernSeverity = (profile.current_concerns ?? []).every((concern) =>
    concernDetails.some(
      (entry) => entry.concern === concern && Boolean(entry.severity),
    ),
  );

  return [
    profile.user?.date_of_birth,
    profile.user?.sex_at_birth,
    profile.skin_type,
    profile.skin_tone,
    profile.fitzpatrick_phototype,
    profile.ethnicity,
    profile.current_concerns?.length ? 'current_concerns' : null,
    profile.primary_goal,
    hasConcernSeverity ? 'concern_severity' : null,
    behavior.pih_tendency,
    behavior.melasma_tendency,
    behavior.keloid_tendency,
    behavior.sunscreen_habit,
    behavior.sunscreen_tolerance,
    routine.pace,
    routine.fragrance_free == null ? null : 'fragrance_free',
    routine.non_comedogenic == null ? null : 'non_comedogenic',
    routine.sunscreen_filter,
    routine.sunscreen_finish,
    profile.budget_tier,
    profile.allow_smart_picks == null ? null : 'allow_smart_picks',
  ].every(Boolean);
}

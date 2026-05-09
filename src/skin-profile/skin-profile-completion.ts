import { BadRequestException } from '@nestjs/common';
import {
  SkinProfileSexAtBirth,
  SkinProfileWaterHardness,
  SkinProfileWaterSensitivity,
} from './dto/skin-profile.constants';
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

export function computeSkinProfileCompleteness(profile: SkinProfile): number {
  if (!profile) {
    return 0;
  }

  const sections = COMPLETENESS_SECTIONS.filter(
    (section) => section.isApplicable?.(profile) ?? true,
  );
  const completed = sections.reduce(
    (score, section) =>
      score + (section.isComplete(profile) ? section.weight : 0),
    0,
  );
  const total = sections.reduce((score, section) => score + section.weight, 0);

  return Math.round((completed / total) * 100);
}

export function hasCompletedEssentialSkinProfile(
  profile: SkinProfile | null | undefined,
): boolean {
  if (!profile) {
    return false;
  }

  const behavior = profile.skin_behavior ?? {};
  const lifestyle = profile.lifestyle_context ?? {};
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
    isSelectedWaterHardness(lifestyle.water_hardness) ? 'water_hardness' : null,
    isSelectedWaterSensitivity(lifestyle.water_sensitivity)
      ? 'water_sensitivity'
      : null,
    profile.budget_tier,
    profile.allow_smart_picks == null ? null : 'allow_smart_picks',
  ].every(Boolean);
}

export function isHormonalContextApplicable(profile: SkinProfile): boolean {
  return profile.user?.sex_at_birth !== SkinProfileSexAtBirth.Male;
}

const SkinProfileCompletenessSection = {
  Essentials: 'essentials',
  MedicalSafety: 'medical_safety',
  Reactions: 'reactions',
  ActiveTolerance: 'active_tolerance',
  Lifestyle: 'lifestyle',
  Hormonal: 'hormonal',
} as const;

type SkinProfileCompletenessSection =
  (typeof SkinProfileCompletenessSection)[keyof typeof SkinProfileCompletenessSection];

type CompletenessSection = {
  key: SkinProfileCompletenessSection;
  weight: number;
  isApplicable?: (profile: SkinProfile) => boolean;
  isComplete: (profile: SkinProfile) => boolean;
};

const COMPLETENESS_SECTIONS: CompletenessSection[] = [
  {
    key: SkinProfileCompletenessSection.Essentials,
    weight: 65,
    isComplete: hasCompletedEssentialSkinProfile,
  },
  {
    key: SkinProfileCompletenessSection.MedicalSafety,
    weight: 8,
    isComplete: hasMedicalSafetyContext,
  },
  {
    key: SkinProfileCompletenessSection.Reactions,
    weight: 8,
    isComplete: (profile) =>
      (profile.reaction_history?.entries?.length ?? 0) > 0,
  },
  {
    key: SkinProfileCompletenessSection.ActiveTolerance,
    weight: 8,
    isComplete: (profile) =>
      Object.keys(profile.active_tolerances ?? {}).length > 0,
  },
  {
    key: SkinProfileCompletenessSection.Lifestyle,
    weight: 6,
    isComplete: hasLifestyleContext,
  },
  {
    key: SkinProfileCompletenessSection.Hormonal,
    weight: 5,
    isApplicable: isHormonalContextApplicable,
    isComplete: (profile) =>
      Object.keys(profile.hormonal_context ?? {}).length > 0,
  },
];

function hasMedicalSafetyContext(profile: SkinProfile): boolean {
  return (
    Boolean(profile.pregnancy_status) ||
    Boolean(profile.under_dermatologist_care) ||
    (profile.safety_context?.conditions?.length ?? 0) > 0 ||
    (profile.safety_context?.medications?.length ?? 0) > 0 ||
    (profile.safety_context?.recent_procedures?.length ?? 0) > 0 ||
    Boolean(profile.safety_context?.photosensitizing_other)
  );
}

function hasLifestyleContext(profile: SkinProfile): boolean {
  const context = profile.lifestyle_context ?? {};
  return (
    Boolean(context.sleep) ||
    Boolean(context.stress) ||
    Boolean(context.water_intake) ||
    (context.diet_flags?.length ?? 0) > 0 ||
    Boolean(context.smoking) ||
    Boolean(context.alcohol) ||
    typeof context.mask_wearing === 'boolean' ||
    typeof context.shaving === 'boolean' ||
    (context.climate_sensitivities?.length ?? 0) > 0
  );
}

function isSelectedWaterHardness(value: unknown): boolean {
  return Object.values(SkinProfileWaterHardness).includes(
    value as SkinProfileWaterHardness,
  );
}

function isSelectedWaterSensitivity(value: unknown): boolean {
  return Object.values(SkinProfileWaterSensitivity).includes(
    value as SkinProfileWaterSensitivity,
  );
}

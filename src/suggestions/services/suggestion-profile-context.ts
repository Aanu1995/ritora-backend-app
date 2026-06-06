import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import { SuggestionContextSummary } from '../suggestion-context.types';
import { unique } from './suggestion-context-common';

export function buildGoalSignals(
  skinProfile: SkinProfile | null,
): NonNullable<SuggestionContextSummary['goalSignals']> {
  const primaryGoal = skinProfile?.primary_goal ?? null;
  const selectedGoals = skinProfile?.current_concerns ?? [];
  const details = skinProfile?.concern_details?.per_concern ?? [];
  const detailByConcern = new Map<string, (typeof details)[number]>();
  for (const detail of details) {
    detailByConcern.set(detail.concern, detail);
  }
  const concerns = unique([
    ...selectedGoals,
    ...details.map((detail) => detail.concern),
  ]);
  const signals = concerns
    .map((concern) => {
      const detail = detailByConcern.get(concern);
      const isPrimary = matchesGoalText(concern, primaryGoal);
      return {
        concern,
        priority: detail?.priority ?? null,
        severity: detail?.severity ?? null,
        durationMonths: detail?.duration_months ?? null,
        locations: detail?.locations ?? [],
        subtype: detail?.subtype ?? null,
        triggers: detail?.triggers ?? [],
        isPrimary,
      };
    })
    .sort(compareGoalSignalPriority);

  return {
    mainGoal: primaryGoal,
    primaryGoal,
    selectedGoals,
    secondaryGoals: signals.filter((signal) => !signal.isPrimary),
    activeConcernCount: concerns.length,
  };
}

export function buildProfileSignals(
  skinProfile: SkinProfile | null,
): NonNullable<SuggestionContextSummary['profileSignals']> {
  const safety = skinProfile?.safety_context ?? {};
  const routine = skinProfile?.routine_preferences ?? {};
  const behavior = skinProfile?.skin_behavior ?? {};
  const shopping = skinProfile?.shopping_preferences ?? {};
  return {
    safety: {
      pregnancyStatus: skinProfile?.pregnancy_status ?? null,
      underDermatologistCare: skinProfile?.under_dermatologist_care ?? null,
      conditions: safety.conditions ?? [],
      medications: safety.medications ?? [],
      photosensitizingOther: Boolean(safety.photosensitizing_other),
      recentProcedures: (safety.recent_procedures ?? []).map((procedure) => ({
        type: procedure.type,
        performedAt: procedure.performed_at ?? null,
      })),
    },
    routinePreferences: {
      pace: routine.pace ?? null,
      amMinutes: routine.am_minutes ?? null,
      pmMinutes: routine.pm_minutes ?? null,
      maxActiveNightsPerWeek: routine.max_active_nights_per_week ?? null,
      fragranceFree: routine.fragrance_free ?? null,
      nonComedogenic: routine.non_comedogenic ?? null,
      sunscreenFilter: routine.sunscreen_filter ?? null,
      sunscreenFinish: routine.sunscreen_finish ?? null,
    },
    skinBehavior: {
      burnTendency: behavior.burn_tendency ?? null,
      tanTendency: behavior.tan_tendency ?? null,
      pihTendency: behavior.pih_tendency ?? null,
      melasmaTendency: behavior.melasma_tendency ?? null,
      sunscreenHabit: behavior.sunscreen_habit ?? null,
      sunscreenTolerance: behavior.sunscreen_tolerance ?? null,
    },
    shoppingPreferences: {
      ingredientDislikes: shopping.ingredient_dislikes ?? [],
      productDislikes: shopping.product_dislikes ?? [],
      brandDislikes: shopping.brand_dislikes ?? [],
      texturePreferences: shopping.texture_preferences ?? [],
    },
    activeTolerances: Object.entries(skinProfile?.active_tolerances ?? {}).map(
      ([ingredient, tolerance]) => ({
        ingredient,
        tolerance: tolerance.tolerance ?? null,
        lastUsed: tolerance.last_used ?? null,
      }),
    ),
  };
}

function compareGoalSignalPriority(
  first: NonNullable<
    SuggestionContextSummary['goalSignals']
  >['secondaryGoals'][number],
  second: NonNullable<
    SuggestionContextSummary['goalSignals']
  >['secondaryGoals'][number],
): number {
  if (first.isPrimary !== second.isPrimary) return first.isPrimary ? -1 : 1;
  const firstPriority = first.priority ?? Number.MAX_SAFE_INTEGER;
  const secondPriority = second.priority ?? Number.MAX_SAFE_INTEGER;
  if (firstPriority !== secondPriority) return firstPriority - secondPriority;
  return first.concern.localeCompare(second.concern);
}

function matchesGoalText(concern: string, primaryGoal: string | null): boolean {
  if (!primaryGoal) return false;
  const normalizedConcern = concern.toLowerCase().replace(/[_-]+/g, ' ');
  const normalizedGoal = primaryGoal.toLowerCase().replace(/[_-]+/g, ' ');
  if (
    normalizedGoal.includes(normalizedConcern) ||
    normalizedConcern.includes(normalizedGoal)
  ) {
    return true;
  }
  return normalizedConcern
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3)
    .some((token) => normalizedGoal.includes(token));
}

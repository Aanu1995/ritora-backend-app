import { ApiProperty } from '@nestjs/swagger';
import { toIsoString } from '../../common/utils/date';
import {
  ActiveTolerances,
  ConcernDetails,
  HormonalContext,
  LifestyleContext,
  ReactionHistory,
  RoutinePreferences,
  SafetyContext,
  ShoppingPreferences,
  SkinBehavior,
  SkinProfile,
} from '../entities/skin-profile.entity';

export class SkinProfileResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ nullable: true })
  skinType: string | null;

  @ApiProperty({ nullable: true })
  dateOfBirth: string | null;

  @ApiProperty({ nullable: true })
  sexAtBirth: string | null;

  @ApiProperty({ nullable: true })
  skinTone: string | null;

  @ApiProperty({ nullable: true })
  ethnicity: string | null;

  @ApiProperty({ type: [String] })
  currentConcerns: string[];

  @ApiProperty({ nullable: true })
  countryCode: string | null;

  @ApiProperty({ nullable: true })
  city: string | null;

  @ApiProperty({ nullable: true })
  fitzpatrickPhototype: string | null;

  @ApiProperty({ nullable: true })
  sensitivityLevel: string | null;

  @ApiProperty({ nullable: true })
  hydrationLevel: string | null;

  @ApiProperty({ nullable: true })
  primaryGoal: string | null;

  @ApiProperty({ nullable: true })
  pregnancyStatus: string | null;

  @ApiProperty({ nullable: true })
  underDermatologistCare: string | null;

  @ApiProperty()
  allowSmartPicks: boolean;

  @ApiProperty({ nullable: true })
  budgetTier: string | null;

  @ApiProperty({ type: Object })
  safetyContext: SafetyContext;

  @ApiProperty({ type: Object })
  reactionHistory: ReactionHistory;

  @ApiProperty({ type: Object })
  concernDetails: ConcernDetails;

  @ApiProperty({ type: Object })
  skinBehavior: SkinBehavior;

  @ApiProperty({ type: Object })
  activeTolerances: ActiveTolerances;

  @ApiProperty({ type: Object })
  routinePreferences: RoutinePreferences;

  @ApiProperty({ type: Object })
  lifestyleContext: LifestyleContext;

  @ApiProperty({ type: Object })
  shoppingPreferences: ShoppingPreferences;

  @ApiProperty({ type: Object })
  hormonalContext: HormonalContext;

  @ApiProperty()
  completeness: number;

  @ApiProperty()
  hasHealthContextConsent: boolean;

  @ApiProperty()
  hasHormonalContextConsent: boolean;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  constructor(init: Partial<SkinProfileResponseDto>) {
    Object.assign(this, init);
  }

  static fromEntity(
    profile: SkinProfile,
    options: {
      completeness?: number;
      hasHealthContextConsent?: boolean;
      hasHormonalContextConsent?: boolean;
    } = {},
  ): SkinProfileResponseDto {
    return new SkinProfileResponseDto({
      id: profile.id,
      dateOfBirth: profile.user?.date_of_birth ?? null,
      sexAtBirth: profile.user?.sex_at_birth ?? null,
      skinType: profile.skin_type,
      skinTone: profile.skin_tone,
      ethnicity: profile.ethnicity,
      currentConcerns: profile.current_concerns ?? [],
      countryCode: profile.country_code,
      city: profile.city,
      fitzpatrickPhototype: profile.fitzpatrick_phototype,
      sensitivityLevel: profile.sensitivity_level,
      hydrationLevel: profile.hydration_level,
      primaryGoal: profile.primary_goal,
      pregnancyStatus: profile.pregnancy_status,
      underDermatologistCare: profile.under_dermatologist_care,
      allowSmartPicks: profile.allow_smart_picks,
      budgetTier: profile.budget_tier,
      safetyContext: profile.safety_context ?? {},
      reactionHistory: profile.reaction_history ?? {},
      concernDetails: profile.concern_details ?? {},
      skinBehavior: profile.skin_behavior ?? {},
      activeTolerances: profile.active_tolerances ?? {},
      routinePreferences: profile.routine_preferences ?? {},
      lifestyleContext: profile.lifestyle_context ?? {},
      shoppingPreferences: profile.shopping_preferences ?? {},
      hormonalContext: profile.hormonal_context ?? {},
      completeness: options.completeness ?? 0,
      hasHealthContextConsent: options.hasHealthContextConsent ?? false,
      hasHormonalContextConsent: options.hasHormonalContextConsent ?? false,
      createdAt: toIsoString(profile.created_at),
      updatedAt: toIsoString(profile.updated_at),
    });
  }
}

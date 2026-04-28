import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ulid } from 'ulid';
import { User } from '../../users/entities/user.entity';
import {
  encryptedBooleanFieldTransformer,
  encryptedJsonFieldTransformer,
  encryptedNullableStringFieldTransformer,
} from '../skin-profile-field-encryption';

export interface RecentProcedure {
  type: string;
  performed_at?: string | null;
}

export interface SafetyContext {
  conditions?: string[];
  medications?: string[];
  photosensitizing_other?: boolean;
  recent_procedures?: RecentProcedure[];
}

export interface ReactionEntry {
  trigger: string;
  trigger_type?: string;
  reaction_types?: string[];
  severity?: string;
  certainty?: string;
  patch_test_confirmed?: boolean;
}

export interface ReactionHistory {
  entries?: ReactionEntry[];
}

export interface ConcernDetail {
  concern: string;
  severity?: string;
  duration_months?: number;
  priority?: number;
  locations?: string[];
  subtype?: string;
  triggers?: string[];
}

export interface ConcernDetails {
  per_concern?: ConcernDetail[];
}

export interface SkinBehavior {
  burn_tendency?: string;
  tan_tendency?: string;
  pih_tendency?: string;
  melasma_tendency?: string;
  keloid_tendency?: string;
  daily_sun_exposure_hours?: string;
  sunscreen_habit?: string;
  sunscreen_tolerance?: string;
}

export interface ActiveTolerance {
  tolerance: string;
  last_used?: string | null;
}

export type ActiveTolerances = Record<string, ActiveTolerance>;

export interface RoutinePreferences {
  pace?: string;
  am_minutes?: number;
  pm_minutes?: number;
  max_active_nights_per_week?: number;
  fragrance_free?: boolean;
  non_comedogenic?: boolean;
  sunscreen_filter?: string;
  sunscreen_finish?: string;
}

export interface LifestyleContext {
  sleep?: string;
  stress?: string;
  water_intake?: string;
  diet_flags?: string[];
  smoking?: string;
  alcohol?: string;
  sweat_exercise?: string;
  mask_wearing?: boolean;
  shaving?: boolean;
  climate_sensitivities?: string[];
}

export interface ShoppingPreferences {
  ingredient_dislikes?: string[];
  product_dislikes?: string[];
  brand_dislikes?: string[];
  ingredient_ethics?: string[];
  texture_preferences?: string[];
}

export interface HormonalContext {
  cycle_pattern?: string;
  breakout_pattern?: string;
  cycle_related_breakouts?: boolean;
  uses_hormonal_contraception?: boolean;
  menopause_related_changes?: boolean;
}

const encryptedSkinProfileStringTransformer = (field: string) =>
  encryptedNullableStringFieldTransformer(`skin_profiles.${field}`);

const encryptedLegacySkinProfileStringTransformer = (field: string) =>
  encryptedNullableStringFieldTransformer(`skin_profiles.${field}`, ['string']);

const encryptedCurrentConcernsTransformer = encryptedJsonFieldTransformer<
  string[]
>('skin_profiles.current_concerns', []);

const encryptedSafetyContextTransformer =
  encryptedJsonFieldTransformer<SafetyContext>(
    'skin_profiles.safety_context',
    {},
    ['safety-context'],
  );

const encryptedReactionHistoryTransformer =
  encryptedJsonFieldTransformer<ReactionHistory>(
    'skin_profiles.reaction_history',
    {},
  );

const encryptedConcernDetailsTransformer =
  encryptedJsonFieldTransformer<ConcernDetails>(
    'skin_profiles.concern_details',
    {},
  );

const encryptedSkinBehaviorTransformer =
  encryptedJsonFieldTransformer<SkinBehavior>(
    'skin_profiles.skin_behavior',
    {},
  );

const encryptedActiveTolerancesTransformer =
  encryptedJsonFieldTransformer<ActiveTolerances>(
    'skin_profiles.active_tolerances',
    {},
  );

const encryptedRoutinePreferencesTransformer =
  encryptedJsonFieldTransformer<RoutinePreferences>(
    'skin_profiles.routine_preferences',
    {},
  );

const encryptedLifestyleContextTransformer =
  encryptedJsonFieldTransformer<LifestyleContext>(
    'skin_profiles.lifestyle_context',
    {},
  );

const encryptedShoppingPreferencesTransformer =
  encryptedJsonFieldTransformer<ShoppingPreferences>(
    'skin_profiles.shopping_preferences',
    {},
  );

const encryptedHormonalContextTransformer =
  encryptedJsonFieldTransformer<HormonalContext>(
    'skin_profiles.hormonal_context',
    {},
    ['hormonal-context'],
  );

const encryptedAllowSmartPicksTransformer = encryptedBooleanFieldTransformer(
  'skin_profiles.allow_smart_picks',
  true,
);

@Entity('skin_profiles')
export class SkinProfile {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string;

  @Column({ type: 'varchar', length: 26, unique: true })
  user_id: string;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedSkinProfileStringTransformer('skin_type'),
  })
  skin_type: string | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedSkinProfileStringTransformer('skin_tone'),
  })
  skin_tone: string | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedSkinProfileStringTransformer('ethnicity'),
  })
  ethnicity: string | null;

  @Column({
    type: 'jsonb',
    transformer: encryptedCurrentConcernsTransformer,
  })
  current_concerns: string[];

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedSkinProfileStringTransformer('country_code'),
  })
  country_code: string | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedSkinProfileStringTransformer('city'),
  })
  city: string | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedSkinProfileStringTransformer('fitzpatrick_phototype'),
  })
  fitzpatrick_phototype: string | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedSkinProfileStringTransformer('sensitivity_level'),
  })
  sensitivity_level: string | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedSkinProfileStringTransformer('hydration_level'),
  })
  hydration_level: string | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedSkinProfileStringTransformer('primary_goal'),
  })
  primary_goal: string | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer:
      encryptedLegacySkinProfileStringTransformer('pregnancy_status'),
  })
  pregnancy_status: string | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedLegacySkinProfileStringTransformer(
      'under_dermatologist_care',
    ),
  })
  under_dermatologist_care: string | null;

  @Column({
    type: 'text',
    transformer: encryptedAllowSmartPicksTransformer,
  })
  allow_smart_picks: boolean;

  @Column({
    type: 'text',
    nullable: true,
    transformer: encryptedSkinProfileStringTransformer('budget_tier'),
  })
  budget_tier: string | null;

  @Column({
    type: 'jsonb',
    transformer: encryptedSafetyContextTransformer,
  })
  safety_context: SafetyContext;

  @Column({
    type: 'jsonb',
    transformer: encryptedReactionHistoryTransformer,
  })
  reaction_history: ReactionHistory;

  @Column({
    type: 'jsonb',
    transformer: encryptedConcernDetailsTransformer,
  })
  concern_details: ConcernDetails;

  @Column({
    type: 'jsonb',
    transformer: encryptedSkinBehaviorTransformer,
  })
  skin_behavior: SkinBehavior;

  @Column({
    type: 'jsonb',
    transformer: encryptedActiveTolerancesTransformer,
  })
  active_tolerances: ActiveTolerances;

  @Column({
    type: 'jsonb',
    transformer: encryptedRoutinePreferencesTransformer,
  })
  routine_preferences: RoutinePreferences;

  @Column({
    type: 'jsonb',
    transformer: encryptedLifestyleContextTransformer,
  })
  lifestyle_context: LifestyleContext;

  @Column({
    type: 'jsonb',
    transformer: encryptedShoppingPreferencesTransformer,
  })
  shopping_preferences: ShoppingPreferences;

  @Column({
    type: 'jsonb',
    transformer: encryptedHormonalContextTransformer,
  })
  hormonal_context: HormonalContext;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = ulid();
    }
  }
}

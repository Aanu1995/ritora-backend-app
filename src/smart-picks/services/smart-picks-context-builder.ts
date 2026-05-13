import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DEFAULT_TIME_ZONE } from '../../common/timezone/timezone.utils';
import { EnvironmentContextService } from '../../environment-intelligence/environment-context.service';
import { EnvironmentContextSummary } from '../../environment-intelligence/environment-intelligence.types';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ShelfStatus } from '../../shelf/shelf.types';
import {
  SkinProfileWaterHardness,
  SkinProfileWaterSensitivity,
} from '../../skin-profile/dto/skin-profile.constants';
import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import { User } from '../../users/entities/user.entity';
import {
  SmartPicksBudgetTier,
  SmartPicksMissingProfileField,
  SmartPicksMode,
  SmartPicksProductPerformanceSummary,
} from '../smart-picks.types';
import { SmartPicksProductPerformanceService } from './smart-picks-product-performance.service';

export interface SmartPicksContext {
  user: User;
  skinProfile: SkinProfile | null;
  skinProfileRequired: boolean;
  missingProfileFields: SmartPicksMissingProfileField[];
  consentRequired: boolean;
  activeProducts: InventoryProduct[];
  allProducts: InventoryProduct[];
  environment: EnvironmentContextSummary | null;
  budgetTier: SmartPicksBudgetTier | null;
  mode: SmartPicksMode;
  productPerformance: SmartPicksProductPerformanceSummary[];
  inputsHash: string;
}

@Injectable()
export class SmartPicksContextBuilder {
  constructor(
    @InjectRepository(SkinProfile)
    private readonly skinProfileRepo: Repository<SkinProfile>,
    @InjectRepository(InventoryProduct)
    private readonly inventoryRepo: Repository<InventoryProduct>,
    private readonly environmentContext: EnvironmentContextService,
    private readonly productPerformanceService: SmartPicksProductPerformanceService,
  ) {}

  async build(
    user: User,
    requestedMode: SmartPicksMode | null,
  ): Promise<SmartPicksContext> {
    const [profile, allProducts] = await Promise.all([
      this.skinProfileRepo.findOne({
        where: { user_id: user.id },
        relations: ['user'],
      }),
      this.inventoryRepo.find({
        where: { user_id: user.id },
        order: { created_at: 'ASC' },
      }),
    ]);
    const activeProducts = allProducts.filter(
      (product) => product.status === ShelfStatus.Active,
    );
    const mode =
      requestedMode ?? (activeProducts.length < 3 ? 'starter' : 'refine');
    const missingProfileFields = missingSmartPicksProfileFields(profile);
    const skinProfileRequired = missingProfileFields.length > 0;
    const consentRequired = Boolean(profile && !profile.allow_smart_picks);
    const targetDate = new Date().toISOString().slice(0, 10);
    const environment =
      profile && !skinProfileRequired
        ? (
            await this.environmentContext.buildContext({
              userId: user.id,
              profile,
              targetDate,
              targetTime: '09:00:00',
              timeZone: user.time_zone ?? DEFAULT_TIME_ZONE,
            })
          ).summary
        : null;

    const budgetTier = toSmartPicksBudget(profile?.budget_tier ?? null);
    const productPerformance =
      profile && !skinProfileRequired && !consentRequired
        ? await this.productPerformanceService.summarizeForUser({
            userId: user.id,
            products: allProducts,
            primaryGoal: profile.primary_goal ?? null,
          })
        : [];
    const inputsHash = hashInputs({
      mode,
      budgetTier,
      profile: profile
        ? {
            updatedAt: profile.updated_at?.toISOString(),
            skinType: profile.skin_type,
            skinTone: profile.skin_tone,
            fitzpatrickPhototype: profile.fitzpatrick_phototype,
            ethnicity: profile.ethnicity,
            concerns: profile.current_concerns,
            concernDetails: profile.concern_details,
            primaryGoal: profile.primary_goal,
            countryCode: profile.country_code,
            city: profile.city,
            sensitivityLevel: profile.sensitivity_level,
            hydrationLevel: profile.hydration_level,
            skinBehavior: profile.skin_behavior,
            routinePreferences: profile.routine_preferences,
            safetyContext: profile.safety_context,
            pregnancyStatus: profile.pregnancy_status,
            underDermatologistCare: profile.under_dermatologist_care,
            reactionHistory: profile.reaction_history,
            activeTolerances: profile.active_tolerances,
            shoppingPreferences: profile.shopping_preferences,
            lifestyleContext: profile.lifestyle_context,
          }
        : null,
      products: allProducts.map((product) => ({
        id: product.id,
        updatedAt: product.updated_at?.toISOString(),
        brand: product.brand,
        name: product.name,
        category: product.category,
        status: product.status,
        ingredients: product.identity?.inciIngredients ?? [],
        benefits: product.identity?.benefits ?? [],
      })),
      environment,
      productPerformance,
    });

    return {
      user,
      skinProfile: profile,
      skinProfileRequired,
      missingProfileFields,
      consentRequired,
      activeProducts,
      allProducts,
      environment,
      budgetTier,
      mode,
      productPerformance,
      inputsHash,
    };
  }
}

const REQUIRED_SMART_PICK_PROFILE_FIELDS = [
  SmartPicksMissingProfileField.DateOfBirth,
  SmartPicksMissingProfileField.SexAtBirth,
  SmartPicksMissingProfileField.SkinType,
  SmartPicksMissingProfileField.SkinTone,
  SmartPicksMissingProfileField.FitzpatrickPhototype,
  SmartPicksMissingProfileField.Ethnicity,
  SmartPicksMissingProfileField.CurrentConcerns,
  SmartPicksMissingProfileField.PrimaryGoal,
  SmartPicksMissingProfileField.ConcernSeverity,
  SmartPicksMissingProfileField.PihTendency,
  SmartPicksMissingProfileField.MelasmaTendency,
  SmartPicksMissingProfileField.KeloidTendency,
  SmartPicksMissingProfileField.SunscreenHabit,
  SmartPicksMissingProfileField.SunscreenTolerance,
  SmartPicksMissingProfileField.RoutinePace,
  SmartPicksMissingProfileField.FragranceFree,
  SmartPicksMissingProfileField.NonComedogenic,
  SmartPicksMissingProfileField.SunscreenFilter,
  SmartPicksMissingProfileField.SunscreenFinish,
  SmartPicksMissingProfileField.WaterHardness,
  SmartPicksMissingProfileField.WaterSensitivity,
  SmartPicksMissingProfileField.BudgetTier,
  SmartPicksMissingProfileField.SmartPicksConsent,
] as const satisfies readonly SmartPicksMissingProfileField[];

export function missingSmartPicksProfileFields(
  profile: SkinProfile | null,
): SmartPicksMissingProfileField[] {
  if (!profile) return [...REQUIRED_SMART_PICK_PROFILE_FIELDS];

  const behavior = profile.skin_behavior ?? {};
  const lifestyle = profile.lifestyle_context ?? {};
  const routine = profile.routine_preferences ?? {};
  const concernDetails = profile.concern_details?.per_concern ?? [];
  const hasConcernSeverity = (profile.current_concerns ?? []).every((concern) =>
    concernDetails.some(
      (entry) => entry.concern === concern && Boolean(entry.severity),
    ),
  );
  const missing: SmartPicksMissingProfileField[] = [];
  const addWhenMissing = (
    field: SmartPicksMissingProfileField,
    value: unknown,
  ) => {
    if (!value) missing.push(field);
  };

  addWhenMissing(
    SmartPicksMissingProfileField.DateOfBirth,
    profile.user?.date_of_birth,
  );
  addWhenMissing(
    SmartPicksMissingProfileField.SexAtBirth,
    profile.user?.sex_at_birth,
  );
  addWhenMissing(SmartPicksMissingProfileField.SkinType, profile.skin_type);
  addWhenMissing(SmartPicksMissingProfileField.SkinTone, profile.skin_tone);
  addWhenMissing(
    SmartPicksMissingProfileField.FitzpatrickPhototype,
    profile.fitzpatrick_phototype,
  );
  addWhenMissing(SmartPicksMissingProfileField.Ethnicity, profile.ethnicity);
  addWhenMissing(
    SmartPicksMissingProfileField.CurrentConcerns,
    profile.current_concerns?.length ? profile.current_concerns : null,
  );
  addWhenMissing(
    SmartPicksMissingProfileField.PrimaryGoal,
    profile.primary_goal,
  );
  addWhenMissing(
    SmartPicksMissingProfileField.ConcernSeverity,
    hasConcernSeverity ? true : null,
  );
  addWhenMissing(
    SmartPicksMissingProfileField.PihTendency,
    behavior.pih_tendency,
  );
  addWhenMissing(
    SmartPicksMissingProfileField.MelasmaTendency,
    behavior.melasma_tendency,
  );
  addWhenMissing(
    SmartPicksMissingProfileField.KeloidTendency,
    behavior.keloid_tendency,
  );
  addWhenMissing(
    SmartPicksMissingProfileField.SunscreenHabit,
    behavior.sunscreen_habit,
  );
  addWhenMissing(
    SmartPicksMissingProfileField.SunscreenTolerance,
    behavior.sunscreen_tolerance,
  );
  addWhenMissing(SmartPicksMissingProfileField.RoutinePace, routine.pace);
  addWhenMissing(
    SmartPicksMissingProfileField.FragranceFree,
    routine.fragrance_free == null ? null : true,
  );
  addWhenMissing(
    SmartPicksMissingProfileField.NonComedogenic,
    routine.non_comedogenic == null ? null : true,
  );
  addWhenMissing(
    SmartPicksMissingProfileField.SunscreenFilter,
    routine.sunscreen_filter,
  );
  addWhenMissing(
    SmartPicksMissingProfileField.SunscreenFinish,
    routine.sunscreen_finish,
  );
  addWhenMissing(
    SmartPicksMissingProfileField.WaterHardness,
    isSelectedWaterHardness(lifestyle.water_hardness) ? true : null,
  );
  addWhenMissing(
    SmartPicksMissingProfileField.WaterSensitivity,
    isSelectedWaterSensitivity(lifestyle.water_sensitivity) ? true : null,
  );
  addWhenMissing(SmartPicksMissingProfileField.BudgetTier, profile.budget_tier);
  addWhenMissing(
    SmartPicksMissingProfileField.SmartPicksConsent,
    profile.allow_smart_picks == null ? null : true,
  );

  return missing;
}

export function toSmartPicksBudget(
  value: string | null | undefined,
): SmartPicksBudgetTier | null {
  return ['drugstore', 'mid', 'premium', 'luxury'].includes(value ?? '')
    ? (value as SmartPicksBudgetTier)
    : null;
}

function hashInputs(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value, stableJsonReplacer))
    .digest('hex');
}

function stableJsonReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = (value as Record<string, unknown>)[key];
        return acc;
      }, {});
  }
  return value;
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

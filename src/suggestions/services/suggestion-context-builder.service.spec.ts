import { ObjectLiteral, Repository } from 'typeorm';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { RoutineStep } from '../../schedule/entities/routine-step.entity';
import {
  DataProvenance,
  PreferredTimeOfDay,
  ProductCategory,
  ShelfStatus,
} from '../../shelf/shelf.types';
import { SkinJournalEntry } from '../../skin-journal/entities/skin-journal-entry.entity';
import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import { IngredientIntelligenceService } from '../../ingredients/ingredient-intelligence.service';
import type { ProductForAnalysis } from '../../ingredients/ingredients.types';
import {
  EnvironmentAirQualityRisk,
  EnvironmentConfidence,
  EnvironmentHumidityBand,
  EnvironmentProviderName,
  EnvironmentSeason,
  EnvironmentSignalKind,
  EnvironmentStatus,
  EnvironmentTemperatureBand,
  EnvironmentUvRisk,
  EnvironmentWaterHardness,
  EnvironmentWaterSensitivity,
} from '../../environment-intelligence/environment-intelligence.constants';
import { SuggestionContextCache } from '../entities/suggestion-context-cache.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { SuggestionEvidenceSourceId } from '../suggestions.constants';
import { SuggestionContextBuilder } from './suggestion-context-builder.service';

describe('SuggestionContextBuilder', () => {
  const cacheRepo = repo<SuggestionContextCache>();
  const builder = new SuggestionContextBuilder(cacheRepo);

  beforeEach(() => {
    jest.clearAllMocks();
    cacheRepo.findOne.mockResolvedValue(null);
    cacheRepo.create.mockImplementation(
      (value) => value as SuggestionContextCache,
    );
    cacheRepo.insert.mockResolvedValue({
      identifiers: [],
      generatedMaps: [],
      raw: [],
    });
  });

  it('builds scored, minimized context with reaction metadata and deterministic safety constraints', async () => {
    const summary = await builder.build({
      userId: 'user-1',
      targetDate: '2026-04-29',
      targetTime: '08:00',
      daypart: 'morning',
      skinProfile: skinProfile(),
      shelfActiveProducts: [retinoidProduct(), sunscreenProduct()],
      routineSteps: [
        {
          id: 'routine-1',
          inventory_product_id: 'retinoid-1',
          is_specialist_locked: true,
        } as RoutineStep,
      ],
      recentJournalEntries: [reactionJournalEntry()],
      recentApplications: [applicationLog()],
      recentSuggestions: [previousSuggestion()],
      environment: highUvDryEnvironment(),
    });

    expect(summary.skinProfile).toEqual(
      expect.objectContaining({
        primaryGoal: 'fade hyperpigmentation',
        sensitivityLevel: 'high',
      }),
    );
    expect(summary.reaction).toEqual(
      expect.objectContaining({
        hasSignal: true,
        barrierCompromised: true,
        severity: 'moderate',
        confidence: 0.86,
        affectedZones: ['cheeks'],
        photoInputImages: 3,
        multiAnglePhotoEntries: 1,
      }),
    );
    expect(summary.goalSignals).toEqual(
      expect.objectContaining({
        mainGoal: 'fade hyperpigmentation',
        primaryGoal: 'fade hyperpigmentation',
        selectedGoals: ['redness', 'dark spots'],
        activeConcernCount: 2,
        secondaryGoals: expect.arrayContaining([
          expect.objectContaining({
            concern: 'dark spots',
            priority: 1,
            severity: 'moderate',
            durationMonths: 10,
            locations: ['cheeks'],
          }),
        ]),
      }),
    );
    expect(summary.profileSignals).toEqual(
      expect.objectContaining({
        routinePreferences: expect.objectContaining({
          pace: 'slow',
          maxActiveNightsPerWeek: 2,
          fragranceFree: true,
        }),
        skinBehavior: expect.objectContaining({
          pihTendency: 'high',
          sunscreenHabit: 'daily',
        }),
      }),
    );
    expect(summary.journalSignals).toEqual(
      expect.objectContaining({
        recordsConsidered: 1,
        checkIns: expect.objectContaining({
          stressCounts: { high: 1 },
          sleepCounts: { lt5h: 1 },
          sunExposureCounts: { lots: 1 },
          sweatExerciseDays: 1,
          recentChangeKinds: ['started_new_product'],
          complaintNotes: ['Stinging around cheeks after yesterday.'],
        }),
        trendSignals: expect.arrayContaining([
          'reaction_signal_present',
          'barrier_compromised',
          'sun_exposure_recent',
          'sweat_exercise_recent',
          'new_product_recently_started',
        ]),
      }),
    );
    expect(summary.appliedProductHistory).toEqual(
      expect.objectContaining({
        windowStartDate: '2026-03-31',
        windowEndDate: '2026-04-29',
        recordsConsidered: 1,
        products: expect.arrayContaining([
          expect.objectContaining({
            productId: 'spf-1',
            brand: 'North Sun',
            name: 'Daily SPF 50 Sunscreen',
            statuses: ['substituted'],
            sourceTypes: ['added_off_shelf'],
            dayparts: ['morning'],
            useCount: 1,
            isOffShelf: true,
            isSubstitution: true,
          }),
        ]),
      }),
    );
    expect(summary.routineMemory).toEqual(
      expect.objectContaining({
        previousSuggestionCount: 1,
        sameDaypartSuggestionCount: 1,
        skippedProducts: { 'retinoid-1': 1 },
        substitutedProducts: { 'spf-1': 1 },
        adheredProducts: { 'spf-1': 1 },
        editedLogCount: 1,
        offShelfUseCount: 1,
      }),
    );
    expect(summary.routineMemory?.recentSameDaypartFingerprints[0]).toEqual(
      expect.objectContaining({
        productIds: ['spf-1'],
        productNames: ['North Sun Daily SPF 50 Sunscreen'],
      }),
    );
    expect(summary.environmentSignals).toEqual(
      expect.objectContaining({
        signalKinds: expect.arrayContaining([
          EnvironmentSignalKind.HighUv,
          EnvironmentSignalKind.LowHumidity,
        ]),
        safetyConstraints: expect.arrayContaining([
          'environment_high_uv',
          'environment_barrier_support',
        ]),
      }),
    );
    expect(summary.applicationPatterns).toEqual(
      expect.objectContaining({
        skippedByCategory: { serum: 1 },
        substitutedByCategory: { serum: 1 },
        addedOffShelfCount: 1,
        editedLogCount: 1,
        daysSinceLastApplication: 1,
        conservativeRestart: false,
      }),
    );
    expect(summary.safetyConstraints).toEqual(
      expect.arrayContaining([
        'barrier_recovery_mode',
        'avoid_new_strong_actives',
        'daytime_spf_available',
        'space_strong_actives',
        'environment_high_uv',
        'environment_barrier_support',
      ]),
    );
    expect(summary.environment).toEqual(
      expect.objectContaining({
        uvRisk: EnvironmentUvRisk.High,
        humidityBand: EnvironmentHumidityBand.Dry,
        transitionSignals: [EnvironmentSignalKind.SeasonalTransitionUvRising],
      }),
    );
    expect(summary.governance).toEqual(
      expect.objectContaining({
        safetyPolicyVersion: expect.stringContaining('production'),
        aiPersonalizationAllowed: true,
      }),
    );
    expect(summary.productScores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: 'retinoid-1',
          dataQuality: 'partial',
          activeTags: expect.arrayContaining(['retinoid']),
          evidenceSourceIds: expect.arrayContaining([
            SuggestionEvidenceSourceId.AadRetinoidRetinol,
            SuggestionEvidenceSourceId.DermNetTopicalRetinoids,
          ]),
          cautionReasons: expect.arrayContaining([
            'pause strong actives while reaction signal is present',
            'retinoid is usually better suited to evening',
          ]),
        }),
        expect.objectContaining({
          productId: 'spf-1',
          dataQuality: 'partial',
          activeTags: ['spf'],
          evidenceSourceIds: expect.arrayContaining([
            SuggestionEvidenceSourceId.AadSunscreenSelection,
            SuggestionEvidenceSourceId.OpenMeteoWeather,
          ]),
          suitabilityReasons: expect.arrayContaining([
            'daytime sun protection fit',
            'high UV fit',
          ]),
        }),
      ]),
    );
    expect(summary.skippedCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: 'retinoid-1',
          sourceIds: expect.arrayContaining([
            SuggestionEvidenceSourceId.AadRetinoidRetinol,
            SuggestionEvidenceSourceId.OpenMeteoWeather,
          ]),
        }),
      ]),
    );
    expect(summary.evidenceSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: SuggestionEvidenceSourceId.AadRetinoidRetinol,
        }),
        expect.objectContaining({
          id: SuggestionEvidenceSourceId.AadSunscreenSelection,
        }),
      ]),
    );
    expect(cacheRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
        user_id: 'user-1',
        context_date: '2026-04-29',
        target_time: '08:00',
        summary,
      }),
    );
  });

  it('reuses cached summaries when the input fingerprint has not changed', async () => {
    const firstSummary = await builder.build(emptyInput());
    jest.clearAllMocks();
    cacheRepo.findOne.mockResolvedValue({
      cache_key: firstSummary.cacheKey,
      summary: firstSummary,
    } as SuggestionContextCache);

    const summary = await builder.build(emptyInput());

    expect(summary).toBe(firstSummary);
    expect(cacheRepo.insert).not.toHaveBeenCalled();
    expect(cacheRepo.update).not.toHaveBeenCalled();
  });

  it('marks first-use contexts as conservative and downgrades strong actives', async () => {
    const summary = await builder.build({
      ...emptyInput(),
      shelfActiveProducts: [retinoidProduct()],
    });

    expect(summary.applicationPatterns).toEqual(
      expect.objectContaining({
        daysSinceLastApplication: null,
        conservativeRestart: true,
      }),
    );
    expect(summary.productScores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: 'retinoid-1',
          cautionReasons: expect.arrayContaining([
            'restart gently before using strong actives again',
          ]),
        }),
      ]),
    );
  });

  it('carries shelf ingredient-intelligence gaps into product quality', async () => {
    const ingredientIntelligence = {
      matchProducts: jest.fn((products: ProductForAnalysis[]) =>
        Promise.resolve(
          products.map((product) => ({
            product,
            matchedIngredients: [],
            unresolvedTokens: [...product.inciIngredients],
            totalTokens: product.inciIngredients.length,
            resolvedTokens: 0,
          })),
        ),
      ),
    } as unknown as IngredientIntelligenceService;
    const builderWithIngredientIntelligence = new SuggestionContextBuilder(
      cacheRepo,
      ingredientIntelligence,
    );

    const summary = await builderWithIngredientIntelligence.build({
      ...emptyInput(),
      shelfActiveProducts: [sunscreenProduct()],
    });

    expect(summary.productScores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: 'spf-1',
          dataQualityWarnings: expect.arrayContaining([
            'key active ingredients not matched',
          ]),
        }),
      ]),
    );
  });
});

function repo<T extends ObjectLiteral>() {
  return {
    findOne: jest.fn(),
    create: jest.fn((value) => value),
    insert: jest.fn(),
    update: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function skinProfile(): SkinProfile {
  return {
    id: 'profile-1',
    primary_goal: 'fade hyperpigmentation',
    skin_type: 'combination',
    sensitivity_level: 'high',
    current_concerns: ['redness', 'dark spots'],
    pregnancy_status: null,
    concern_details: {
      per_concern: [
        {
          concern: 'dark spots',
          severity: 'moderate',
          duration_months: 10,
          priority: 1,
          locations: ['cheeks'],
          subtype: 'post-inflammatory hyperpigmentation',
          triggers: ['sun exposure'],
        },
        {
          concern: 'redness',
          severity: 'mild',
          duration_months: 2,
          priority: 2,
          locations: ['cheeks'],
        },
      ],
    },
    safety_context: {
      conditions: ['eczema-prone'],
      medications: [],
      photosensitizing_other: false,
      recent_procedures: [],
    },
    routine_preferences: {
      pace: 'slow',
      max_active_nights_per_week: 2,
      fragrance_free: true,
      non_comedogenic: true,
      sunscreen_filter: 'mineral',
      sunscreen_finish: 'natural',
    },
    skin_behavior: {
      pih_tendency: 'high',
      sunscreen_habit: 'daily',
      sunscreen_tolerance: 'good',
    },
    shopping_preferences: {
      ingredient_dislikes: ['fragrance'],
      texture_preferences: ['lightweight'],
    },
    active_tolerances: {
      retinal: { tolerance: 'low', last_used: '2026-04-21' },
    },
    updated_at: new Date('2026-04-28T10:00:00.000Z'),
  } as unknown as SkinProfile;
}

function emptyInput() {
  return {
    userId: 'user-1',
    targetDate: '2026-04-29',
    targetTime: '08:00',
    daypart: 'morning' as const,
    skinProfile: null,
    shelfActiveProducts: [],
    routineSteps: [],
    recentJournalEntries: [],
    recentApplications: [],
    environment: null,
  };
}

function highUvDryEnvironment() {
  return {
    status: EnvironmentStatus.Available,
    provider: EnvironmentProviderName.OpenMeteo,
    generatedAt: '2026-04-29T06:00:00.000Z',
    locationPersonalized: true,
    season: EnvironmentSeason.Spring,
    temperatureCelsius: 18,
    temperatureBand: EnvironmentTemperatureBand.Mild,
    humidity: 34,
    humidityBand: EnvironmentHumidityBand.Dry,
    uvIndex: 7,
    uvRisk: EnvironmentUvRisk.High,
    airQualityIndex: 24,
    airQualityRisk: EnvironmentAirQualityRisk.Fair,
    pm25: 6,
    pm10: 12,
    pollenRisk: null,
    conditionLabel: 'Clear',
    waterHardness: EnvironmentWaterHardness.Moderate,
    waterSensitivity: EnvironmentWaterSensitivity.None,
    climateSensitivities: ['dry_air'],
    transitionSignals: [EnvironmentSignalKind.SeasonalTransitionUvRising],
    confidence: EnvironmentConfidence.Provider,
    stale: false,
    sourceIds: [
      SuggestionEvidenceSourceId.OpenMeteoWeather,
      SuggestionEvidenceSourceId.OpenMeteoAirQuality,
    ],
  };
}

function retinoidProduct(): InventoryProduct {
  return product({
    id: 'retinoid-1',
    brand: 'Ava Lab',
    name: 'Retinal Renewal Serum',
    category: ProductCategory.Serum,
    preferredTimeOfDay: PreferredTimeOfDay.Evening,
    inciIngredients: ['Retinal', 'Niacinamide'],
    benefits: ['texture support'],
  });
}

function sunscreenProduct(): InventoryProduct {
  return product({
    id: 'spf-1',
    brand: 'North Sun',
    name: 'Daily SPF 50 Sunscreen',
    category: ProductCategory.SunProtection,
    preferredTimeOfDay: PreferredTimeOfDay.Morning,
    inciIngredients: ['Zinc Oxide', 'Uvinul A Plus'],
    benefits: ['sun protection'],
  });
}

function product(input: {
  id: string;
  brand: string;
  name: string;
  category: ProductCategory;
  preferredTimeOfDay: PreferredTimeOfDay;
  inciIngredients: string[];
  benefits: string[];
}): InventoryProduct {
  return {
    id: input.id,
    user_id: 'user-1',
    brand: input.brand,
    name: input.name,
    category: input.category,
    status: ShelfStatus.Active,
    provenance: DataProvenance.PhotoLookup,
    identity: {
      brand: input.brand,
      name: input.name,
      category: input.category,
      barcode: null,
      imageUrls: [],
      sizeMl: null,
      description: null,
      benefits: input.benefits,
      suitedFor: [],
      inciIngredients: input.inciIngredients,
      inciLastConfirmedAt: '2026-04-01',
    },
    guidance: {
      applicationMethod: null,
      quantity: null,
      steps: [],
      cautions: [],
      waitMinutes: null,
    },
    manufacturer: {
      brand: input.brand,
      parentCompany: null,
      countryOfOrigin: null,
      countryOfManufacture: null,
      supportEmail: null,
      productUrl: null,
      websiteUrl: null,
    },
    user_fields: {
      openedAt: null,
      expiresAt: null,
      periodAfterOpeningMonths: null,
      pricePaid: null,
      pricePaidCurrency: null,
      purchasedFrom: null,
      personalNotes: null,
      preferredTimeOfDay: input.preferredTimeOfDay,
    },
    updated_at: new Date('2026-04-28T11:00:00.000Z'),
  } as unknown as InventoryProduct;
}

function reactionJournalEntry(): SkinJournalEntry {
  return {
    id: 'journal-1',
    user_id: 'user-1',
    entry_date: '2026-04-29',
    photo_object_key: 'skin-journal/user-1/2026-04-29.jpg',
    has_reaction_signal: true,
    overall_feel: 'bad',
    sleep_band: 'lt5h',
    stress_today: 'high',
    sun_exposure_today: 'lots',
    sweat_exercise_today: true,
    cycle_marker: 'late_cycle',
    recent_change: {
      kind: 'started_new_product',
      related_inventory_product_id: 'retinoid-1',
    },
    complaint_note: 'Stinging around cheeks after yesterday.',
    ratings: {
      dryness: 4,
      irritation: 4,
      sensitivity: 4,
    },
    analysis_observations: {
      image_quality: {
        face_detected: true,
        lighting_quality: 'good',
        framing_quality: 'good',
        blur_detected: false,
        issues: [],
      },
      per_angle_quality: [
        { angle: 'head_on' },
        { angle: 'left_profile' },
        { angle: 'right_profile' },
      ],
      reaction_signals: {
        reaction_detected: true,
        reaction_severity: 'moderate',
        confidence: 0.86,
        indicators: ['redness', 'stinging'],
      },
      barrier_signs: {
        barrier_compromise: true,
        indicators: ['dryness'],
      },
      detected_concerns: [
        {
          concern: 'redness_inflammation',
          severity: 'moderate',
          locations: ['cheeks'],
        },
      ],
    },
    updated_at: new Date('2026-04-29T05:30:00.000Z'),
  } as unknown as SkinJournalEntry;
}

function applicationLog(): ApplicationLog {
  return {
    id: 'log-1',
    target_date: '2026-04-28',
    daypart: 'morning',
    has_been_edited: true,
    updated_at: new Date('2026-04-28T20:00:00.000Z'),
    items: [
      {
        status: 'skipped',
        step_label: ProductCategory.Serum,
        is_ad_hoc: false,
        inventory_product_id: 'retinoid-1',
      },
      {
        status: 'substituted',
        step_label: ProductCategory.Serum,
        is_ad_hoc: true,
        item_source: 'added_off_shelf',
        substituted_with_product_id: 'spf-1',
        applied_snapshot: {
          product_id: 'spf-1',
          brand: 'North Sun',
          name: 'Daily SPF 50 Sunscreen',
          step_label: ProductCategory.SunProtection,
        },
        applied_at: new Date('2026-04-28T07:45:00.000Z'),
      },
    ],
  } as unknown as ApplicationLog;
}

function previousSuggestion(): SuggestionInstance {
  return {
    id: 'suggestion-1',
    target_date: '2026-04-28',
    target_time: '08:00',
    daypart: 'morning',
    steps: [
      {
        id: 'suggestion-step-1',
        step_order: 0,
        inventory_product_id: 'spf-1',
        product_brand_snapshot: 'North Sun',
        product_name_snapshot: 'Daily SPF 50 Sunscreen',
      },
    ],
    created_at: new Date('2026-04-28T06:00:00.000Z'),
  } as SuggestionInstance;
}

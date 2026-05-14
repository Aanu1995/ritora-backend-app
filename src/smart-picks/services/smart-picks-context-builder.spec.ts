import { ObjectLiteral, Repository } from 'typeorm';
import { EnvironmentContextService } from '../../environment-intelligence/environment-context.service';
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
import type { EnvironmentContextSummary } from '../../environment-intelligence/environment-intelligence.types';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ProductCategory, ShelfStatus } from '../../shelf/shelf.types';
import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import { User } from '../../users/entities/user.entity';
import {
  SmartPicksProductAdherence,
  SmartPicksProductPerformanceSignal,
  SmartPicksProductPerformanceSummary,
} from '../smart-picks.types';
import { SmartPicksContextBuilder } from './smart-picks-context-builder';
import { SmartPicksProductPerformanceService } from './smart-picks-product-performance.service';

describe('SmartPicksContextBuilder', () => {
  it('builds the Smart Picks context with derived performance signals but without raw history', async () => {
    const skinProfileRepo = repo<SkinProfile>();
    const inventoryRepo = repo<InventoryProduct>();
    const environmentContext = {
      buildContext: jest.fn().mockResolvedValue({ summary: null }),
    } as unknown as EnvironmentContextService;
    const productPerformance = {
      summarizeForUser: jest.fn().mockResolvedValue([
        {
          productId: 'cream-1',
          brand: 'Test Brand',
          productName: 'cream-1',
          category: ProductCategory.Moisturizer,
          usageDaysLast30: 18,
          usageDaysLast90: 44,
          firstUsedAt: '2026-03-01',
          lastUsedAt: '2026-05-10',
          adherence: SmartPicksProductAdherence.Consistent,
          goalTrend: SmartPicksProductPerformanceSignal.NotImproving,
          concernTrend: 'dryness',
          photoCheckpoints: 2,
          reactionSignalCount: 0,
          replacementCandidate: true,
          replacementReason:
            '44 logged use days and photo history still shows dryness.',
        },
      ]),
    } as unknown as jest.Mocked<SmartPicksProductPerformanceService>;
    skinProfileRepo.findOne.mockResolvedValue(profile());
    inventoryRepo.find.mockResolvedValue([
      product('cleanser-1', ProductCategory.Cleanser),
      product('cream-1', ProductCategory.Moisturizer),
    ]);
    const builder = new SmartPicksContextBuilder(
      skinProfileRepo,
      inventoryRepo,
      environmentContext,
      productPerformance,
    );

    const context = await builder.build(user(), null);

    expect(context.mode).toBe('starter');
    expect(context.activeProducts).toHaveLength(2);
    expect(context.productPerformance).toHaveLength(1);
    expect(productPerformance.summarizeForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        products: expect.arrayContaining([
          expect.objectContaining({ id: 'cream-1' }),
        ]),
        primaryGoal: 'dark_marks',
      }),
    );
    expect(context).not.toHaveProperty('recentJournalEntries');
    expect(context).not.toHaveProperty('recentApplications');
    expect(environmentContext.buildContext).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
    );
  });

  it('changes the inputs hash when safety-critical profile fields change', async () => {
    const baselineProfile = profile({
      pregnancy_status: 'not_pregnant',
      under_dermatologist_care: 'no',
    });
    const safetyChangedProfile = profile({
      pregnancy_status: 'pregnant',
      under_dermatologist_care: 'yes',
    });
    const baseline = await buildContextWithProfile(baselineProfile);
    const safetyChanged = await buildContextWithProfile(safetyChangedProfile);

    expect(safetyChanged.inputsHash).not.toBe(baseline.inputsHash);
  });

  it('keeps the inputs hash stable when only profile metadata timestamps change', async () => {
    const baseline = await buildContextWithProfile(
      profile({ updated_at: new Date('2026-05-10T08:00:00.000Z') }),
    );
    const metadataOnly = await buildContextWithProfile(
      profile({ updated_at: new Date('2026-05-10T09:30:00.000Z') }),
    );

    expect(metadataOnly.inputsHash).toBe(baseline.inputsHash);
  });

  it('keeps the inputs hash stable when only shelf metadata timestamps change', async () => {
    const baseline = await buildContextWithProducts([
      product('cleanser-1', ProductCategory.Cleanser, {
        updated_at: new Date('2026-05-10T08:00:00.000Z'),
      }),
    ]);
    const metadataOnly = await buildContextWithProducts([
      product('cleanser-1', ProductCategory.Cleanser, {
        updated_at: new Date('2026-05-10T09:30:00.000Z'),
      }),
    ]);

    expect(metadataOnly.inputsHash).toBe(baseline.inputsHash);
  });

  it('keeps the inputs hash stable when the same shelf rows arrive in a different order', async () => {
    const cleanser = product('cleanser-1', ProductCategory.Cleanser);
    const serum = product('serum-1', ProductCategory.Serum);
    const baseline = await buildContextWithProducts([cleanser, serum]);
    const reordered = await buildContextWithProducts([serum, cleanser]);

    expect(reordered.inputsHash).toBe(baseline.inputsHash);
    expect(reordered.allProducts.map((item) => item.id)).toEqual([
      'cleanser-1',
      'serum-1',
    ]);
  });

  it('keeps the inputs hash stable when performance summaries arrive in a different order', async () => {
    const creamPerformance = productPerformanceSummary('cream-1');
    const serumPerformance = productPerformanceSummary('serum-1');
    const baseline = await buildContextWithPerformance([
      creamPerformance,
      serumPerformance,
    ]);
    const reordered = await buildContextWithPerformance([
      serumPerformance,
      creamPerformance,
    ]);

    expect(reordered.inputsHash).toBe(baseline.inputsHash);
    expect(reordered.productPerformance.map((item) => item.productId)).toEqual([
      'cream-1',
      'serum-1',
    ]);
  });

  it('keeps the inputs hash stable when only environment timestamps and exact readings change', async () => {
    const baseline = await buildContextWithEnvironment(
      environmentSummary({
        generatedAt: '2026-05-10T08:00:00.000Z',
        humidity: 41,
        uvIndex: 6,
      }),
    );
    const refreshed = await buildContextWithEnvironment(
      environmentSummary({
        generatedAt: '2026-05-10T09:00:00.000Z',
        humidity: 43,
        uvIndex: 6.4,
        stale: true,
      }),
    );

    expect(refreshed.inputsHash).toBe(baseline.inputsHash);
  });

  it('keeps the inputs hash stable when equivalent environment signals arrive in a different order', async () => {
    const baseline = await buildContextWithEnvironment(
      environmentSummary({
        climateSensitivities: ['dry_air', 'pollution'],
        transitionSignals: [
          EnvironmentSignalKind.HighUv,
          EnvironmentSignalKind.LowHumidity,
        ],
      }),
    );
    const reordered = await buildContextWithEnvironment(
      environmentSummary({
        climateSensitivities: ['pollution', 'dry_air'],
        transitionSignals: [
          EnvironmentSignalKind.LowHumidity,
          EnvironmentSignalKind.HighUv,
        ],
      }),
    );

    expect(reordered.inputsHash).toBe(baseline.inputsHash);
  });

  it('changes the inputs hash when recommendation-relevant environment bands change', async () => {
    const balanced = await buildContextWithEnvironment(
      environmentSummary({
        humidityBand: EnvironmentHumidityBand.Balanced,
      }),
    );
    const dry = await buildContextWithEnvironment(
      environmentSummary({
        humidityBand: EnvironmentHumidityBand.Dry,
      }),
    );

    expect(dry.inputsHash).not.toBe(balanced.inputsHash);
  });
});

async function buildContextWithProfile(profileFixture: SkinProfile) {
  const skinProfileRepo = repo<SkinProfile>();
  const inventoryRepo = repo<InventoryProduct>();
  const environmentContext = {
    buildContext: jest.fn().mockResolvedValue({ summary: null }),
  } as unknown as EnvironmentContextService;
  const productPerformance = {
    summarizeForUser: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<SmartPicksProductPerformanceService>;
  skinProfileRepo.findOne.mockResolvedValue(profileFixture);
  inventoryRepo.find.mockResolvedValue([
    product('cleanser-1', ProductCategory.Cleanser),
  ]);
  const builder = new SmartPicksContextBuilder(
    skinProfileRepo,
    inventoryRepo,
    environmentContext,
    productPerformance,
  );
  return builder.build(user(), null);
}

async function buildContextWithEnvironment(summary: EnvironmentContextSummary) {
  const skinProfileRepo = repo<SkinProfile>();
  const inventoryRepo = repo<InventoryProduct>();
  const environmentContext = {
    buildContext: jest.fn().mockResolvedValue({ summary }),
  } as unknown as EnvironmentContextService;
  const productPerformance = {
    summarizeForUser: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<SmartPicksProductPerformanceService>;
  skinProfileRepo.findOne.mockResolvedValue(profile());
  inventoryRepo.find.mockResolvedValue([
    product('cleanser-1', ProductCategory.Cleanser),
  ]);
  const builder = new SmartPicksContextBuilder(
    skinProfileRepo,
    inventoryRepo,
    environmentContext,
    productPerformance,
  );
  return builder.build(user(), null);
}

async function buildContextWithProducts(products: InventoryProduct[]) {
  const skinProfileRepo = repo<SkinProfile>();
  const inventoryRepo = repo<InventoryProduct>();
  const environmentContext = {
    buildContext: jest.fn().mockResolvedValue({ summary: null }),
  } as unknown as EnvironmentContextService;
  const productPerformance = {
    summarizeForUser: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<SmartPicksProductPerformanceService>;
  skinProfileRepo.findOne.mockResolvedValue(profile());
  inventoryRepo.find.mockResolvedValue(products);
  const builder = new SmartPicksContextBuilder(
    skinProfileRepo,
    inventoryRepo,
    environmentContext,
    productPerformance,
  );
  return builder.build(user(), null);
}

async function buildContextWithPerformance(
  summaries: SmartPicksProductPerformanceSummary[],
) {
  const skinProfileRepo = repo<SkinProfile>();
  const inventoryRepo = repo<InventoryProduct>();
  const environmentContext = {
    buildContext: jest.fn().mockResolvedValue({ summary: null }),
  } as unknown as EnvironmentContextService;
  const productPerformance = {
    summarizeForUser: jest.fn().mockResolvedValue(summaries),
  } as unknown as jest.Mocked<SmartPicksProductPerformanceService>;
  skinProfileRepo.findOne.mockResolvedValue(profile());
  inventoryRepo.find.mockResolvedValue([
    product('serum-1', ProductCategory.Serum),
    product('cream-1', ProductCategory.Moisturizer),
  ]);
  const builder = new SmartPicksContextBuilder(
    skinProfileRepo,
    inventoryRepo,
    environmentContext,
    productPerformance,
  );
  return builder.build(user(), null);
}

function repo<T extends ObjectLiteral>() {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function user(): User {
  return { id: 'user-1', time_zone: 'Europe/Stockholm' } as User;
}

function profile(overrides: Partial<SkinProfile> = {}): SkinProfile {
  return {
    user_id: 'user-1',
    user: {
      date_of_birth: '1992-04-15',
      sex_at_birth: 'female',
    },
    skin_type: 'combination',
    skin_tone: 'deep',
    fitzpatrick_phototype: 'V',
    ethnicity: 'black',
    current_concerns: ['dark_marks'],
    primary_goal: 'dark_marks',
    concern_details: {
      per_concern: [{ concern: 'dark_marks', severity: 'mild' }],
    },
    skin_behavior: {
      pih_tendency: 'often',
      melasma_tendency: 'never',
      keloid_tendency: 'never',
      sunscreen_habit: 'most_days',
      sunscreen_tolerance: 'fine',
    },
    routine_preferences: {
      pace: 'cautious',
      fragrance_free: true,
      non_comedogenic: true,
      sunscreen_filter: 'mineral',
      sunscreen_finish: 'natural',
    },
    lifestyle_context: {
      water_hardness: 'soft',
      water_sensitivity: 'none',
    },
    budget_tier: 'mid',
    allow_smart_picks: true,
    country_code: 'SE',
    city: 'Stockholm',
    updated_at: new Date('2026-05-10T08:00:00.000Z'),
    ...overrides,
  } as unknown as SkinProfile;
}

function product(
  id: string,
  category: ProductCategory,
  overrides: Partial<InventoryProduct> = {},
): InventoryProduct {
  return {
    id,
    user_id: 'user-1',
    brand: 'Test Brand',
    name: id,
    category,
    status: ShelfStatus.Active,
    identity: { inciIngredients: ['Water'], benefits: [] },
    created_at: new Date('2026-05-10T08:00:00.000Z'),
    updated_at: new Date('2026-05-10T08:00:00.000Z'),
    ...overrides,
  } as unknown as InventoryProduct;
}

function productPerformanceSummary(
  productId: string,
): SmartPicksProductPerformanceSummary {
  return {
    productId,
    brand: 'Test Brand',
    productName: productId,
    category:
      productId === 'cream-1'
        ? ProductCategory.Moisturizer
        : ProductCategory.Serum,
    usageDaysLast30: 12,
    usageDaysLast90: 30,
    firstUsedAt: '2026-03-01',
    lastUsedAt: '2026-05-10',
    adherence: SmartPicksProductAdherence.Consistent,
    goalTrend: SmartPicksProductPerformanceSignal.NotImproving,
    concernTrend: 'dark_marks',
    photoCheckpoints: 2,
    reactionSignalCount: 0,
    replacementCandidate: false,
    replacementReason: null,
  };
}

function environmentSummary(
  overrides: Partial<EnvironmentContextSummary> = {},
): EnvironmentContextSummary {
  return {
    status: EnvironmentStatus.Available,
    provider: EnvironmentProviderName.OpenMeteo,
    generatedAt: '2026-05-10T08:00:00.000Z',
    locationPersonalized: true,
    season: EnvironmentSeason.Spring,
    temperatureCelsius: 17,
    temperatureBand: EnvironmentTemperatureBand.Mild,
    humidity: 41,
    humidityBand: EnvironmentHumidityBand.Balanced,
    uvIndex: 6,
    uvRisk: EnvironmentUvRisk.High,
    airQualityIndex: 24,
    airQualityRisk: EnvironmentAirQualityRisk.Good,
    pm25: 4,
    pm10: 8,
    pollenRisk: 'moderate',
    conditionLabel: 'Clear',
    waterHardness: EnvironmentWaterHardness.Soft,
    waterSensitivity: EnvironmentWaterSensitivity.None,
    climateSensitivities: [],
    transitionSignals: [],
    confidence: EnvironmentConfidence.Provider,
    stale: false,
    sourceIds: [],
    ...overrides,
  };
}

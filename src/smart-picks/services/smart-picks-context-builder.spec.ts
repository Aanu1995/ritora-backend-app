import { ObjectLiteral, Repository } from 'typeorm';
import { EnvironmentContextService } from '../../environment-intelligence/environment-context.service';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ProductCategory, ShelfStatus } from '../../shelf/shelf.types';
import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import { User } from '../../users/entities/user.entity';
import {
  SmartPicksProductAdherence,
  SmartPicksProductPerformanceSignal,
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

function product(id: string, category: ProductCategory): InventoryProduct {
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
  } as unknown as InventoryProduct;
}

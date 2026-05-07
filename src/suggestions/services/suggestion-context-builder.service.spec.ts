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
import { MatchingService } from '../../ingredients/matching.service';
import { SuggestionContextCache } from '../entities/suggestion-context-cache.entity';
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
      ]),
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
          evidenceSourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
          suitabilityReasons: expect.arrayContaining([
            'daytime sun protection fit',
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
    const matchingService = {
      matchProduct: jest.fn((product) => ({
        product,
        matchedIngredients: [],
        unresolvedTokens: [...product.inciIngredients],
        totalTokens: product.inciIngredients.length,
        resolvedTokens: 0,
      })),
    } as unknown as MatchingService;
    const builderWithIngredientIntelligence = new SuggestionContextBuilder(
      cacheRepo,
      matchingService,
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
    updated_at: new Date('2026-04-28T10:00:00.000Z'),
  } as SkinProfile;
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
    analysis_observations: {
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
        substituted_with_product_id: 'spf-1',
      },
    ],
  } as unknown as ApplicationLog;
}

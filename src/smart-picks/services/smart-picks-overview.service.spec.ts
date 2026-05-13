import { Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ProductCategory, ShelfStatus } from '../../shelf/shelf.types';
import { SkinProfile } from '../../skin-profile/entities/skin-profile.entity';
import { SuggestionGapAction } from '../../suggestions/entities/suggestion-gap-action.entity';
import { SuggestionObservabilityService } from '../../suggestions/services/suggestion-observability.service';
import { SuggestionEvidenceSourceId } from '../../suggestions/suggestions.constants';
import { User } from '../../users/entities/user.entity';
import { SmartPickProductSuggestion } from '../entities/smart-pick-product-suggestion.entity';
import { SmartPickSnapshot } from '../entities/smart-pick-snapshot.entity';
import {
  SmartPicksCoverage,
  SmartPicksEmptyReason,
  SmartPicksGapKind,
  SmartPicksStarterKitStepStatus,
  SmartPicksProductAdherence,
  SmartPicksProductPerformanceSignal,
} from '../smart-picks.types';
import { GeneratedSmartPick } from './smart-picks-ai-generator';
import { SmartPicksContext } from './smart-picks-context-builder';
import {
  buildGapSnapshots,
  SmartPicksOverviewService,
  toProductPick,
} from './smart-picks-overview.service';

describe('SmartPicksOverviewService', () => {
  it('returns seller names without legacy shopping fields', () => {
    const pick = toProductPick(
      productSuggestion({
        seller_names_json: ['Derm Store', 'Derm Store', '  Stylevana  '],
      }),
    );

    expect(pick.sellerNames).toEqual(['Derm Store', 'Stylevana']);
    expect(pick).not.toHaveProperty('priceCents');
    expect(pick).not.toHaveProperty('currency');
    expect(pick).not.toHaveProperty('retailers');
    expect(pick).not.toHaveProperty('verificationStatus');
  });

  it('records Smart Picks generation metrics without product or seller identifiers', async () => {
    const repos = {
      snapshots: repo<SmartPickSnapshot>(),
      suggestions: repo<SmartPickProductSuggestion>(),
      actions: repo<SuggestionGapAction>(),
      profiles: repo<SkinProfile>(),
    };
    const contextBuilder = {
      build: jest.fn().mockResolvedValue(context()),
    };
    const coverageService = {
      compute: jest.fn().mockReturnValue(coverage()),
    };
    const aiGenerator = {
      assessStarterTreatment: jest.fn().mockResolvedValue(null),
      generateWithDiagnostics: jest
        .fn()
        .mockResolvedValue(
          aiGenerationResult(
            new Map<string, GeneratedSmartPick>([
              ['broad-spectrum-sunscreen-spf-30', generatedPick()],
            ]),
            { requestedGapCount: 4, rawGapCount: 1 },
          ),
        ),
    };
    const observability = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SuggestionObservabilityService>;

    repos.snapshots.findOne.mockResolvedValue(null);
    repos.snapshots.create.mockImplementation(
      (value) => value as SmartPickSnapshot,
    );
    repos.snapshots.save.mockImplementation(
      async (value) =>
        ({
          id: 'snapshot-1',
          generated_at: new Date('2026-05-12T09:00:00.000Z'),
          user: undefined as never,
          generateId: jest.fn(),
          ...value,
        }) as SmartPickSnapshot,
    );
    repos.suggestions.findOne.mockResolvedValue(null);
    repos.suggestions.find.mockResolvedValue([]);
    repos.suggestions.create.mockImplementation(
      (value) => value as SmartPickProductSuggestion,
    );
    repos.suggestions.save.mockResolvedValue(productSuggestion());
    repos.actions.find.mockResolvedValue([]);

    const service = new SmartPicksOverviewService(
      contextBuilder as never,
      coverageService,
      { detect: jest.fn().mockReturnValue([]) },
      aiGenerator as never,
      { dispatch: jest.fn().mockResolvedValue(null) } as never,
      observability,
      repos.snapshots,
      repos.suggestions,
      repos.actions,
      repos.profiles,
    );

    await service.getOverview(user());
    await service.waitForBackgroundGeneration();

    expect(observability.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'smart_pick_generation_degraded',
        severity: 'warning',
        userId: 'user-1',
        metadata: expect.objectContaining({
          requestedGapCount: 5,
          generatedPickCount: 1,
          alternativePickCount: 1,
          mode: 'refine',
        }),
      }),
    );
    const metadata = observability.record.mock.calls[0]?.[0].metadata ?? {};
    expect(JSON.stringify(metadata)).not.toContain('Good Brand');
    expect(JSON.stringify(metadata)).not.toContain('https://example.com');
  });

  it('does not persist late AI picks after Smart Picks consent is revoked', async () => {
    const repos = {
      snapshots: repo<SmartPickSnapshot>(),
      suggestions: repo<SmartPickProductSuggestion>(),
      actions: repo<SuggestionGapAction>(),
      profiles: repo<SkinProfile>(),
    };
    repos.snapshots.findOne.mockResolvedValue(null);
    repos.snapshots.create.mockImplementation(
      (value) => value as SmartPickSnapshot,
    );
    repos.snapshots.save.mockImplementation(async (value) =>
      snapshot({
        ...(value as Partial<SmartPickSnapshot>),
        generated_at: new Date('2026-05-12T09:00:00.000Z'),
      }),
    );
    repos.suggestions.find.mockResolvedValue([]);
    repos.suggestions.findOne.mockResolvedValue(null);
    repos.suggestions.create.mockImplementation(
      (value) => value as SmartPickProductSuggestion,
    );
    repos.actions.find.mockResolvedValue([]);
    repos.profiles.findOne.mockResolvedValue({
      allow_smart_picks: false,
    } as SkinProfile);
    const aiGenerator = {
      assessStarterTreatment: jest.fn().mockResolvedValue(null),
      generateWithDiagnostics: jest
        .fn()
        .mockResolvedValue(
          aiGenerationResult(
            new Map<string, GeneratedSmartPick>([
              ['broad-spectrum-sunscreen-spf-30', generatedPick()],
            ]),
          ),
        ),
    };
    const service = serviceWith({
      contextBuilder: { build: jest.fn().mockResolvedValue(context()) },
      aiGenerator,
      repos,
    });

    await service.getOverview(user());
    await service.waitForBackgroundGeneration();

    expect(aiGenerator.generateWithDiagnostics).toHaveBeenCalled();
    expect(repos.suggestions.save).not.toHaveBeenCalled();
  });

  it('does not persist late AI picks when a newer snapshot hash exists', async () => {
    const repos = {
      snapshots: repo<SmartPickSnapshot>(),
      suggestions: repo<SmartPickProductSuggestion>(),
      actions: repo<SuggestionGapAction>(),
      profiles: repo<SkinProfile>(),
    };
    repos.snapshots.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(
      snapshot({
        inputs_hash: 'newer-hash',
        generated_at: new Date('2026-05-12T09:01:00.000Z'),
      }),
    );
    repos.snapshots.create.mockImplementation(
      (value) => value as SmartPickSnapshot,
    );
    repos.snapshots.save.mockImplementation(async (value) =>
      snapshot({
        ...(value as Partial<SmartPickSnapshot>),
        generated_at: new Date('2026-05-12T09:00:00.000Z'),
      }),
    );
    repos.suggestions.find.mockResolvedValue([]);
    repos.suggestions.findOne.mockResolvedValue(null);
    repos.suggestions.create.mockImplementation(
      (value) => value as SmartPickProductSuggestion,
    );
    repos.actions.find.mockResolvedValue([]);
    repos.profiles.findOne.mockResolvedValue({
      allow_smart_picks: true,
    } as SkinProfile);
    const aiGenerator = {
      assessStarterTreatment: jest.fn().mockResolvedValue(null),
      generateWithDiagnostics: jest
        .fn()
        .mockResolvedValue(
          aiGenerationResult(
            new Map<string, GeneratedSmartPick>([
              ['broad-spectrum-sunscreen-spf-30', generatedPick()],
            ]),
          ),
        ),
    };
    const service = serviceWith({
      contextBuilder: { build: jest.fn().mockResolvedValue(context()) },
      aiGenerator,
      repos,
    });

    await service.getOverview(user());
    await service.waitForBackgroundGeneration();

    expect(aiGenerator.generateWithDiagnostics).toHaveBeenCalled();
    expect(repos.suggestions.save).not.toHaveBeenCalled();
  });

  it('returns a profile-required empty state without calling product generation', async () => {
    const repos = {
      snapshots: repo<SmartPickSnapshot>(),
      suggestions: repo<SmartPickProductSuggestion>(),
      actions: repo<SuggestionGapAction>(),
      profiles: repo<SkinProfile>(),
    };
    const aiGenerator = {
      assessStarterTreatment: jest.fn().mockResolvedValue(null),
      generateWithDiagnostics: jest
        .fn()
        .mockResolvedValue(
          aiGenerationResult(new Map<string, GeneratedSmartPick>()),
        ),
    };
    const service = serviceWith({
      contextBuilder: {
        build: jest.fn().mockResolvedValue(
          context({
            skinProfile: null,
            skinProfileRequired: true,
            missingProfileFields: ['skin_type'],
          }),
        ),
      },
      aiGenerator,
      repos,
    });

    const overview = await service.getOverview(user());

    expect(overview.skinProfileRequired).toBe(true);
    expect(overview.emptyState.reason).toBe(
      SmartPicksEmptyReason.ProfileRequired,
    );
    expect(aiGenerator.generateWithDiagnostics).not.toHaveBeenCalled();
  });

  it('throws when updating budget before a skin profile exists', async () => {
    const repos = {
      snapshots: repo<SmartPickSnapshot>(),
      suggestions: repo<SmartPickProductSuggestion>(),
      actions: repo<SuggestionGapAction>(),
      profiles: repo<SkinProfile>(),
    };
    repos.profiles.findOne.mockResolvedValue(null);
    const service = serviceWith({
      contextBuilder: { build: jest.fn().mockResolvedValue(context()) },
      repos,
    });

    await expect(
      service.updateBudget(user(), 'premium'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repos.snapshots.delete).not.toHaveBeenCalled();
  });

  it('uses a matching input snapshot without time-based expiry', async () => {
    const repos = {
      snapshots: repo<SmartPickSnapshot>(),
      suggestions: repo<SmartPickProductSuggestion>(),
      actions: repo<SuggestionGapAction>(),
      profiles: repo<SkinProfile>(),
    };
    const activeContext = context();
    repos.snapshots.findOne.mockResolvedValue(
      snapshot({
        inputs_hash: activeContext.inputsHash,
        gaps_json: [],
        coverage_json: filledCoverage(),
      }),
    );
    repos.suggestions.find.mockResolvedValue([]);
    repos.actions.find.mockResolvedValue([]);
    const aiGenerator = {
      assessStarterTreatment: jest.fn().mockResolvedValue(null),
      generateWithDiagnostics: jest
        .fn()
        .mockResolvedValue(
          aiGenerationResult(new Map<string, GeneratedSmartPick>()),
        ),
    };
    const service = serviceWith({
      contextBuilder: { build: jest.fn().mockResolvedValue(activeContext) },
      aiGenerator,
      repos,
    });

    const overview = await service.getOverview(user());

    expect(overview.coverage.filled).toBe(5);
    expect(aiGenerator.generateWithDiagnostics).not.toHaveBeenCalled();
    expect(repos.snapshots.save).not.toHaveBeenCalled();
  });

  it('does not mark a new product version as saved because an older pick for the same gap was saved', async () => {
    const repos = {
      snapshots: repo<SmartPickSnapshot>(),
      suggestions: repo<SmartPickProductSuggestion>(),
      actions: repo<SuggestionGapAction>(),
      profiles: repo<SkinProfile>(),
    };
    const activeContext = context({ inputsHash: 'hash-2' });
    const currentGap = gapSnapshot({
      normalizedKey: 'broad-spectrum-sunscreen-spf-30',
    });
    repos.snapshots.findOne.mockResolvedValue(
      snapshot({
        inputs_hash: activeContext.inputsHash,
        gaps_json: [currentGap],
        coverage_json: filledCoverage(),
      }),
    );
    repos.suggestions.find.mockResolvedValue([
      productSuggestion({
        id: 'new-pick',
        inputs_hash: activeContext.inputsHash,
        product_name: 'New SPF',
      }),
    ]);
    repos.actions.find.mockResolvedValue([
      gapAction({
        id: 'saved-old-pick',
        smart_pick_product_suggestion_id: 'old-pick',
        normalized_key: currentGap.normalizedKey,
        action: 'saved',
      }),
    ]);
    const service = serviceWith({
      contextBuilder: { build: jest.fn().mockResolvedValue(activeContext) },
      repos,
    });

    const overview = await service.getOverview(user());

    expect(overview.priorityGaps[0]?.pick?.id).toBe('new-pick');
    expect(overview.priorityGaps[0]?.pick?.userAction).toBeNull();
  });

  it('keeps the saved state only when the current product version was saved', async () => {
    const repos = {
      snapshots: repo<SmartPickSnapshot>(),
      suggestions: repo<SmartPickProductSuggestion>(),
      actions: repo<SuggestionGapAction>(),
      profiles: repo<SkinProfile>(),
    };
    const activeContext = context({ inputsHash: 'hash-2' });
    const currentGap = gapSnapshot({
      normalizedKey: 'broad-spectrum-sunscreen-spf-30',
    });
    repos.snapshots.findOne.mockResolvedValue(
      snapshot({
        inputs_hash: activeContext.inputsHash,
        gaps_json: [currentGap],
        coverage_json: filledCoverage(),
      }),
    );
    repos.suggestions.find.mockResolvedValue([
      productSuggestion({
        id: 'new-pick',
        inputs_hash: activeContext.inputsHash,
        product_name: 'New SPF',
      }),
    ]);
    repos.actions.find.mockResolvedValue([
      gapAction({
        id: 'saved-current-pick',
        smart_pick_product_suggestion_id: 'new-pick',
        normalized_key: currentGap.normalizedKey,
        action: 'saved',
      }),
    ]);
    const service = serviceWith({
      contextBuilder: { build: jest.fn().mockResolvedValue(activeContext) },
      repos,
    });

    const overview = await service.getOverview(user());

    expect(overview.priorityGaps[0]?.pick?.id).toBe('new-pick');
    expect(overview.priorityGaps[0]?.pick?.userAction).toBe('saved');
  });

  it('creates a new product suggestion version when the same gap is regenerated for a new input hash', async () => {
    const repos = {
      snapshots: repo<SmartPickSnapshot>(),
      suggestions: repo<SmartPickProductSuggestion>(),
      actions: repo<SuggestionGapAction>(),
      profiles: repo<SkinProfile>(),
    };
    const activeContext = context({ inputsHash: 'hash-2' });
    const currentGap = gapSnapshot({
      normalizedKey: 'broad-spectrum-sunscreen-spf-30',
    });
    repos.snapshots.findOne.mockResolvedValue(
      snapshot({
        inputs_hash: activeContext.inputsHash,
        gaps_json: [currentGap],
        coverage_json: filledCoverage(),
      }),
    );
    repos.suggestions.find.mockResolvedValue([]);
    repos.suggestions.findOne.mockImplementation(async ({ where }) => {
      const criteria = where as Partial<SmartPickProductSuggestion>;
      return criteria.inputs_hash === activeContext.inputsHash
        ? null
        : productSuggestion({ id: 'saved-old-pick', inputs_hash: 'hash-1' });
    });
    repos.suggestions.create.mockImplementation(
      (value) => value as SmartPickProductSuggestion,
    );
    repos.suggestions.save.mockImplementation(
      async (value) => value as SmartPickProductSuggestion,
    );
    repos.actions.find.mockImplementation(async (options) => {
      const criteria = options?.where as Partial<SuggestionGapAction>;
      if (criteria.action === 'dismissed') return [];
      return [
        gapAction({
          smart_pick_product_suggestion_id: 'saved-old-pick',
          normalized_key: currentGap.normalizedKey,
          action: 'saved',
        }),
      ];
    });
    const aiGenerator = {
      assessStarterTreatment: jest.fn().mockResolvedValue(null),
      generateWithDiagnostics: jest.fn().mockResolvedValue(
        aiGenerationResult(
          new Map<string, GeneratedSmartPick>([
            [
              currentGap.normalizedKey,
              generatedPick({
                brand: 'New Brand',
                productName: 'New SPF',
              }),
            ],
          ]),
        ),
      ),
    };
    const service = serviceWith({
      contextBuilder: { build: jest.fn().mockResolvedValue(activeContext) },
      aiGenerator,
      repos,
    });

    await service.getOverview(user());
    await service.waitForBackgroundGeneration();

    expect(repos.suggestions.findOne).toHaveBeenCalledWith({
      where: {
        user_id: 'user-1',
        normalized_key: currentGap.normalizedKey,
        inputs_hash: activeContext.inputsHash,
      },
    });
    expect(repos.suggestions.save).toHaveBeenCalledWith(
      expect.not.objectContaining({ id: 'saved-old-pick' }),
    );
  });

  it('prunes stale unsaved product suggestion versions while keeping saved and recently dismissed picks', async () => {
    const repos = {
      snapshots: repo<SmartPickSnapshot>(),
      suggestions: repo<SmartPickProductSuggestion>(),
      actions: repo<SuggestionGapAction>(),
      profiles: repo<SkinProfile>(),
    };
    const activeContext = context({ inputsHash: 'hash-2' });
    repos.snapshots.findOne.mockResolvedValue(
      snapshot({ inputs_hash: 'hash-1' }),
    );
    repos.snapshots.create.mockImplementation(
      (value) => value as SmartPickSnapshot,
    );
    repos.snapshots.save.mockImplementation(async (value) =>
      snapshot({
        ...(value as Partial<SmartPickSnapshot>),
        inputs_hash: activeContext.inputsHash,
      }),
    );
    repos.suggestions.find
      .mockResolvedValueOnce([
        productSuggestion({ id: 'old-unsaved', inputs_hash: 'hash-1' }),
        productSuggestion({ id: 'old-saved', inputs_hash: 'hash-1' }),
        productSuggestion({
          id: 'old-recent-dismissed',
          inputs_hash: 'hash-1',
        }),
        productSuggestion({
          id: 'old-expired-dismissed',
          inputs_hash: 'hash-1',
        }),
      ])
      .mockResolvedValueOnce([]);
    repos.actions.find.mockImplementation(async (options) => {
      const criteria = options?.where as Partial<SuggestionGapAction>;
      if (criteria.action === 'dismissed') return [];
      return [
        gapAction({
          smart_pick_product_suggestion_id: 'old-saved',
          action: 'saved',
        }),
        gapAction({
          id: 'recent-dismissed-action',
          smart_pick_product_suggestion_id: 'old-recent-dismissed',
          action: 'dismissed',
          updated_at: new Date(),
        }),
        gapAction({
          id: 'expired-dismissed-action',
          smart_pick_product_suggestion_id: 'old-expired-dismissed',
          action: 'dismissed',
          updated_at: new Date('2020-05-12T09:00:00.000Z'),
        }),
      ];
    });
    const service = serviceWith({
      contextBuilder: { build: jest.fn().mockResolvedValue(activeContext) },
      repos,
    });

    await service.getOverview(user());

    expect(repos.suggestions.delete).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1' }),
    );
    const deleteCriteria = repos.suggestions.delete.mock.calls[0]?.[0];
    const serializedCriteria = JSON.stringify(deleteCriteria);
    expect(serializedCriteria).toContain('old-unsaved');
    expect(serializedCriteria).toContain('old-expired-dismissed');
    expect(serializedCriteria).not.toContain('old-saved');
    expect(serializedCriteria).not.toContain('old-recent-dismissed');
  });

  it('returns a cold overview before background product generation resolves', async () => {
    const repos = {
      snapshots: repo<SmartPickSnapshot>(),
      suggestions: repo<SmartPickProductSuggestion>(),
      actions: repo<SuggestionGapAction>(),
      profiles: repo<SkinProfile>(),
    };
    const activeContext = context({
      mode: 'starter',
      activeProducts: [],
      allProducts: [],
      inputsHash: 'starter-background-hash',
    });
    const deferred = deferredValue(
      aiGenerationResult(
        new Map<string, GeneratedSmartPick>([
          ['broad-spectrum-sunscreen-spf-30', generatedPick()],
        ]),
        { requestedGapCount: 4 },
      ),
    );
    const aiGenerator = {
      assessStarterTreatment: jest.fn().mockResolvedValue(null),
      generateWithDiagnostics: jest.fn().mockReturnValue(deferred.promise),
    };
    repos.snapshots.findOne.mockResolvedValue(null);
    repos.snapshots.create.mockImplementation(
      (value) => value as SmartPickSnapshot,
    );
    repos.snapshots.save.mockImplementation(async (value) =>
      snapshot({
        ...(value as Partial<SmartPickSnapshot>),
        generated_at: new Date('2026-05-12T09:00:00.000Z'),
      }),
    );
    repos.suggestions.findOne.mockResolvedValue(null);
    repos.suggestions.find.mockResolvedValue([]);
    repos.suggestions.create.mockImplementation(
      (value) => value as SmartPickProductSuggestion,
    );
    repos.suggestions.save.mockImplementation(
      async (value) => value as SmartPickProductSuggestion,
    );
    repos.actions.find.mockResolvedValue([]);
    const service = serviceWith({
      contextBuilder: { build: jest.fn().mockResolvedValue(activeContext) },
      aiGenerator,
      repos,
    });

    const overview = await service.getOverview(user(), 'starter');

    expect(overview.productSuggestionsUnavailable).toBe(true);
    expect(overview.starterKit.steps).toContainEqual(
      expect.objectContaining({
        role: 'spf',
        status: SmartPicksStarterKitStepStatus.Recommended,
        pick: null,
      }),
    );
    expect(aiGenerator.generateWithDiagnostics).toHaveBeenCalled();
    expect(repos.suggestions.save).not.toHaveBeenCalled();

    deferred.resolve();
    await service.waitForBackgroundGeneration();

    expect(repos.suggestions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        seller_names_json: ['Derm Store'],
        inputs_hash: activeContext.inputsHash,
      }),
    );
  });

  it('retries missing worth-considering gaps so they get concrete product picks too', async () => {
    const repos = {
      snapshots: repo<SmartPickSnapshot>(),
      suggestions: repo<SmartPickProductSuggestion>(),
      actions: repo<SuggestionGapAction>(),
      profiles: repo<SkinProfile>(),
    };
    const priorityGap = gapSnapshot({
      ingredientOrCategory: 'Broad-spectrum sunscreen SPF 30+',
      normalizedKey: 'broad-spectrum-sunscreen-spf-30',
      priority: 'priority',
    });
    const considerGap = gapSnapshot({
      ingredientOrCategory: 'Vitamin C antioxidant serum',
      normalizedKey: 'vitamin-c-antioxidant-serum',
      priority: 'consider',
      reason:
        'Vitamin C can support uneven-tone goals when sunscreen and a pigment serum are already planned. Extra detail stays out of saved product records.',
      shortReason:
        'Vitamin C can support uneven-tone goals when sunscreen and a pigment serum are already planned.',
      goalAlignment: 'dark spot support',
    });
    const aiGenerator = {
      assessStarterTreatment: jest.fn().mockResolvedValue(null),
      generateWithDiagnostics: jest
        .fn()
        .mockResolvedValueOnce(
          aiGenerationResult(
            new Map<string, GeneratedSmartPick>([
              ['broad-spectrum-sunscreen-spf-30', generatedPick()],
            ]),
            { requestedGapCount: 2, missingPickCount: 1 },
          ),
        )
        .mockResolvedValueOnce(
          aiGenerationResult(
            new Map<string, GeneratedSmartPick>([
              [
                'vitamin-c-antioxidant-serum',
                generatedPick({
                  brand: 'Consider Brand',
                  productName: 'Vitamin C Serum',
                }),
              ],
            ]),
            { requestedGapCount: 1 },
          ),
        ),
    };
    repos.snapshots.findOne.mockResolvedValue(
      snapshot({
        gaps_json: [priorityGap, considerGap],
        coverage_json: filledCoverage(),
      }),
    );
    repos.suggestions.find.mockResolvedValue([]);
    repos.suggestions.findOne.mockResolvedValue(null);
    repos.suggestions.create.mockImplementation(
      (value) => value as SmartPickProductSuggestion,
    );
    repos.suggestions.save.mockImplementation(
      async (value) => value as SmartPickProductSuggestion,
    );
    repos.actions.find.mockResolvedValue([]);
    const service = serviceWith({
      contextBuilder: { build: jest.fn().mockResolvedValue(context()) },
      aiGenerator,
      repos,
    });

    const overview = await service.getOverview(user());
    await service.waitForBackgroundGeneration();

    expect(overview.considerGaps).toContainEqual(
      expect.objectContaining({
        normalizedKey: 'vitamin-c-antioxidant-serum',
        pick: null,
      }),
    );
    expect(aiGenerator.generateWithDiagnostics).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      [priorityGap, considerGap],
    );
    expect(aiGenerator.generateWithDiagnostics).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      [considerGap],
    );
    expect(repos.suggestions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        normalized_key: 'vitamin-c-antioxidant-serum',
        brand: 'Consider Brand',
        product_name: 'Vitamin C Serum',
        gap_reason:
          'Vitamin C can support uneven-tone goals when sunscreen and a pigment serum are already planned.',
      }),
    );
  });

  it('batches 20 product-pick gaps and preserves partial success when one batch fails', async () => {
    const repos = {
      snapshots: repo<SmartPickSnapshot>(),
      suggestions: repo<SmartPickProductSuggestion>(),
      actions: repo<SuggestionGapAction>(),
      profiles: repo<SkinProfile>(),
    };
    const gaps = Array.from({ length: 20 }, (_, index) =>
      gapSnapshot({
        ingredientOrCategory: `Smart lane ${index + 1}`,
        normalizedKey: `smart-lane-${index + 1}`,
        priority: index < 3 ? 'priority' : 'consider',
      }),
    );
    const aiGenerator = {
      assessStarterTreatment: jest.fn().mockResolvedValue(null),
      generateWithDiagnostics: jest
        .fn()
        .mockResolvedValueOnce(
          aiGenerationResult(new Map<string, GeneratedSmartPick>(), {
            requestedGapCount: 2,
            providerFailed: true,
          }),
        )
        .mockImplementation((_, batch: typeof gaps) =>
          Promise.resolve(
            aiGenerationResult(
              new Map<string, GeneratedSmartPick>(
                batch.map((gap) => [
                  gap.normalizedKey,
                  generatedPick({
                    productName: `Pick ${gap.normalizedKey}`,
                  }),
                ]),
              ),
              { requestedGapCount: batch.length },
            ),
          ),
        ),
    };
    repos.snapshots.findOne.mockResolvedValue(
      snapshot({
        gaps_json: gaps,
        coverage_json: filledCoverage(),
      }),
    );
    repos.suggestions.find.mockResolvedValue([]);
    repos.suggestions.findOne.mockResolvedValue(null);
    repos.suggestions.create.mockImplementation(
      (value) => value as SmartPickProductSuggestion,
    );
    repos.suggestions.save.mockImplementation(
      async (value) => value as SmartPickProductSuggestion,
    );
    repos.actions.find.mockResolvedValue([]);
    const service = serviceWith({
      contextBuilder: { build: jest.fn().mockResolvedValue(context()) },
      aiGenerator,
      repos,
    });

    await service.getOverview(user());
    await service.waitForBackgroundGeneration();

    expect(aiGenerator.generateWithDiagnostics).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      [gaps[0], gaps[1]],
    );
    expect(aiGenerator.generateWithDiagnostics).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      [gaps[2], gaps[3]],
    );
    for (let callIndex = 3; callIndex <= 10; callIndex += 1) {
      const gapStartIndex = (callIndex - 1) * 2;
      expect(aiGenerator.generateWithDiagnostics).toHaveBeenNthCalledWith(
        callIndex,
        expect.any(Object),
        [gaps[gapStartIndex], gaps[gapStartIndex + 1]],
      );
    }
    expect(aiGenerator.generateWithDiagnostics).toHaveBeenCalledTimes(10);
    expect(repos.suggestions.save).toHaveBeenCalledTimes(18);
    expect(repos.suggestions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        normalized_key: 'smart-lane-20',
        product_name: 'Pick smart-lane-20',
      }),
    );
  });

  it('records privacy-safe production monitoring signals for AI gaps and quality drift', async () => {
    const repos = {
      snapshots: repo<SmartPickSnapshot>(),
      suggestions: repo<SmartPickProductSuggestion>(),
      actions: repo<SuggestionGapAction>(),
      profiles: repo<SkinProfile>(),
    };
    const observability = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SuggestionObservabilityService>;
    repos.snapshots.findOne.mockResolvedValue(null);
    repos.snapshots.create.mockImplementation(
      (value) => value as SmartPickSnapshot,
    );
    repos.snapshots.save.mockImplementation(async (value) =>
      snapshot({
        ...(value as Partial<SmartPickSnapshot>),
        generated_at: new Date('2026-05-12T09:00:00.000Z'),
      }),
    );
    repos.suggestions.findOne.mockResolvedValue(null);
    repos.suggestions.find.mockResolvedValue([]);
    repos.suggestions.create.mockImplementation(
      (value) => value as SmartPickProductSuggestion,
    );
    repos.suggestions.save.mockResolvedValue(productSuggestion());
    repos.actions.find.mockResolvedValue([]);
    const aiGenerator = {
      assessStarterTreatment: jest.fn().mockResolvedValue(null),
      generateWithDiagnostics: jest.fn().mockResolvedValue(
        aiGenerationResult(
          new Map<string, GeneratedSmartPick>([
            [
              'broad-spectrum-sunscreen-spf-30',
              generatedPick({ alternatives: [] }),
            ],
          ]),
          {
            requestedGapCount: 5,
            rawGapCount: 3,
            blockedSafetyCount: 1,
            missingPickCount: 3,
          },
        ),
      ),
    };
    const service = new SmartPicksOverviewService(
      { build: jest.fn().mockResolvedValue(context()) } as never,
      { compute: jest.fn().mockReturnValue(coverage()) },
      { detect: jest.fn().mockReturnValue([]) },
      aiGenerator as never,
      { dispatch: jest.fn().mockResolvedValue(null) } as never,
      observability,
      repos.snapshots,
      repos.suggestions,
      repos.actions,
      repos.profiles,
    );

    await service.getOverview(user());
    await service.waitForBackgroundGeneration();

    expect(observability.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'smart_pick_unsafe_output_blocked',
        metadata: expect.objectContaining({ blockedSafetyCount: 6 }),
      }),
    );
    expect(observability.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'smart_pick_no_pick',
        metadata: expect.objectContaining({ missingPickCount: 4 }),
      }),
    );
    const allMetadata = JSON.stringify(
      observability.record.mock.calls.map((call) => call[0].metadata),
    );
    expect(allMetadata).not.toContain('Good Brand');
    expect(allMetadata).not.toContain('https://example.com');
  });

  it('records an AI failure signal when provider diagnostics report failure', async () => {
    const repos = {
      snapshots: repo<SmartPickSnapshot>(),
      suggestions: repo<SmartPickProductSuggestion>(),
      actions: repo<SuggestionGapAction>(),
      profiles: repo<SkinProfile>(),
    };
    const observability = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SuggestionObservabilityService>;
    repos.snapshots.findOne.mockResolvedValue(null);
    repos.snapshots.create.mockImplementation(
      (value) => value as SmartPickSnapshot,
    );
    repos.snapshots.save.mockImplementation(async (value) =>
      snapshot({
        ...(value as Partial<SmartPickSnapshot>),
        generated_at: new Date('2026-05-12T09:00:00.000Z'),
      }),
    );
    repos.suggestions.find.mockResolvedValue([]);
    repos.actions.find.mockResolvedValue([]);
    const service = new SmartPicksOverviewService(
      { build: jest.fn().mockResolvedValue(context()) } as never,
      { compute: jest.fn().mockReturnValue(coverage()) },
      { detect: jest.fn().mockReturnValue([]) },
      {
        assessStarterTreatment: jest.fn().mockResolvedValue(null),
        generateWithDiagnostics: jest.fn().mockResolvedValue(
          aiGenerationResult(new Map<string, GeneratedSmartPick>(), {
            requestedGapCount: 5,
            providerFailed: true,
            missingPickCount: 4,
          }),
        ),
      } as never,
      { dispatch: jest.fn().mockResolvedValue(null) } as never,
      observability,
      repos.snapshots,
      repos.suggestions,
      repos.actions,
      repos.profiles,
    );

    await service.getOverview(user());
    await service.waitForBackgroundGeneration();

    expect(observability.record).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'smart_pick_ai_failed',
        severity: 'warning',
        metadata: expect.objectContaining({ providerFailed: true }),
      }),
    );
  });

  it('adds a clear replacement gap when product history shows consistent use without progress', () => {
    const gaps = buildGapSnapshots(replacementContext(), filledCoverage());

    expect(gaps[0]).toEqual(
      expect.objectContaining({
        gapKind: SmartPicksGapKind.Replacement,
        priority: 'priority',
        ingredientOrCategory: 'Replacement for Current Brightening Serum',
        replacementFor: expect.objectContaining({
          productId: 'owned-1',
          productName: 'Current Brightening Serum',
          usageDaysLast90: 42,
          photoCheckpoints: 3,
        }),
      }),
    );
    expect(gaps[0].reason).toContain('42 logged use days');
    expect(gaps[0].reason).toContain('photo history still shows');
  });

  it('adds worth-considering dark-spot supports when the user has a ready-to-spend budget', () => {
    const azelaicSerum = ownedProduct({
      id: 'azelaic-serum',
      name: 'Azelaic Tone Serum',
      category: ProductCategory.Serum,
      identity: {
        inciIngredients: ['azelaic acid'],
      } as InventoryProduct['identity'],
    });
    const gaps = buildGapSnapshots(
      context({
        budgetTier: 'premium',
        activeProducts: [azelaicSerum],
        allProducts: [azelaicSerum],
        skinProfile: profile({
          budget_tier: 'premium',
          primary_goal: 'remove dark spots',
          current_concerns: ['dark spots', 'post-acne marks'],
        }),
      }),
      filledCoverage(),
    );

    expect(gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          priority: 'consider',
          ingredientOrCategory: 'Vitamin C antioxidant serum',
          goalAlignment: 'dark spot support',
        }),
        expect.objectContaining({
          priority: 'consider',
          ingredientOrCategory: 'Gentle pigment-supporting mask or peel',
          goalAlignment: 'dark spot support',
        }),
        expect.objectContaining({
          priority: 'consider',
          ingredientOrCategory: 'Beginner retinoid night treatment',
          goalAlignment: 'dark spot support',
        }),
      ]),
    );
    expect(gaps.map((gap) => gap.ingredientOrCategory)).not.toContain(
      'PIH-focused serum with azelaic acid or tranexamic acid',
    );
    expect(gaps.map((gap) => gap.reason).join(' ')).not.toMatch(
      /Skin\s+Profile\s+uses|[a-z]+\s+budget|budget\s+allows/i,
    );
    const vitaminCGap = gaps.find(
      (gap) => gap.ingredientOrCategory === 'Vitamin C antioxidant serum',
    );
    expect(vitaminCGap?.shortReason).toBe(
      'Vitamin C can support uneven-tone goals when sunscreen and a pigment serum are already planned.',
    );
    expect(vitaminCGap?.shortReason).not.toContain('Skin Profile');
    expect(vitaminCGap?.shortReason.length).toBeLessThanOrEqual(120);
  });

  it('keeps ready-to-spend optional supports when replacement gaps already fill the top of the list', () => {
    const azelaicSerum = ownedProduct({
      id: 'azelaic-serum',
      name: 'Azelaic Tone Serum',
      category: ProductCategory.Serum,
      identity: {
        inciIngredients: ['azelaic acid'],
      } as InventoryProduct['identity'],
    });
    const replacementSignal = replacementContext().productPerformance[0];
    const gaps = buildGapSnapshots(
      context({
        budgetTier: 'premium',
        activeProducts: [azelaicSerum],
        allProducts: [azelaicSerum],
        productPerformance: [
          replacementSignal,
          {
            ...replacementSignal,
            productId: 'owned-2',
            productName: 'Current Vitamin C Serum',
          },
        ],
        skinProfile: profile({
          budget_tier: 'premium',
          primary_goal: 'remove dark spots',
          current_concerns: ['dark spots', 'post-acne marks'],
        }),
      }),
      coverageWithMissingSpf(),
    );

    expect(gaps.length).toBeGreaterThan(5);
    expect(
      gaps.filter((gap) => gap.priority === 'consider').length,
    ).toBeGreaterThanOrEqual(3);
    expect(gaps.map((gap) => gap.ingredientOrCategory)).toEqual(
      expect.arrayContaining([
        'Vitamin C antioxidant serum',
        'Gentle pigment-supporting mask or peel',
        'Beginner retinoid night treatment',
      ]),
    );
  });

  it('adds a goal-specific priority gap when a generic treatment fills the slot but not the dark-spot goal', () => {
    const hydratingSerum = ownedProduct({
      id: 'hydrating-serum',
      name: 'Hydrating Serum',
      category: ProductCategory.Serum,
      identity: {
        inciIngredients: ['hyaluronic acid', 'glycerin'],
      } as InventoryProduct['identity'],
    });
    const gaps = buildGapSnapshots(
      context({
        budgetTier: 'luxury',
        activeProducts: [hydratingSerum],
        allProducts: [hydratingSerum],
        skinProfile: profile({
          budget_tier: 'luxury',
          primary_goal: 'remove dark spots',
          current_concerns: ['hyperpigmentation'],
        }),
      }),
      filledCoverage(),
    );

    expect(gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          priority: 'priority',
          ingredientOrCategory:
            'PIH-focused serum with azelaic acid or tranexamic acid',
          goalAlignment: 'dark spot support',
        }),
      ]),
    );
  });

  it('keeps expanded optional products out of basic-budget dark-spot plans', () => {
    const azelaicSerum = ownedProduct({
      id: 'azelaic-serum',
      name: 'Azelaic Tone Serum',
      category: ProductCategory.Serum,
      identity: {
        inciIngredients: ['azelaic acid'],
      } as InventoryProduct['identity'],
    });
    const gaps = buildGapSnapshots(
      context({
        budgetTier: 'drugstore',
        activeProducts: [azelaicSerum],
        allProducts: [azelaicSerum],
        skinProfile: profile({
          budget_tier: 'drugstore',
          primary_goal: 'remove dark spots',
          current_concerns: ['dark spots'],
        }),
      }),
      filledCoverage(),
    );

    expect(gaps.map((gap) => gap.ingredientOrCategory)).toContain(
      'Vitamin C antioxidant serum',
    );
    expect(gaps.map((gap) => gap.ingredientOrCategory)).not.toContain(
      'Gentle pigment-supporting mask or peel',
    );
  });

  it('creates AI-directed gaps for custom goals that are not in the built-in policies', () => {
    const gaps = buildGapSnapshots(
      context({
        budgetTier: 'premium',
        skinProfile: profile({
          budget_tier: 'premium',
          primary_goal: 'look less tired after long workdays',
          current_concerns: ['tired-looking skin'],
        }),
      }),
      {
        filled: 0,
        total: 5,
        slots: [
          {
            role: 'goal-primary',
            state: 'missing-priority',
            filledByProductId: null,
            filledByName: null,
            goalRelevance: 'essential',
          },
          {
            role: 'goal-support',
            state: 'missing',
            filledByProductId: null,
            filledByName: null,
            goalRelevance: 'supportive',
          },
        ],
      },
    );

    expect(gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          priority: 'priority',
          ingredientOrCategory:
            'Goal-focused product for look less tired after long workdays',
          goalAlignment: 'look less tired after long workdays',
          gapKind: SmartPicksGapKind.GoalSupport,
        }),
        expect.objectContaining({
          priority: 'consider',
          ingredientOrCategory:
            'Supporting product for look less tired after long workdays',
          goalAlignment: 'look less tired after long workdays',
          gapKind: SmartPicksGapKind.GoalSupport,
        }),
      ]),
    );
    expect(gaps.map((gap) => gap.reason).join(' ')).not.toMatch(
      /Skin\s+Profile\s+uses|[a-z]+\s+budget|budget\s+allows/i,
    );
  });

  it('does not call the shelf complete when every current gap is paused by dismissal', async () => {
    const repos = {
      snapshots: repo<SmartPickSnapshot>(),
      suggestions: repo<SmartPickProductSuggestion>(),
      actions: repo<SuggestionGapAction>(),
      profiles: repo<SkinProfile>(),
    };
    const activeContext = context();
    const currentGap = buildGapSnapshots(activeContext, coverage())[0];
    if (!currentGap) throw new Error('Expected a Smart Picks gap fixture.');

    repos.snapshots.findOne.mockResolvedValue(
      snapshot({
        gaps_json: [currentGap],
        coverage_json: coverage(),
        covered_json: [],
        redundancy_json: [],
      }),
    );
    repos.suggestions.find.mockResolvedValue([productSuggestion()]);
    repos.actions.find.mockResolvedValue([
      gapAction({
        normalized_key: currentGap.normalizedKey,
        action: 'dismissed',
        updated_at: new Date('2099-05-01T09:00:00.000Z'),
      }),
    ]);

    const service = serviceWith({
      contextBuilder: { build: jest.fn().mockResolvedValue(activeContext) },
      repos,
    });

    const overview = await service.getOverview(user());

    expect(overview.priorityGaps).toHaveLength(0);
    expect(overview.emptyState).toEqual(
      expect.objectContaining({
        reason: SmartPicksEmptyReason.AllGapsDismissed,
        dismissedGapCount: 1,
        nextEligibleAt: '2099-05-31T09:00:00.000Z',
      }),
    );
  });

  it('keeps redundancy visible when there are no purchase gaps', async () => {
    const repos = {
      snapshots: repo<SmartPickSnapshot>(),
      suggestions: repo<SmartPickProductSuggestion>(),
      actions: repo<SuggestionGapAction>(),
      profiles: repo<SkinProfile>(),
    };
    const activeContext = {
      ...context(),
      activeProducts: [ownedProduct()],
      productPerformance: [],
    };
    repos.snapshots.findOne.mockResolvedValue(
      snapshot({
        gaps_json: [],
        coverage_json: filledCoverage(),
        covered_json: [],
        redundancy_json: [
          {
            activeTag: 'salicylic_acid',
            hint: 'You have more than one salicylic acid product.',
            products: [
              {
                id: 'owned-1',
                brand: 'Owned',
                name: 'Cleanser',
                recommendation: 'keep',
              },
            ],
          },
        ],
      }),
    );
    repos.suggestions.find.mockResolvedValue([]);
    repos.actions.find.mockResolvedValue([]);

    const service = serviceWith({
      contextBuilder: { build: jest.fn().mockResolvedValue(activeContext) },
      repos,
    });

    const overview = await service.getOverview(user());

    expect(overview.priorityGaps).toHaveLength(0);
    expect(overview.redundancy).toHaveLength(1);
    expect(overview.emptyState.reason).toBe(
      SmartPicksEmptyReason.RedundancyOnly,
    );
  });

  it('builds a full starter kit when the user has no active products', async () => {
    const repos = {
      snapshots: repo<SmartPickSnapshot>(),
      suggestions: repo<SmartPickProductSuggestion>(),
      actions: repo<SuggestionGapAction>(),
      profiles: repo<SkinProfile>(),
    };
    const activeContext = context({
      mode: 'starter',
      activeProducts: [],
      allProducts: [],
      inputsHash: 'starter-empty-hash',
    });
    const starterCoverage = coverage();
    const starterGaps = buildGapSnapshots(activeContext, starterCoverage);
    const generatedPicks = new Map<string, GeneratedSmartPick>(
      starterGaps.map((gap) => [
        gap.normalizedKey,
        generatedPick({
          productName: `${gap.ingredientOrCategory} pick`,
        }),
      ]),
    );
    repos.snapshots.findOne.mockResolvedValue(null);
    repos.snapshots.create.mockImplementation(
      (value) => value as SmartPickSnapshot,
    );
    repos.snapshots.save.mockImplementation(async (value) =>
      snapshot({
        ...(value as Partial<SmartPickSnapshot>),
        id: 'starter-snapshot',
        generated_at: new Date('2026-05-12T09:00:00.000Z'),
      }),
    );
    repos.suggestions.findOne.mockResolvedValue(null);
    repos.suggestions.find.mockImplementation(async () =>
      starterGaps.map((gap) =>
        productSuggestion({
          id: `pick-${gap.normalizedKey}`,
          ingredient_or_category: gap.ingredientOrCategory,
          normalized_key: gap.normalizedKey,
          product_name: `${gap.ingredientOrCategory} pick`,
        }),
      ),
    );
    repos.suggestions.create.mockImplementation(
      (value) => value as SmartPickProductSuggestion,
    );
    repos.suggestions.save.mockImplementation(
      async (value) => value as SmartPickProductSuggestion,
    );
    repos.actions.find.mockResolvedValue([]);

    const service = serviceWith({
      contextBuilder: { build: jest.fn().mockResolvedValue(activeContext) },
      coverageService: { compute: jest.fn().mockReturnValue(starterCoverage) },
      aiGenerator: {
        assessStarterTreatment: jest.fn().mockResolvedValue(null),
        generateWithDiagnostics: jest
          .fn()
          .mockResolvedValue(aiGenerationResult(generatedPicks)),
      },
      repos,
    });

    const overview = await service.getOverview(user(), 'starter');

    expect(overview.mode).toBe('starter');
    expect(overview.emptyState.reason).toBeNull();
    expect(overview.priorityGaps).toHaveLength(4);
    expect(overview.starterKit.steps).toEqual([
      expect.objectContaining({
        order: 1,
        role: 'cleanse',
        status: SmartPicksStarterKitStepStatus.Recommended,
        ownedProductName: null,
        pick: expect.objectContaining({
          productName: 'Gentle fragrance-free cleanser pick',
        }),
      }),
      expect.objectContaining({
        order: 2,
        role: 'moisturise',
        status: SmartPicksStarterKitStepStatus.Recommended,
      }),
      expect.objectContaining({
        order: 3,
        role: 'spf',
        status: SmartPicksStarterKitStepStatus.Recommended,
      }),
      expect.objectContaining({
        order: 4,
        role: 'treat',
        status: SmartPicksStarterKitStepStatus.Recommended,
      }),
    ]);
  });

  it('marks owned starter steps as covered and recommends only the missing essentials', async () => {
    const ownedCleanser = ownedProduct();
    const activeContext = context({
      mode: 'starter',
      activeProducts: [ownedCleanser],
      allProducts: [ownedCleanser],
      inputsHash: 'starter-partial-hash',
    });
    const starterCoverage: SmartPicksCoverage = {
      filled: 1,
      total: 4,
      slots: [
        {
          role: 'cleanse',
          state: 'filled',
          filledByProductId: ownedCleanser.id,
          filledByName: ownedCleanser.name,
          goalRelevance: 'essential',
        },
        slot('moisturise'),
        slot('spf'),
        slot('treat'),
      ],
    };
    const starterGaps = buildGapSnapshots(activeContext, starterCoverage);
    const repos = {
      snapshots: repo<SmartPickSnapshot>(),
      suggestions: repo<SmartPickProductSuggestion>(),
      actions: repo<SuggestionGapAction>(),
      profiles: repo<SkinProfile>(),
    };
    repos.snapshots.findOne.mockResolvedValue(
      snapshot({
        mode: 'starter',
        inputs_hash: activeContext.inputsHash,
        coverage_json: starterCoverage,
        gaps_json: starterGaps,
        covered_json: [],
        redundancy_json: [],
      }),
    );
    repos.suggestions.find.mockResolvedValue(
      starterGaps.map((gap) =>
        productSuggestion({
          id: `pick-${gap.normalizedKey}`,
          ingredient_or_category: gap.ingredientOrCategory,
          normalized_key: gap.normalizedKey,
          product_name: `${gap.ingredientOrCategory} pick`,
        }),
      ),
    );
    repos.actions.find.mockResolvedValue([]);

    const service = serviceWith({
      contextBuilder: { build: jest.fn().mockResolvedValue(activeContext) },
      repos,
    });

    const overview = await service.getOverview(user(), 'starter');

    expect(
      overview.priorityGaps.map((gap) => gap.ingredientOrCategory),
    ).toEqual([
      'Barrier-support moisturizer',
      'Broad-spectrum sunscreen SPF 30+',
      'Azelaic acid or tranexamic acid dark-spot serum',
    ]);
    expect(overview.starterKit.steps).toEqual([
      expect.objectContaining({
        order: 1,
        role: 'cleanse',
        status: SmartPicksStarterKitStepStatus.Covered,
        ownedProductName: 'Cleanser',
        pick: null,
      }),
      expect.objectContaining({
        order: 2,
        role: 'moisturise',
        status: SmartPicksStarterKitStepStatus.Recommended,
        pick: expect.objectContaining({
          productName: 'Barrier-support moisturizer pick',
        }),
      }),
      expect.objectContaining({
        order: 3,
        role: 'spf',
        status: SmartPicksStarterKitStepStatus.Recommended,
      }),
      expect.objectContaining({
        order: 4,
        role: 'treat',
        status: SmartPicksStarterKitStepStatus.Recommended,
      }),
    ]);
  });

  it('recommends hydration support when hydration is the stated starter goal', async () => {
    const activeContext = context({
      mode: 'starter',
      activeProducts: [],
      allProducts: [],
      inputsHash: 'starter-hydration-hash',
      skinProfile: profile({
        primary_goal: 'keep my routine simple and hydrated',
        current_concerns: ['dryness'],
      }),
    });
    const starterGaps = buildGapSnapshots(activeContext, coverage());

    expect(starterGaps.map((gap) => gap.ingredientOrCategory)).toEqual([
      'Gentle fragrance-free cleanser',
      'Barrier-support moisturizer',
      'Broad-spectrum sunscreen SPF 30+',
      'Hydrating serum with glycerin or hyaluronic acid',
    ]);

    const repos = {
      snapshots: repo<SmartPickSnapshot>(),
      suggestions: repo<SmartPickProductSuggestion>(),
      actions: repo<SuggestionGapAction>(),
      profiles: repo<SkinProfile>(),
    };
    repos.snapshots.findOne.mockResolvedValue(
      snapshot({
        mode: 'starter',
        inputs_hash: activeContext.inputsHash,
        coverage_json: coverage(),
        gaps_json: starterGaps,
        covered_json: [],
        redundancy_json: [],
      }),
    );
    repos.suggestions.find.mockResolvedValue(
      starterGaps.map((gap) =>
        productSuggestion({
          id: `pick-${gap.normalizedKey}`,
          ingredient_or_category: gap.ingredientOrCategory,
          normalized_key: gap.normalizedKey,
          product_name: `${gap.ingredientOrCategory} pick`,
        }),
      ),
    );
    repos.actions.find.mockResolvedValue([]);

    const service = serviceWith({
      contextBuilder: { build: jest.fn().mockResolvedValue(activeContext) },
      repos,
    });

    const overview = await service.getOverview(user(), 'starter');
    const treatmentStep = overview.starterKit.steps.find(
      (step) => step.role === 'treat',
    );

    expect(treatmentStep).toEqual(
      expect.objectContaining({
        status: SmartPicksStarterKitStepStatus.Recommended,
        ingredientOrCategory:
          'Hydrating serum with glycerin or hyaluronic acid',
      }),
    );
  });

  it('uses concerns, not only primary goal, to decide starter treatment need', () => {
    const gaps = buildGapSnapshots(
      context({
        mode: 'starter',
        skinProfile: profile({
          primary_goal: 'build a simple routine',
          current_concerns: ['breakouts'],
        }),
      }),
      coverage(),
    );

    expect(gaps.map((gap) => gap.ingredientOrCategory)).toContain(
      'Low-irritation acne treatment with azelaic acid or BHA',
    );
  });

  it('still recommends a goal-specific starter treatment when an existing serum does not match the goal', () => {
    const gaps = buildGapSnapshots(
      context({
        mode: 'starter',
        activeProducts: [
          ownedProduct({
            id: 'hydrating-serum',
            name: 'Hyaluronic Hydration Serum',
            category: ProductCategory.Serum,
            identity: {
              inciIngredients: ['hyaluronic acid', 'glycerin'],
            } as InventoryProduct['identity'],
          }),
        ],
        skinProfile: profile({
          primary_goal: 'calm breakouts',
          current_concerns: ['acne'],
        }),
      }),
      coverage(),
    );

    expect(gaps.map((gap) => gap.ingredientOrCategory)).toContain(
      'Low-irritation acne treatment with azelaic acid or BHA',
    );
  });

  it('does not add a duplicate starter treatment when the shelf already has one aligned to the goal', () => {
    const gaps = buildGapSnapshots(
      context({
        mode: 'starter',
        activeProducts: [
          ownedProduct({
            id: 'azelaic-serum',
            name: 'Azelaic Tone Serum',
            category: ProductCategory.Serum,
            identity: {
              inciIngredients: ['azelaic acid'],
            } as InventoryProduct['identity'],
          }),
        ],
        skinProfile: profile({
          primary_goal: 'fade dark marks',
          current_concerns: ['hyperpigmentation'],
        }),
      }),
      coverage(),
    );

    expect(gaps.map((gap) => gap.ingredientOrCategory)).not.toContain(
      'Azelaic acid or tranexamic acid dark-spot serum',
    );
  });

  it('does not block starter generation on a separate starter-treatment AI call', async () => {
    const activeContext = context({
      mode: 'starter',
      activeProducts: [],
      allProducts: [],
      inputsHash: 'starter-fast-dark-spot-hash',
      skinProfile: profile({
        primary_goal: 'fade hyperpigmentation',
        current_concerns: ['dark marks'],
      }),
    });
    const repos = {
      snapshots: repo<SmartPickSnapshot>(),
      suggestions: repo<SmartPickProductSuggestion>(),
      actions: repo<SuggestionGapAction>(),
      profiles: repo<SkinProfile>(),
    };
    repos.snapshots.findOne.mockResolvedValue(null);
    repos.snapshots.create.mockImplementation(
      (value) => value as SmartPickSnapshot,
    );
    repos.snapshots.save.mockImplementation(async (value) =>
      snapshot({
        ...(value as Partial<SmartPickSnapshot>),
        id: 'starter-ai-snapshot',
        generated_at: new Date('2026-05-12T09:00:00.000Z'),
      }),
    );
    repos.suggestions.findOne.mockResolvedValue(null);
    repos.suggestions.find.mockResolvedValue([]);
    repos.suggestions.create.mockImplementation(
      (value) => value as SmartPickProductSuggestion,
    );
    repos.suggestions.save.mockImplementation(
      async (value) => value as SmartPickProductSuggestion,
    );
    repos.actions.find.mockResolvedValue([]);
    const aiGenerator = {
      assessStarterTreatment: jest
        .fn()
        .mockRejectedValue(new Error('should not block starter overview')),
      generateWithDiagnostics: jest
        .fn()
        .mockResolvedValue(
          aiGenerationResult(new Map<string, GeneratedSmartPick>()),
        ),
    };

    const service = serviceWith({
      contextBuilder: { build: jest.fn().mockResolvedValue(activeContext) },
      aiGenerator,
      repos,
    });

    const overview = await service.getOverview(user(), 'starter');
    const treatmentStep = overview.starterKit.steps.find(
      (step) => step.role === 'treat',
    );

    expect(aiGenerator.assessStarterTreatment).not.toHaveBeenCalled();
    expect(
      overview.priorityGaps.map((gap) => gap.ingredientOrCategory),
    ).toContain('Azelaic acid or tranexamic acid dark-spot serum');
    expect(treatmentStep).toEqual(
      expect.objectContaining({
        status: SmartPicksStarterKitStepStatus.Recommended,
        ingredientOrCategory: 'Azelaic acid or tranexamic acid dark-spot serum',
      }),
    );
    await service.waitForBackgroundGeneration();
    expect(aiGenerator.generateWithDiagnostics).toHaveBeenCalledWith(
      activeContext,
      expect.arrayContaining([
        expect.objectContaining({
          ingredientOrCategory:
            'Azelaic acid or tranexamic acid dark-spot serum',
        }),
      ]),
    );
  });

  it.each([
    {
      label: 'dark marks in Sweden on mid budget',
      countryCode: 'SE',
      city: 'Stockholm',
      ethnicity: 'Yoruba',
      budgetTier: 'mid' as const,
      primaryGoal: 'fade dark marks',
      concerns: ['hyperpigmentation'],
      expectedTreatment: 'Azelaic acid or tranexamic acid dark-spot serum',
    },
    {
      label: 'breakouts in the US on drugstore budget',
      countryCode: 'US',
      city: 'Atlanta',
      ethnicity: 'African American',
      budgetTier: 'drugstore' as const,
      primaryGoal: 'simple routine',
      concerns: ['breakouts'],
      expectedTreatment:
        'Low-irritation acne treatment with azelaic acid or BHA',
    },
    {
      label: 'aging in South Korea with higher spend preference',
      countryCode: 'KR',
      city: 'Seoul',
      ethnicity: 'Black British',
      budgetTier: 'premium' as const,
      primaryGoal: 'fine lines and firmness',
      concerns: ['fine lines'],
      expectedTreatment: 'Beginner retinoid or retinal night treatment',
    },
    {
      label: 'texture in Nigeria on mid budget',
      countryCode: 'NG',
      city: 'Lagos',
      ethnicity: 'Yoruba',
      budgetTier: 'mid' as const,
      primaryGoal: 'smooth rough texture',
      concerns: ['texture'],
      expectedTreatment: 'Gentle AHA/PHA texture treatment',
    },
    {
      label: 'redness in the UK on drugstore budget',
      countryCode: 'GB',
      city: 'London',
      ethnicity: 'Black British',
      budgetTier: 'drugstore' as const,
      primaryGoal: 'calm redness and irritation',
      concerns: ['redness'],
      expectedTreatment: 'Barrier-calming serum with niacinamide or panthenol',
    },
    {
      label: 'hydration in Sweden on drugstore budget',
      countryCode: 'SE',
      city: 'Gothenburg',
      ethnicity: 'Somali',
      budgetTier: 'drugstore' as const,
      primaryGoal: 'keep skin hydrated',
      concerns: ['dryness'],
      expectedTreatment: 'Hydrating serum with glycerin or hyaluronic acid',
    },
  ])(
    'keeps starter kit goal-aware for $label',
    ({
      countryCode,
      city,
      ethnicity,
      budgetTier,
      primaryGoal,
      concerns,
      expectedTreatment,
    }) => {
      const gaps = buildGapSnapshots(
        context({
          mode: 'starter',
          budgetTier,
          skinProfile: profile({
            country_code: countryCode,
            city,
            ethnicity,
            primary_goal: primaryGoal,
            current_concerns: concerns,
          }),
        }),
        coverage(),
      );
      const treatment = gaps.find((gap) => starterGapRole(gap) === 'treat');

      expect(treatment?.ingredientOrCategory ?? null).toBe(expectedTreatment);
    },
  );

  it('still waits on treatment when the user only asks for a basic routine', () => {
    const gaps = buildGapSnapshots(
      context({
        mode: 'starter',
        skinProfile: profile({
          primary_goal: 'build a simple routine',
          current_concerns: [],
        }),
      }),
      coverage(),
    );

    expect(gaps.map((gap) => gap.ingredientOrCategory)).toEqual([
      'Gentle fragrance-free cleanser',
      'Barrier-support moisturizer',
      'Broad-spectrum sunscreen SPF 30+',
    ]);
  });
});

function serviceWith({
  contextBuilder,
  coverageService = { compute: jest.fn().mockReturnValue(coverage()) },
  aiGenerator = {
    assessStarterTreatment: jest.fn().mockResolvedValue(null),
    generateWithDiagnostics: jest
      .fn()
      .mockResolvedValue(aiGenerationResult(new Map())),
  },
  repos,
}: {
  contextBuilder: Pick<SmartPicksOverviewService, never> & {
    build: jest.Mock;
  };
  coverageService?: { compute: jest.Mock };
  aiGenerator?: {
    assessStarterTreatment: jest.Mock;
    generateWithDiagnostics: jest.Mock;
  };
  repos: {
    snapshots: jest.Mocked<Repository<SmartPickSnapshot>>;
    suggestions: jest.Mocked<Repository<SmartPickProductSuggestion>>;
    actions: jest.Mocked<Repository<SuggestionGapAction>>;
    profiles: jest.Mocked<Repository<SkinProfile>>;
  };
}) {
  return new SmartPicksOverviewService(
    contextBuilder as never,
    coverageService,
    { detect: jest.fn().mockReturnValue([]) },
    aiGenerator as never,
    { dispatch: jest.fn().mockResolvedValue(null) } as never,
    { record: jest.fn().mockResolvedValue(undefined) } as never,
    repos.snapshots,
    repos.suggestions,
    repos.actions,
    repos.profiles,
  );
}

function repo<T extends object>() {
  return {
    create: jest.fn((value) => value),
    delete: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  } as unknown as jest.Mocked<Repository<T>>;
}

function user(): User {
  return { id: 'user-1', time_zone: 'Europe/Stockholm' } as User;
}

function context(
  overrides: Partial<SmartPicksContext> = {},
): SmartPicksContext {
  return {
    user: user(),
    skinProfile: profile(),
    skinProfileRequired: false,
    consentRequired: false,
    activeProducts: [],
    allProducts: [ownedProduct()],
    environment: null,
    budgetTier: 'mid',
    mode: 'refine',
    inputsHash: 'hash-1',
    productPerformance: [],
    missingProfileFields: [],
    ...overrides,
  };
}

function profile(overrides: Partial<SkinProfile> = {}): SkinProfile {
  return {
    user_id: 'user-1',
    skin_type: 'combination',
    skin_tone: 'deep',
    ethnicity: 'Yoruba',
    current_concerns: ['dark marks'],
    primary_goal: 'dark marks',
    country_code: 'SE',
    city: 'Stockholm',
    allow_smart_picks: true,
    ...overrides,
  } as unknown as SkinProfile;
}

function replacementContext(): SmartPicksContext {
  return {
    ...context(),
    activeProducts: [ownedProduct()],
    productPerformance: [
      {
        productId: 'owned-1',
        brand: 'Owned',
        productName: 'Current Brightening Serum',
        category: ProductCategory.Serum,
        usageDaysLast30: 16,
        usageDaysLast90: 42,
        firstUsedAt: '2026-02-20',
        lastUsedAt: '2026-05-10',
        adherence: SmartPicksProductAdherence.Consistent,
        goalTrend: SmartPicksProductPerformanceSignal.NotImproving,
        concernTrend: 'hyperpigmentation',
        photoCheckpoints: 3,
        reactionSignalCount: 0,
        replacementCandidate: true,
        replacementReason:
          '42 logged use days and photo history still shows hyperpigmentation.',
      },
    ],
  };
}

function coverage(): SmartPicksCoverage {
  return {
    filled: 0,
    total: 4,
    slots: [
      slot('spf'),
      slot('moisturise'),
      slot('cleanse'),
      slot('treat'),
      {
        role: 'hydrate',
        state: 'missing',
        filledByProductId: null,
        filledByName: null,
        goalRelevance: 'supportive',
      },
    ],
  };
}

function filledCoverage(): SmartPicksCoverage {
  return {
    filled: 5,
    total: 5,
    slots: [
      {
        role: 'spf',
        state: 'filled',
        filledByProductId: 'spf-1',
        filledByName: 'SPF',
        goalRelevance: 'essential',
      },
      {
        role: 'moisturise',
        state: 'filled',
        filledByProductId: 'cream-1',
        filledByName: 'Cream',
        goalRelevance: 'essential',
      },
      {
        role: 'cleanse',
        state: 'filled',
        filledByProductId: 'cleanser-1',
        filledByName: 'Cleanser',
        goalRelevance: 'essential',
      },
      {
        role: 'treat',
        state: 'filled',
        filledByProductId: 'owned-1',
        filledByName: 'Current Brightening Serum',
        goalRelevance: 'essential',
      },
      {
        role: 'hydrate',
        state: 'filled',
        filledByProductId: 'essence-1',
        filledByName: 'Essence',
        goalRelevance: 'supportive',
      },
    ],
  };
}

function coverageWithMissingSpf(): SmartPicksCoverage {
  return {
    ...filledCoverage(),
    filled: 4,
    slots: [
      {
        role: 'spf',
        state: 'missing-priority',
        filledByProductId: null,
        filledByName: null,
        goalRelevance: 'essential',
      },
      ...filledCoverage().slots.filter((slot) => slot.role !== 'spf'),
    ],
  };
}

function gapSnapshot(
  overrides: Partial<ReturnType<typeof buildGapSnapshots>[number]> = {},
): ReturnType<typeof buildGapSnapshots>[number] {
  return {
    ingredientOrCategory: 'Broad-spectrum sunscreen SPF 30+',
    normalizedKey: 'broad-spectrum-sunscreen-spf-30',
    priority: 'priority',
    reason: 'No SPF on shelf.',
    shortReason: 'No SPF on shelf.',
    goalAlignment: 'sun protection',
    sourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
    gapKind: SmartPicksGapKind.Missing,
    replacementFor: null,
    ...overrides,
  };
}

function slot(role: 'spf' | 'moisturise' | 'cleanse' | 'treat') {
  return {
    role,
    state: 'missing-priority' as const,
    filledByProductId: null,
    filledByName: null,
    goalRelevance: 'essential' as const,
  };
}

function generatedPick(
  overrides: Partial<GeneratedSmartPick> = {},
): GeneratedSmartPick {
  return {
    brand: 'Good Brand',
    productName: 'Mineral SPF 50',
    budgetTier: 'mid',
    sellerNames: ['Derm Store'],
    reasoningChips: [],
    reasoningFacts: {},
    ruledOut: [],
    sourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
    alternatives: [
      {
        brand: 'Local Brand',
        productName: 'Local SPF',
        budgetTier: 'mid',
        sellerNames: [],
        reasoningChips: [],
        reasoningFacts: {},
        ruledOut: [],
        sourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
        alternatives: [],
        recommendationRankReason: 'Alternative match for the goal.',
      },
    ],
    recommendationRankReason: 'Best match for the goal.',
    ...overrides,
  };
}

function aiGenerationResult(
  picks: Map<string, GeneratedSmartPick>,
  overrides: Partial<{
    requestedGapCount: number;
    rawGapCount: number;
    acceptedPickCount: number;
    blockedOwnedCount: number;
    blockedBudgetCount: number;
    blockedSafetyCount: number;
    invalidPickCount: number;
    missingPickCount: number;
    providerFailed: boolean;
    providerSkippedReason: null;
  }> = {},
) {
  const requestedGapCount = overrides.requestedGapCount ?? picks.size;
  return {
    picks,
    diagnostics: {
      requestedGapCount,
      rawGapCount: overrides.rawGapCount ?? picks.size,
      acceptedPickCount: overrides.acceptedPickCount ?? picks.size,
      blockedOwnedCount: overrides.blockedOwnedCount ?? 0,
      blockedBudgetCount: overrides.blockedBudgetCount ?? 0,
      blockedSafetyCount: overrides.blockedSafetyCount ?? 0,
      invalidPickCount: overrides.invalidPickCount ?? 0,
      missingPickCount:
        overrides.missingPickCount ??
        Math.max(0, requestedGapCount - picks.size),
      providerFailed: overrides.providerFailed ?? false,
      providerSkippedReason: overrides.providerSkippedReason ?? null,
    },
  };
}

function deferredValue<T>(value: T) {
  let resolvePromise: (() => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = () => resolve(value);
  });
  return {
    promise,
    resolve: () => {
      if (!resolvePromise) {
        throw new Error('Deferred value was not initialized.');
      }
      resolvePromise();
    },
  };
}

function productSuggestion(
  overrides: Partial<SmartPickProductSuggestion> = {},
): SmartPickProductSuggestion {
  return {
    id: 'pick-1',
    user_id: 'user-1',
    ingredient_or_category: 'Broad-spectrum sunscreen SPF 30+',
    normalized_key: 'broad-spectrum-sunscreen-spf-30',
    brand: 'Good Brand',
    product_name: 'Mineral SPF 50',
    budget_tier: 'mid',
    seller_names_json: [],
    reasoning_chips_json: [],
    reasoning_facts_json: {},
    ruled_out_json: [],
    alternatives_json: [],
    source_ids: [SuggestionEvidenceSourceId.AadSunscreenSelection],
    recommendation_rank_reason: 'Best local SPF fit.',
    inputs_hash: 'hash-1',
    gap_reason: 'No SPF on shelf.',
    goal_alignment: 'sun protection',
    created_at: new Date('2026-05-12T09:00:00.000Z'),
    updated_at: new Date('2026-05-12T09:00:00.000Z'),
    user: null as never,
    generateId: jest.fn(),
    ...overrides,
  };
}

function snapshot(overrides: Partial<SmartPickSnapshot>): SmartPickSnapshot {
  return {
    id: 'snapshot-1',
    user_id: 'user-1',
    mode: 'refine',
    coverage_json: coverage(),
    gaps_json: [],
    covered_json: [],
    redundancy_json: [],
    recap_json: {
      primaryGoal: 'dark marks',
      skinType: 'combination',
      location: { city: 'Stockholm', countryCode: 'SE' },
      budgetTier: 'mid',
      ethnicity: 'Yoruba',
    },
    inputs_hash: 'hash-1',
    generated_at: new Date('2026-05-12T09:00:00.000Z'),
    created_at: new Date('2026-05-12T09:00:00.000Z'),
    updated_at: new Date('2026-05-12T09:00:00.000Z'),
    user: null as never,
    generateId: jest.fn(),
    ...overrides,
  } as SmartPickSnapshot;
}

function gapAction(
  overrides: Partial<SuggestionGapAction> = {},
): SuggestionGapAction {
  return {
    id: 'action-1',
    user_id: 'user-1',
    source_type: 'smart_pick',
    suggestion_instance_id: null,
    smart_pick_product_suggestion_id: 'pick-1',
    ingredient_or_category: 'Broad-spectrum sunscreen SPF 30+',
    normalized_key: 'broad-spectrum-sunscreen-spf-30',
    action: 'saved',
    created_at: new Date('2026-05-12T09:00:00.000Z'),
    updated_at: new Date('2026-05-12T09:00:00.000Z'),
    user: null as never,
    suggestion_instance: null,
    smart_pick_product_suggestion: null,
    generateId: jest.fn(),
    ...overrides,
  };
}

function starterGapRole(gap: { normalizedKey: string }) {
  const key = gap.normalizedKey;
  if (key.includes('cleanser') || key.includes('cleanse')) return 'cleanse';
  if (key.includes('moisturizer') || key.includes('moisturiser')) {
    return 'moisturise';
  }
  if (key.includes('sunscreen') || key.includes('spf')) return 'spf';
  return 'treat';
}

function ownedProduct(
  overrides: Partial<InventoryProduct> = {},
): InventoryProduct {
  return {
    id: 'owned-1',
    user_id: 'user-1',
    brand: 'Owned',
    name: 'Cleanser',
    category: ProductCategory.Cleanser,
    status: ShelfStatus.Active,
    identity: { inciIngredients: [] },
    ...overrides,
  } as unknown as InventoryProduct;
}

import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ApplicationItemStatus } from '../application-tracking/application-tracking.constants';
import { ApplicationLogItem } from '../application-tracking/entities/application-log-item.entity';
import { ApplicationLog } from '../application-tracking/entities/application-log.entity';
import { CataloguePhotoStorageService } from '../catalogue/catalogue-photo-storage.service';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { ProductCategory, ShelfStatus } from '../shelf/shelf.types';
import { RoutineSimplificationEvent } from '../skin-journal/entities/routine-simplification-event.entity';
import { SkinJournalEntry } from '../skin-journal/entities/skin-journal-entry.entity';
import type {
  AnalysisObservations,
  ReactionReportPayload,
} from '../skin-journal/skin-journal.constants';
import type { User } from '../users/entities/user.entity';
import { RoutineMemoryService } from './routine-memory.service';
import {
  RoutineMemoryEventTypeValue,
  RoutineMemoryReasonCodeValue,
} from './routine-memory.types';

const repo = () => ({
  find: jest.fn(),
  createQueryBuilder: jest.fn(),
});

type MockRepo = ReturnType<typeof repo>;

const queryBuilder = () => ({
  innerJoin: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  getRawMany: jest.fn(),
});

type MockQueryBuilder = ReturnType<typeof queryBuilder>;

describe('RoutineMemoryService', () => {
  let service: RoutineMemoryService;
  let applications: MockRepo;
  let entries: MockRepo;
  let inventoryProducts: MockRepo;
  let simplifications: MockRepo;
  let applicationUsageQueryBuilder: MockQueryBuilder;
  let cataloguePhotoStorageService: {
    resolvePublicImageUrls: jest.Mock<string[], [string[]]>;
  };

  const user = { id: 'user-1', time_zone: 'UTC' } as User;
  const now = new Date('2026-06-13T10:00:00.000Z');

  beforeEach(async () => {
    applications = repo();
    entries = repo();
    inventoryProducts = repo();
    simplifications = repo();
    cataloguePhotoStorageService = {
      resolvePublicImageUrls: jest.fn((imageUrls: string[]) =>
        imageUrls.map((imageUrl) =>
          imageUrl.replace(
            'https://media.example.com',
            'https://cdn.example.com',
          ),
        ),
      ),
    };

    applications.find.mockResolvedValue([]);
    applicationUsageQueryBuilder = queryBuilder();
    applicationUsageQueryBuilder.getRawMany.mockResolvedValue([]);
    applications.createQueryBuilder.mockReturnValue(
      applicationUsageQueryBuilder,
    );
    entries.find.mockResolvedValue([]);
    inventoryProducts.find.mockResolvedValue([]);
    simplifications.find.mockResolvedValue([]);

    const module = await Test.createTestingModule({
      providers: [
        RoutineMemoryService,
        { provide: getRepositoryToken(ApplicationLog), useValue: applications },
        { provide: getRepositoryToken(SkinJournalEntry), useValue: entries },
        {
          provide: getRepositoryToken(InventoryProduct),
          useValue: inventoryProducts,
        },
        {
          provide: getRepositoryToken(RoutineSimplificationEvent),
          useValue: simplifications,
        },
        {
          provide: CataloguePhotoStorageService,
          useValue: cataloguePhotoStorageService,
        },
      ],
    }).compile();

    service = module.get(RoutineMemoryService);
  });

  it('connects product changes, use, reaction signals, skipped items, and recovery without claiming causation', async () => {
    const retinol = product({
      id: 'retinol-1',
      brand: 'Paula Choice',
      name: 'Retinol 0.3%',
      category: ProductCategory.Treatment,
      created_at: new Date('2026-06-05T08:00:00.000Z'),
    });
    retinol.identity.imageUrls = [
      'https://media.example.com/products/retinol.webp',
    ];

    inventoryProducts.find.mockResolvedValue([retinol]);
    applications.find.mockResolvedValue([
      log('log-1', '2026-06-06', [appliedItem(retinol)]),
      log('log-2', '2026-06-08', [appliedItem(retinol)]),
      log('log-3', '2026-06-09', [skippedItem(retinol)]),
    ]);
    entries.find.mockResolvedValue([
      entry('entry-1', '2026-06-07', {
        recent_change: {
          kind: 'started_new_product',
          related_inventory_product_id: retinol.id,
          note: 'Raw note should not leave the backend read model.',
        },
        reaction_report: reactionReport({
          symptoms: ['burning', 'stinging'],
          severity: 'moderate',
        }),
      }),
    ]);
    simplifications.find.mockResolvedValue([
      simplification('simplification-1', '2026-06-08T09:00:00.000Z'),
    ]);

    const result = await service.getTimeline(user, {}, now);

    expect(result.summary.hasPossibleLinks).toBe(true);
    expect(result.disclaimer).toContain('not proof');
    expect(result.timeline.map((event) => event.type)).toEqual([
      RoutineMemoryEventTypeValue.ProductAdded,
      RoutineMemoryEventTypeValue.FirstLoggedUse,
      RoutineMemoryEventTypeValue.RecentChangeLogged,
      RoutineMemoryEventTypeValue.ReactionSignal,
      RoutineMemoryEventTypeValue.ProductUsed,
      RoutineMemoryEventTypeValue.RecoveryStarted,
      RoutineMemoryEventTypeValue.ProductSkipped,
    ]);
    expect(result.suspiciousProducts[0]).toMatchObject({
      productId: 'retinol-1',
      brand: 'Paula Choice',
      name: 'Retinol 0.3%',
      imageUrl: 'https://cdn.example.com/products/retinol.webp',
      suspicionLevel: 'higher_attention',
    });
    expect(result.suspiciousProducts[0].reasonCodes).toEqual(
      expect.arrayContaining([
        RoutineMemoryReasonCodeValue.ReactionAfterFirstLoggedUse,
        RoutineMemoryReasonCodeValue.ReactionAfterProductAdded,
        RoutineMemoryReasonCodeValue.SkippedAfterReaction,
        RoutineMemoryReasonCodeValue.ActiveCategoryNearReaction,
      ]),
    );
    expect(
      cataloguePhotoStorageService.resolvePublicImageUrls,
    ).toHaveBeenCalledTimes(1);
    expect(inventoryProducts.find).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          id: true,
          brand: true,
          name: true,
          category: true,
          created_at: true,
          identity: true,
        }),
      }),
    );
    expect(applications.find).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          general_notes: true,
          edit_reason: true,
        }),
      }),
    );
    const applicationFindOptions = applications.find.mock.calls[0]?.[0] as {
      select?: { items?: Record<string, unknown> };
    };
    expect(applicationFindOptions.select?.items).toEqual(
      expect.not.objectContaining({
        notes: true,
        substitution_reason: true,
      }),
    );
    expect(applicationFindOptions.select?.items?.product).toEqual(
      expect.objectContaining({
        identity: true,
      }),
    );
    expect(entries.find).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          complaint_note: true,
          photo_object_key: true,
        }),
      }),
    );
    expect(simplifications.find).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          id: true,
          started_at: true,
        },
      }),
    );
    expect(result.productTimelines[0]).toMatchObject({
      product: {
        productId: 'retinol-1',
        brand: 'Paula Choice',
        name: 'Retinol 0.3%',
        imageUrl: 'https://cdn.example.com/products/retinol.webp',
      },
      suspicionLevel: 'higher_attention',
    });
    expect(
      result.productTimelines[0].timeline.map((event) => event.type),
    ).toEqual([
      RoutineMemoryEventTypeValue.ProductAdded,
      RoutineMemoryEventTypeValue.FirstLoggedUse,
      RoutineMemoryEventTypeValue.RecentChangeLogged,
      RoutineMemoryEventTypeValue.ReactionSignal,
      RoutineMemoryEventTypeValue.ProductUsed,
      RoutineMemoryEventTypeValue.RecoveryStarted,
      RoutineMemoryEventTypeValue.ProductSkipped,
    ]);
  });

  it('adds regular product use nodes inside the requested duration window', async () => {
    const serum = product({
      id: 'serum-1',
      brand: 'Sensitive Lab',
      name: 'Barrier Serum',
      category: ProductCategory.Serum,
      created_at: new Date('2026-05-01T08:00:00.000Z'),
    });

    inventoryProducts.find.mockResolvedValue([serum]);
    applications.find.mockResolvedValue([
      log('log-1', '2026-06-08', [appliedItem(serum)]),
      log('log-2', '2026-06-10', [appliedItem(serum)]),
      log('log-3', '2026-06-13', [appliedItem(serum)]),
    ]);

    const result = await service.getTimeline(
      user,
      { from: '2026-06-07', to: '2026-06-13' },
      now,
    );

    expect(result.window).toEqual({
      start: '2026-06-07',
      end: '2026-06-13',
      days: 7,
    });
    expect(applications.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: 'user-1',
          target_date: expect.objectContaining({
            _type: 'between',
            _value: ['2026-06-07', '2026-06-13'],
          }),
        }),
      }),
    );
    expect(
      result.productTimelines[0].timeline.map((event) => event.type),
    ).toEqual([
      RoutineMemoryEventTypeValue.FirstLoggedUse,
      RoutineMemoryEventTypeValue.ProductUsed,
      RoutineMemoryEventTypeValue.ProductUsed,
    ]);
  });

  it('uses lifetime first use so short windows do not make old products look newly introduced', async () => {
    const retinol = product({
      id: 'retinol-1',
      brand: 'Paula Choice',
      name: 'Retinol 0.3%',
      category: ProductCategory.Treatment,
      created_at: new Date('2026-01-01T08:00:00.000Z'),
    });

    inventoryProducts.find.mockResolvedValue([retinol]);
    applicationUsageQueryBuilder.getRawMany.mockResolvedValue([
      {
        productId: retinol.id,
        firstUseDate: '2026-01-10',
        lastUseDate: '2026-06-12',
      },
    ]);
    applications.find.mockResolvedValue([
      log('log-1', '2026-06-12', [appliedItem(retinol)]),
    ]);
    entries.find.mockResolvedValue([
      entry('entry-1', '2026-06-13', {
        reaction_report: reactionReport({
          symptoms: ['burning'],
          severity: 'mild',
        }),
      }),
    ]);

    const result = await service.getTimeline(
      user,
      { from: '2026-06-07', to: '2026-06-13' },
      now,
    );

    expect(applicationUsageQueryBuilder.groupBy).toHaveBeenCalledWith(
      'COALESCE(item.substituted_with_product_id, item.inventory_product_id)',
    );
    expect(result.suspiciousProducts).toEqual([]);
    expect(result.productTimelines[0]).toMatchObject({
      firstUseDate: '2026-01-10',
      lastUseDate: '2026-06-12',
    });
    expect(
      result.productTimelines[0].timeline.map((event) => event.type),
    ).toEqual([RoutineMemoryEventTypeValue.ProductUsed]);
    expect(result.timeline.map((event) => event.type)).toEqual([
      RoutineMemoryEventTypeValue.ProductUsed,
      RoutineMemoryEventTypeValue.ReactionSignal,
    ]);
  });

  it('uses frequency-change memory when symptoms start after a changed routine', async () => {
    const exfoliant = product({
      id: 'exfoliant-1',
      brand: 'The Ordinary',
      name: 'Glycolic Acid 7%',
      category: ProductCategory.Exfoliant,
      created_at: new Date('2026-05-10T08:00:00.000Z'),
    });

    inventoryProducts.find.mockResolvedValue([exfoliant]);
    applications.find.mockResolvedValue([
      log('log-1', '2026-06-10', [appliedItem(exfoliant)]),
    ]);
    entries.find.mockResolvedValue([
      entry('entry-1', '2026-06-10', {
        recent_change: {
          kind: 'changed_frequency',
          related_inventory_product_id: exfoliant.id,
        },
      }),
      entry('entry-2', '2026-06-11', {
        has_reaction_signal: true,
        analysis_observations: observations({
          reaction_signals: {
            reaction_detected: true,
            reaction_severity: 'mild',
            confidence: 0.74,
            indicators: ['redness'],
          },
        }),
      }),
    ]);

    const result = await service.getTimeline(user, {}, now);

    expect(result.timeline.map((event) => event.type)).toContain(
      RoutineMemoryEventTypeValue.FrequencyChanged,
    );
    expect(result.suspiciousProducts[0].reasonCodes).toContain(
      RoutineMemoryReasonCodeValue.ReactionAfterFrequencyChange,
    );
    expect(
      result.productTimelines[0].timeline.map((event) => event.type),
    ).toEqual([
      RoutineMemoryEventTypeValue.FirstLoggedUse,
      RoutineMemoryEventTypeValue.FrequencyChanged,
      RoutineMemoryEventTypeValue.ReactionSignal,
    ]);
  });

  it('builds product timelines for active shelf products already owned before the window', async () => {
    const cleanser = product({
      id: 'cleanser-1',
      brand: 'CeraVe',
      name: 'Hydrating Cleanser',
      category: ProductCategory.Cleanser,
      created_at: new Date('2026-04-01T08:00:00.000Z'),
    });

    inventoryProducts.find.mockResolvedValue([cleanser]);
    applications.find.mockResolvedValue([
      log('log-1', '2026-06-12', [appliedItem(cleanser)]),
    ]);

    const result = await service.getTimeline(user, {}, now);

    expect(result.productTimelines).toHaveLength(1);
    expect(result.productTimelines[0]).toMatchObject({
      product: {
        productId: 'cleanser-1',
        brand: 'CeraVe',
        name: 'Hydrating Cleanser',
      },
      suspicionLevel: null,
      reasonCodes: [],
    });
    expect(
      result.productTimelines[0].timeline.map((event) => event.type),
    ).toEqual([RoutineMemoryEventTypeValue.FirstLoggedUse]);
    expect(result.timeline.map((event) => event.type)).not.toContain(
      RoutineMemoryEventTypeValue.ProductAdded,
    );
  });

  it('minimizes sensitive freeform data in the returned read model', async () => {
    const serum = product({
      id: 'serum-1',
      brand: 'Sensitive Lab',
      name: 'Barrier Serum',
      category: ProductCategory.Serum,
    });

    inventoryProducts.find.mockResolvedValue([serum]);
    applications.find.mockResolvedValue([
      log(
        'log-1',
        '2026-06-12',
        [
          appliedItem(serum, {
            notes: 'Private item note',
          }),
        ],
        {
          general_notes: 'Private application note',
          edit_reason: 'Private edit reason',
        },
      ),
    ]);
    entries.find.mockResolvedValue([
      entry('entry-1', '2026-06-12', {
        complaint_note: 'Private complaint note',
        recent_change: {
          kind: 'other',
          note: 'Private recent change note',
        },
        reaction_report: reactionReport({
          symptoms: ['itching'],
          severity: 'mild',
        }),
      }),
    ]);

    const result = await service.getTimeline(user, {}, now);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('Private item note');
    expect(serialized).not.toContain('Private application note');
    expect(serialized).not.toContain('Private edit reason');
    expect(serialized).not.toContain('Private complaint note');
    expect(serialized).not.toContain('Private recent change note');
  });

  it('handles empty or legacy accounts without timeline data', async () => {
    const result = await service.getTimeline(user, {}, now);

    expect(result.timeline).toEqual([]);
    expect(result.suspiciousProducts).toEqual([]);
    expect(result.productTimelines).toEqual([]);
    expect(result.summary).toMatchObject({
      hasPossibleLinks: false,
      reactionSignalCount: 0,
      productChangeCount: 0,
      applicationLogCount: 0,
    });
  });
});

function product(overrides: Partial<InventoryProduct> = {}): InventoryProduct {
  return {
    id: 'product-1',
    user_id: 'user-1',
    brand: 'Brand',
    name: 'Product',
    category: ProductCategory.Serum,
    status: ShelfStatus.Active,
    barcode: null,
    provenance: 'photo-lookup',
    brand_search: 'brand',
    name_search: 'product',
    search_document: 'brand product',
    opened_at: null,
    expires_at: null,
    period_after_opening_months: null,
    effective_expires_at: null,
    identity: {
      brand: 'Brand',
      name: 'Product',
      category: ProductCategory.Serum,
      barcode: null,
      imageUrls: [],
      sizeMl: null,
      description: null,
      benefits: [],
      suitedFor: [],
      inciIngredients: [],
      inciLastConfirmedAt: null,
    },
    guidance: {
      applicationMethod: null,
      quantity: null,
      steps: [],
      cautions: [],
      waitMinutes: null,
    },
    manufacturer: {
      brand: 'Brand',
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
      preferredTimeOfDay: null,
    },
    created_at: new Date('2026-06-01T08:00:00.000Z'),
    updated_at: new Date('2026-06-01T08:00:00.000Z'),
    user: null,
    generateId: jest.fn(),
    ...overrides,
  } as InventoryProduct;
}

function log(
  id: string,
  targetDate: string,
  items: ApplicationLogItem[],
  overrides: Partial<ApplicationLog> = {},
): ApplicationLog {
  return {
    id,
    user_id: 'user-1',
    suggestion_instance_id: null,
    slot_id: null,
    target_date: targetDate,
    target_time: null,
    daypart: null,
    applied_at: new Date(`${targetDate}T20:00:00.000Z`),
    general_notes: null,
    edit_reason: null,
    edit_count: 0,
    has_been_edited: false,
    first_recorded_at: new Date(`${targetDate}T20:00:00.000Z`),
    last_edited_at: null,
    created_at: new Date(`${targetDate}T20:00:00.000Z`),
    updated_at: new Date(`${targetDate}T20:00:00.000Z`),
    user: null,
    suggestion_instance: null,
    slot: null,
    versions: [],
    items,
    generateId: jest.fn(),
    ...overrides,
  } as ApplicationLog;
}

function appliedItem(
  sourceProduct: InventoryProduct,
  overrides: Partial<ApplicationLogItem> = {},
): ApplicationLogItem {
  return item(sourceProduct, {
    status: ApplicationItemStatus.Applied,
    ...overrides,
  });
}

function skippedItem(
  sourceProduct: InventoryProduct,
  overrides: Partial<ApplicationLogItem> = {},
): ApplicationLogItem {
  return item(sourceProduct, {
    status: ApplicationItemStatus.Skipped,
    ...overrides,
  });
}

function item(
  sourceProduct: InventoryProduct,
  overrides: Partial<ApplicationLogItem> = {},
): ApplicationLogItem {
  return {
    id: `${sourceProduct.id}-item`,
    application_log_id: 'log-1',
    step_order: 0,
    suggestion_step_id: null,
    inventory_product_id: sourceProduct.id,
    substituted_with_product_id: null,
    product_brand_snapshot: sourceProduct.brand,
    product_name_snapshot: sourceProduct.name,
    step_label: sourceProduct.category,
    status: ApplicationItemStatus.Applied,
    is_ad_hoc: false,
    item_source: 'recommended',
    ad_hoc_brand: null,
    ad_hoc_name: null,
    notes: null,
    substitution_reason: null,
    recommended_snapshot: {
      product_id: sourceProduct.id,
      brand: sourceProduct.brand,
      name: sourceProduct.name,
      step_label: sourceProduct.category,
    },
    applied_snapshot: {
      product_id: sourceProduct.id,
      brand: sourceProduct.brand,
      name: sourceProduct.name,
      step_label: sourceProduct.category,
    },
    applied_at: null,
    created_at: new Date('2026-06-06T20:00:00.000Z'),
    updated_at: new Date('2026-06-06T20:00:00.000Z'),
    application_log: null,
    suggestion_step: null,
    product: sourceProduct,
    substituted_with_product: null,
    generateId: jest.fn(),
    ...overrides,
  } as ApplicationLogItem;
}

function entry(
  id: string,
  entryDate: string,
  overrides: Partial<SkinJournalEntry> = {},
): SkinJournalEntry {
  return {
    id,
    user_id: 'user-1',
    entry_date: entryDate,
    time_zone: 'UTC',
    photo_object_key: null,
    photo_width: null,
    photo_height: null,
    photo_size: null,
    photo_content_type: null,
    exif_stripped: true,
    angle: 'head_on',
    concern_focus: null,
    is_pre_routine: true,
    ratings: null,
    overall_feel: null,
    sleep_band: null,
    stress_today: null,
    sun_exposure_today: null,
    sweat_exercise_today: null,
    cycle_marker: null,
    recent_change: null,
    reaction_report: null,
    complaint_note: null,
    analysis_status: 'completed',
    analysis_observations: null,
    analysis_interpretation: null,
    analysis_feedback_submitted: false,
    analysis_feedback_submitted_at: null,
    analysis_feedback_interpretation_version: null,
    analysis_concern_keys: [],
    has_reaction_signal: false,
    needs_retake: false,
    analysis_summary: null,
    analysis_model: null,
    analysis_version: null,
    analysis_prompt_version: null,
    analysis_error: null,
    analysis_error_code: null,
    analysis_started_at: null,
    analysis_completed_at: null,
    analysis_duration_ms: null,
    analysis_input_image_count: null,
    analysis_input_tokens: null,
    analysis_output_tokens: null,
    analysis_total_tokens: null,
    analysis_estimated_cost_usd: null,
    analysis_retry_count: 0,
    created_at: new Date(`${entryDate}T08:00:00.000Z`),
    updated_at: new Date(`${entryDate}T08:00:00.000Z`),
    user: null,
    generateId: jest.fn(),
    ...overrides,
  } as SkinJournalEntry;
}

function reactionReport(
  overrides: Partial<ReactionReportPayload> = {},
): ReactionReportPayload {
  return {
    symptoms: ['burning'],
    severity: 'mild',
    onset: 'today',
    locations: [],
    suspected_trigger: 'unknown',
    red_flags: [],
    ...overrides,
  };
}

function observations(
  overrides: Partial<AnalysisObservations> = {},
): AnalysisObservations {
  return {
    schema_version: 'skin_journal_analysis_v1',
    summary: 'Summary',
    overall: {
      quality: 'good',
      trend: 'stable',
      confidence: 0.8,
    },
    readings: {},
    reaction_signals: {
      reaction_detected: false,
      reaction_severity: 'none',
      indicators: [],
      confidence: 0,
    },
    barrier_signs: {
      barrier_compromise: false,
      indicators: [],
    },
    safety_flags: {
      urgent_review_recommended: false,
      doctor_follow_up_recommended: false,
      reasons: [],
    },
    ...overrides,
  } as AnalysisObservations;
}

function simplification(
  id: string,
  startedAt: string,
): RoutineSimplificationEvent {
  return {
    id,
    user_id: 'user-1',
    triggered_by_event_id: null,
    started_at: new Date(startedAt),
    ended_at: null,
    original_schedule_snapshot: null,
    simplification_mode: 'barrier_repair',
    reason: 'Reaction recovery',
    acknowledged_at: null,
    restore_strategy: 'phased',
    triggered_by_event: null,
    generateId: jest.fn(),
  };
}

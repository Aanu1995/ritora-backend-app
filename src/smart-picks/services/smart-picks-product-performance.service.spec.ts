import { ApplicationItemStatus } from '../../application-tracking/application-tracking.constants';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { ApplicationLogItem } from '../../application-tracking/entities/application-log-item.entity';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ProductCategory, ShelfStatus } from '../../shelf/shelf.types';
import {
  AnalysisObservations,
  AnalysisStatusValue,
} from '../../skin-journal/skin-journal.constants';
import { SkinJournalEntry } from '../../skin-journal/entities/skin-journal-entry.entity';
import { SmartPicksProductPerformanceSignal } from '../smart-picks.types';
import {
  SmartPicksProductPerformanceService,
  summarizeSmartPicksProductPerformance,
  summarizeSmartPicksSkinJournal,
} from './smart-picks-product-performance.service';

describe('summarizeSmartPicksProductPerformance', () => {
  it('flags a consistently used treatment as replacement-ready when photo history shows no goal progress', () => {
    const summary = summarizeSmartPicksProductPerformance({
      products: [product('serum-1', ProductCategory.Serum)],
      applicationLogs: logsForProduct('serum-1', [
        '2026-02-20',
        '2026-02-23',
        '2026-02-26',
        '2026-03-02',
        '2026-03-05',
        '2026-03-09',
        '2026-03-12',
        '2026-03-16',
        '2026-03-19',
        '2026-03-23',
        '2026-03-26',
        '2026-03-30',
        '2026-04-02',
        '2026-04-06',
        '2026-04-09',
        '2026-04-13',
        '2026-04-16',
        '2026-04-20',
        '2026-04-23',
        '2026-04-27',
        '2026-04-30',
        '2026-05-04',
        '2026-05-07',
        '2026-05-10',
      ]),
      journalEntries: [
        journalEntry('2026-02-12', concern('hyperpigmentation', 'severe')),
        journalEntry('2026-03-12', concern('hyperpigmentation', 'severe')),
        journalEntry('2026-04-12', concern('hyperpigmentation', 'severe')),
        journalEntry('2026-05-10', concern('hyperpigmentation', 'severe'), {
          angleCount: 3,
        }),
      ],
      primaryGoal: 'fade dark marks',
      referenceDate: new Date('2026-05-12T09:00:00.000Z'),
    });

    expect(summary).toHaveLength(1);
    expect(summary[0]).toEqual(
      expect.objectContaining({
        productId: 'serum-1',
        usageDaysLast30: 9,
        usageDaysLast90: 24,
        goalTrend: SmartPicksProductPerformanceSignal.NotImproving,
        concernTrend: 'hyperpigmentation',
        photoCheckpoints: 3,
        photoInputImages: 6,
        multiAnglePhotoCheckpoints: 1,
        replacementCandidate: true,
      }),
    );
    expect(summary[0].replacementReason).toContain('24 logged use days');
    expect(summary[0].replacementReason).toContain('photo history still shows');
  });

  it('does not recommend replacing a product when usage and photo history are too sparse', () => {
    const summary = summarizeSmartPicksProductPerformance({
      products: [product('serum-1', ProductCategory.Serum)],
      applicationLogs: logsForProduct('serum-1', ['2026-05-01', '2026-05-08']),
      journalEntries: [
        journalEntry('2026-05-10', concern('hyperpigmentation', 'moderate')),
      ],
      primaryGoal: 'fade dark marks',
      referenceDate: new Date('2026-05-12T09:00:00.000Z'),
    });

    expect(summary[0]).toEqual(
      expect.objectContaining({
        goalTrend: SmartPicksProductPerformanceSignal.InsufficientHistory,
        replacementCandidate: false,
        replacementReason: null,
      }),
    );
  });

  it('does not treat poor-quality photo history as replacement evidence', () => {
    const summary = summarizeSmartPicksProductPerformance({
      products: [product('serum-1', ProductCategory.Serum)],
      applicationLogs: logsForProduct('serum-1', [
        '2026-02-20',
        '2026-02-23',
        '2026-02-26',
        '2026-03-02',
        '2026-03-05',
        '2026-03-09',
        '2026-03-12',
        '2026-03-16',
        '2026-03-19',
        '2026-03-23',
        '2026-03-26',
        '2026-03-30',
        '2026-04-02',
        '2026-04-06',
        '2026-04-09',
        '2026-04-13',
        '2026-04-16',
        '2026-04-20',
        '2026-04-23',
        '2026-04-27',
        '2026-04-30',
        '2026-05-04',
        '2026-05-07',
        '2026-05-10',
      ]),
      journalEntries: [
        journalEntry('2026-02-12', concern('hyperpigmentation', 'severe'), {
          needsRetake: true,
        }),
        journalEntry('2026-03-12', concern('hyperpigmentation', 'severe'), {
          lightingQuality: 'poor',
        }),
        journalEntry('2026-04-12', concern('hyperpigmentation', 'severe'), {
          faceDetected: false,
        }),
        journalEntry('2026-05-10', concern('hyperpigmentation', 'severe'), {
          needsRetake: true,
        }),
      ],
      primaryGoal: 'fade dark marks',
      referenceDate: new Date('2026-05-12T09:00:00.000Z'),
    });

    expect(summary[0]).toEqual(
      expect.objectContaining({
        goalTrend: SmartPicksProductPerformanceSignal.InsufficientHistory,
        photoCheckpoints: 0,
        replacementCandidate: false,
        replacementReason: null,
      }),
    );
  });

  it('flags irritation-aware replacements when reaction signals cluster near logged use', () => {
    const summary = summarizeSmartPicksProductPerformance({
      products: [product('exfoliant-1', ProductCategory.Exfoliant)],
      applicationLogs: logsForProduct('exfoliant-1', [
        '2026-04-28',
        '2026-05-02',
        '2026-05-06',
        '2026-05-10',
      ]),
      journalEntries: [
        journalEntry(
          '2026-05-03',
          concern('redness_inflammation', 'moderate'),
          {
            reactionDetected: true,
          },
        ),
        journalEntry(
          '2026-05-11',
          concern('redness_inflammation', 'moderate'),
          {
            reactionDetected: true,
          },
        ),
      ],
      primaryGoal: 'smooth texture',
      referenceDate: new Date('2026-05-12T09:00:00.000Z'),
    });

    expect(summary[0]).toEqual(
      expect.objectContaining({
        goalTrend: SmartPicksProductPerformanceSignal.IrritationSignal,
        reactionSignalCount: 2,
        replacementCandidate: true,
      }),
    );
    expect(summary[0].replacementReason).toContain('reaction signals');
  });

  it('treats clear improvement in recent photo history as working, not replacement-ready', () => {
    const summary = summarizeSmartPicksProductPerformance({
      products: [product('serum-1', ProductCategory.Serum)],
      applicationLogs: logsForProduct('serum-1', consistentUsageDates()),
      journalEntries: [
        journalEntry('2026-02-12', concern('hyperpigmentation', 'severe')),
        journalEntry('2026-03-18', concern('hyperpigmentation', 'moderate')),
        journalEntry(
          '2026-05-10',
          concern('hyperpigmentation', 'mild', 'improved'),
        ),
      ],
      primaryGoal: 'fade dark marks',
      referenceDate: new Date('2026-05-12T09:00:00.000Z'),
    });

    expect(summary[0]).toEqual(
      expect.objectContaining({
        goalTrend: SmartPicksProductPerformanceSignal.Working,
        replacementCandidate: false,
      }),
    );
  });

  it('uses overall worsening when the matching concern has no direct change signal', () => {
    const summary = summarizeSmartPicksProductPerformance({
      products: [product('serum-1', ProductCategory.Serum)],
      applicationLogs: logsForProduct('serum-1', consistentUsageDates()),
      journalEntries: [
        journalEntry('2026-02-12', concern('acne', 'mild')),
        journalEntry('2026-03-18', concern('acne', 'mild')),
        journalEntry('2026-05-10', concern('acne', 'mild'), {
          overallChange: 'worsened',
        }),
      ],
      primaryGoal: 'calm breakouts',
      referenceDate: new Date('2026-05-12T09:00:00.000Z'),
    });

    expect(summary[0]).toEqual(
      expect.objectContaining({
        goalTrend: SmartPicksProductPerformanceSignal.NotImproving,
        replacementCandidate: true,
      }),
    );
  });

  it('does not replace non-treatment basics just because a photo trend is flat', () => {
    const summary = summarizeSmartPicksProductPerformance({
      products: [product('cleanser-1', ProductCategory.Cleanser)],
      applicationLogs: logsForProduct('cleanser-1', [
        '2026-02-20',
        '2026-02-23',
        '2026-02-26',
        '2026-03-02',
        '2026-03-05',
        '2026-03-09',
        '2026-03-12',
        '2026-03-16',
        '2026-03-19',
        '2026-03-23',
        '2026-03-26',
        '2026-03-30',
        '2026-04-02',
        '2026-04-06',
        '2026-04-09',
        '2026-04-13',
        '2026-04-16',
        '2026-04-20',
        '2026-04-23',
        '2026-04-27',
        '2026-04-30',
        '2026-05-04',
        '2026-05-07',
        '2026-05-10',
      ]),
      journalEntries: [
        journalEntry('2026-02-12', concern('acne', 'moderate')),
        journalEntry('2026-03-12', concern('acne', 'moderate')),
        journalEntry('2026-05-10', concern('acne', 'moderate')),
      ],
      primaryGoal: 'calm breakouts',
      referenceDate: new Date('2026-05-12T09:00:00.000Z'),
    });

    expect(summary[0]).toEqual(
      expect.objectContaining({
        goalTrend: SmartPicksProductPerformanceSignal.NotImproving,
        replacementCandidate: false,
      }),
    );
  });

  it('counts substituted product use but ignores skipped application items', () => {
    const summary = summarizeSmartPicksProductPerformance({
      products: [product('serum-1', ProductCategory.Serum)],
      applicationLogs: [
        applicationLog('2026-05-01', {
          status: ApplicationItemStatus.Substituted,
          inventoryProductId: 'other-product',
          substitutedWithProductId: 'serum-1',
        }),
        applicationLog('2026-05-02', {
          status: ApplicationItemStatus.Skipped,
          inventoryProductId: 'serum-1',
        }),
      ],
      journalEntries: [],
      primaryGoal: 'fade dark marks',
      referenceDate: new Date('2026-05-12T09:00:00.000Z'),
    });

    expect(summary[0]).toEqual(
      expect.objectContaining({
        usageDaysLast90: 1,
        firstUsedAt: '2026-05-01',
        lastUsedAt: '2026-05-01',
      }),
    );
  });

  it('deduplicates duplicate per-angle quality rows before counting photo inputs', () => {
    const duplicateAngleEntry = journalEntry(
      '2026-05-10',
      concern('hyperpigmentation', 'moderate'),
    );
    duplicateAngleEntry.analysis_observations = {
      ...duplicateAngleEntry.analysis_observations,
      per_angle_quality: [
        { angle: 'head_on' },
        { angle: 'head_on' },
        { angle: 'left_profile' },
      ],
    } as AnalysisObservations;

    const summary = summarizeSmartPicksProductPerformance({
      products: [product('serum-1', ProductCategory.Serum)],
      applicationLogs: logsForProduct('serum-1', ['2026-05-01']),
      journalEntries: [duplicateAngleEntry],
      primaryGoal: 'fade dark marks',
      referenceDate: new Date('2026-05-12T09:00:00.000Z'),
    });

    expect(summary[0]).toEqual(
      expect.objectContaining({
        photoInputImages: 2,
        multiAnglePhotoCheckpoints: 1,
      }),
    );
  });
});

describe('summarizeSmartPicksSkinJournal', () => {
  it('summarizes completed upgraded journal analysis even when there are no shelf products', () => {
    const summary = summarizeSmartPicksSkinJournal({
      journalEntries: [
        journalEntry('2026-03-10', concern('hyperpigmentation', 'moderate')),
        journalEntry('2026-04-12', concern('hyperpigmentation', 'moderate'), {
          angleCount: 3,
        }),
        journalEntry('2026-05-10', concern('hyperpigmentation', 'severe'), {
          userVisibleMessage: 'Dark marks still look visible this week.',
          overallChange: 'worsened',
        }),
      ],
      primaryGoal: 'fade dark marks',
      referenceDate: new Date('2026-05-12T09:00:00.000Z'),
    });

    expect(summary).toEqual(
      expect.objectContaining({
        entryCountLast90: 3,
        usableAnalysisEntryCount: 3,
        latestEntryDate: '2026-05-10',
        latestSummary: 'Dark marks still look visible this week.',
        overallChangeFromPrevious: 'worsened',
        trendSignal: SmartPicksProductPerformanceSignal.NotImproving,
        concernTrend: 'hyperpigmentation',
        photoInputImages: 5,
        multiAnglePhotoCheckpoints: 1,
      }),
    );
    expect(summary?.topConcerns[0]).toEqual(
      expect.objectContaining({
        concern: 'hyperpigmentation',
        severity: 'severe',
      }),
    );
  });

  it('carries journal safety signals into Smart Picks without raw photos', () => {
    const summary = summarizeSmartPicksSkinJournal({
      journalEntries: [
        journalEntry('2026-05-08', concern('redness_inflammation', 'severe'), {
          reactionDetected: true,
          barrierCompromise: true,
          doctorFollowUpRecommended: true,
        }),
      ],
      primaryGoal: 'calm redness',
      referenceDate: new Date('2026-05-12T09:00:00.000Z'),
    });

    expect(summary).toEqual(
      expect.objectContaining({
        reactionSignalCount: 1,
        barrierCompromiseCount: 1,
        doctorFollowUpRecommended: true,
      }),
    );
  });
});

describe('SmartPicksProductPerformanceService', () => {
  it('does not read history repositories when there are no products', async () => {
    const applicationLogs = { find: jest.fn(), findOne: jest.fn() };
    const journalEntries = { find: jest.fn(), findOne: jest.fn() };
    const service = new SmartPicksProductPerformanceService(
      applicationLogs as unknown as ConstructorParameters<
        typeof SmartPicksProductPerformanceService
      >[0],
      journalEntries as unknown as ConstructorParameters<
        typeof SmartPicksProductPerformanceService
      >[1],
    );

    await expect(
      service.summarizeForUser({
        userId: 'user-1',
        products: [],
        primaryGoal: 'fade dark marks',
      }),
    ).resolves.toEqual([]);
    expect(applicationLogs.find).not.toHaveBeenCalled();
    expect(journalEntries.find).not.toHaveBeenCalled();
    expect(applicationLogs.findOne).not.toHaveBeenCalled();
    expect(journalEntries.findOne).not.toHaveBeenCalled();
  });

  it('still reads journal analysis summaries for no-product Smart Picks users', async () => {
    const applicationLogs = { find: jest.fn(), findOne: jest.fn() };
    const journalEntries = {
      findOne: jest.fn().mockResolvedValue({ entry_date: '2026-05-10' }),
      find: jest
        .fn()
        .mockResolvedValue([
          journalEntry('2026-05-10', concern('hyperpigmentation', 'moderate')),
        ]),
    };
    const service = new SmartPicksProductPerformanceService(
      applicationLogs as unknown as ConstructorParameters<
        typeof SmartPicksProductPerformanceService
      >[0],
      journalEntries as unknown as ConstructorParameters<
        typeof SmartPicksProductPerformanceService
      >[1],
    );

    const summary = await service.summarizeJournalForUser({
      userId: 'user-1',
      primaryGoal: 'fade dark marks',
    });

    expect(summary).toEqual(
      expect.objectContaining({
        entryCountLast90: 1,
        latestEntryDate: '2026-05-10',
        topConcerns: [
          expect.objectContaining({ concern: 'hyperpigmentation' }),
        ],
      }),
    );
    expect(applicationLogs.find).not.toHaveBeenCalled();
    expect(journalEntries.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: 'user-1',
          analysis_status: AnalysisStatusValue.Completed,
        }),
      }),
    );
  });

  it('anchors relative history windows to the latest user log or photo event', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-30T09:00:00.000Z'));
    const applicationLogs = {
      findOne: jest.fn().mockResolvedValue({
        target_date: '2026-05-10',
      }),
      find: jest
        .fn()
        .mockResolvedValue(
          logsForProduct('serum-1', ['2026-04-10', '2026-05-10']),
        ),
    };
    const journalEntries = {
      findOne: jest.fn().mockResolvedValue({
        entry_date: '2026-05-08',
      }),
      find: jest.fn().mockResolvedValue([]),
    };
    const service = new SmartPicksProductPerformanceService(
      applicationLogs as unknown as ConstructorParameters<
        typeof SmartPicksProductPerformanceService
      >[0],
      journalEntries as unknown as ConstructorParameters<
        typeof SmartPicksProductPerformanceService
      >[1],
    );

    const summary = await service.summarizeForUser({
      userId: 'user-1',
      products: [product('serum-1', ProductCategory.Serum)],
      primaryGoal: 'fade dark marks',
    });

    expect(summary[0]).toEqual(
      expect.objectContaining({
        usageDaysLast30: 2,
        usageDaysLast90: 2,
        firstUsedAt: '2026-04-10',
        lastUsedAt: '2026-05-10',
      }),
    );
    expect(applicationLogs.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: 'user-1' },
        order: { target_date: 'DESC' },
      }),
    );
    expect(journalEntries.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          user_id: 'user-1',
          analysis_status: AnalysisStatusValue.Completed,
        },
        order: { entry_date: 'DESC' },
      }),
    );
    jest.useRealTimers();
  });

  it('fails closed when history repositories are unavailable', async () => {
    const service = new SmartPicksProductPerformanceService(
      {
        find: jest.fn().mockRejectedValue(new Error('history table missing')),
        findOne: jest
          .fn()
          .mockRejectedValue(new Error('history table missing')),
      } as unknown as ConstructorParameters<
        typeof SmartPicksProductPerformanceService
      >[0],
      {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
      } as unknown as ConstructorParameters<
        typeof SmartPicksProductPerformanceService
      >[1],
    );

    await expect(
      service.summarizeForUser({
        userId: 'user-1',
        products: [product('serum-1', ProductCategory.Serum)],
        primaryGoal: 'fade dark marks',
      }),
    ).resolves.toEqual([]);
  });
});

function product(id: string, category: ProductCategory): InventoryProduct {
  return {
    id,
    user_id: 'user-1',
    brand: 'Current Brand',
    name: id === 'serum-1' ? 'Brightening Serum' : 'Strong Exfoliant',
    category,
    status: ShelfStatus.Active,
    identity: { inciIngredients: ['Water'], benefits: [] },
  } as unknown as InventoryProduct;
}

function logsForProduct(productId: string, dates: string[]): ApplicationLog[] {
  return dates.map((date, index) => ({
    id: `log-${index}`,
    user_id: 'user-1',
    target_date: date,
    items: [
      {
        id: `item-${index}`,
        inventory_product_id: productId,
        substituted_with_product_id: null,
        status: ApplicationItemStatus.Applied,
      } as ApplicationLogItem,
    ],
  })) as ApplicationLog[];
}

function consistentUsageDates(): string[] {
  return [
    '2026-02-20',
    '2026-02-23',
    '2026-02-26',
    '2026-03-02',
    '2026-03-05',
    '2026-03-09',
    '2026-03-12',
    '2026-03-16',
    '2026-03-19',
    '2026-03-23',
    '2026-03-26',
    '2026-03-30',
    '2026-04-02',
    '2026-04-06',
    '2026-04-09',
    '2026-04-13',
    '2026-04-16',
    '2026-04-20',
    '2026-04-23',
    '2026-04-27',
    '2026-04-30',
    '2026-05-04',
    '2026-05-07',
    '2026-05-10',
  ];
}

function journalEntry(
  date: string,
  detectedConcern: AnalysisObservations['detected_concerns'][number],
  options: {
    reactionDetected?: boolean;
    needsRetake?: boolean;
    lightingQuality?: AnalysisObservations['image_quality']['lighting_quality'];
    faceDetected?: boolean;
    overallChange?: AnalysisObservations['overall_change_from_previous'];
    angleCount?: number;
    barrierCompromise?: boolean;
    doctorFollowUpRecommended?: boolean;
    userVisibleMessage?: string;
  } = {},
): SkinJournalEntry {
  const reactionDetected = options.reactionDetected ?? false;
  const perAngleQuality =
    options.angleCount && options.angleCount > 1
      ? ['head_on', 'left_profile', 'right_profile']
          .slice(0, options.angleCount)
          .map((angle) => ({
            angle,
            face_detected: true,
            lighting_quality: 'good',
            framing_quality: 'good',
            blur_detected: false,
            issues: [],
            used_for_analysis: true,
          }))
      : undefined;
  return {
    id: `journal-${date}`,
    user_id: 'user-1',
    entry_date: date,
    analysis_status: AnalysisStatusValue.Completed,
    has_reaction_signal: reactionDetected,
    analysis_observations: {
      schema_version: '1.1',
      model_version: 'test',
      image_quality: {
        face_detected: options.faceDetected ?? true,
        lighting_quality: options.lightingQuality ?? 'good',
        framing_quality: 'good',
        blur_detected: false,
        issues: [],
        quality_score: 0.9,
        needs_retake: options.needsRetake ?? false,
      },
      per_angle_quality: perAngleQuality,
      detected_concerns: [detectedConcern],
      reaction_signals: {
        reaction_detected: reactionDetected,
        reaction_severity: reactionDetected ? 'moderate' : 'none',
        indicators: reactionDetected ? ['redness'] : [],
        confidence: reactionDetected ? 0.84 : 0.2,
      },
      barrier_signs: {
        barrier_compromise: options.barrierCompromise ?? false,
        indicators: options.barrierCompromise ? ['flaking'] : [],
      },
      overall_assessment: 'Stable.',
      overall_change_from_previous: options.overallChange ?? 'stable',
      user_visible_message: options.userVisibleMessage,
      safety_flags: {
        urgent_review_recommended: false,
        doctor_follow_up_recommended:
          options.doctorFollowUpRecommended ?? false,
        reasons: [],
      },
      should_flag_for_doctor: options.doctorFollowUpRecommended ?? false,
    },
  } as unknown as SkinJournalEntry;
}

function concern(
  concernName: AnalysisObservations['detected_concerns'][number]['concern'],
  severity: AnalysisObservations['detected_concerns'][number]['severity'],
  change: AnalysisObservations['detected_concerns'][number]['change_from_previous'] = 'stable',
): AnalysisObservations['detected_concerns'][number] {
  return {
    concern: concernName,
    severity,
    locations: ['cheeks'],
    confidence: 0.86,
    change_from_previous: change,
    change_confidence: 0.82,
  };
}

function applicationLog(
  date: string,
  item: {
    status: ApplicationItemStatus;
    inventoryProductId: string | null;
    substitutedWithProductId?: string | null;
  },
): ApplicationLog {
  return {
    id: `log-${date}`,
    user_id: 'user-1',
    target_date: date,
    items: [
      {
        id: `item-${date}`,
        inventory_product_id: item.inventoryProductId,
        substituted_with_product_id: item.substitutedWithProductId ?? null,
        status: item.status,
        applied_snapshot: null,
      } as ApplicationLogItem,
    ],
  } as ApplicationLog;
}

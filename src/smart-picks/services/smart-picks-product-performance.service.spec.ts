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
        journalEntry('2026-05-10', concern('hyperpigmentation', 'severe')),
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
});

describe('SmartPicksProductPerformanceService', () => {
  it('fails closed when history repositories are unavailable', async () => {
    const service = new SmartPicksProductPerformanceService(
      {
        find: jest.fn().mockRejectedValue(new Error('history table missing')),
      } as unknown as ConstructorParameters<
        typeof SmartPicksProductPerformanceService
      >[0],
      {
        find: jest.fn(),
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

function journalEntry(
  date: string,
  detectedConcern: AnalysisObservations['detected_concerns'][number],
  options: {
    reactionDetected?: boolean;
    needsRetake?: boolean;
    lightingQuality?: AnalysisObservations['image_quality']['lighting_quality'];
    faceDetected?: boolean;
  } = {},
): SkinJournalEntry {
  const reactionDetected = options.reactionDetected ?? false;
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
      detected_concerns: [detectedConcern],
      reaction_signals: {
        reaction_detected: reactionDetected,
        reaction_severity: reactionDetected ? 'moderate' : 'none',
        indicators: reactionDetected ? ['redness'] : [],
        confidence: reactionDetected ? 0.84 : 0.2,
      },
      barrier_signs: {
        barrier_compromise: false,
        indicators: [],
      },
      overall_assessment: 'Stable.',
      overall_change_from_previous: 'stable',
      should_flag_for_doctor: false,
    },
  } as unknown as SkinJournalEntry;
}

function concern(
  concernName: AnalysisObservations['detected_concerns'][number]['concern'],
  severity: AnalysisObservations['detected_concerns'][number]['severity'],
): AnalysisObservations['detected_concerns'][number] {
  return {
    concern: concernName,
    severity,
    locations: ['cheeks'],
    confidence: 0.86,
    change_from_previous: 'stable',
    change_confidence: 0.82,
  };
}

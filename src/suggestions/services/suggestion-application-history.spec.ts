import {
  ApplicationItemSource,
  ApplicationItemStatus,
} from '../../application-tracking/application-tracking.constants';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { ApplicationLogItem } from '../../application-tracking/entities/application-log-item.entity';
import {
  buildAppliedProductHistory,
  buildApplicationProductSignals,
  isReactionRelatedSkipReason,
} from './suggestion-application-history';

describe('suggestion application history', () => {
  it('summarizes applied and substituted products without counting skipped recommendations as applied', () => {
    const history = buildAppliedProductHistory(
      [
        applicationLog('2026-05-04', [
          applicationItem({
            productId: 'cleanser-1',
            status: ApplicationItemStatus.Applied,
          }),
          applicationItem({
            productId: 'retinoid-1',
            status: ApplicationItemStatus.Skipped,
          }),
          applicationItem({
            productId: 'moisturizer-1',
            substitutedWithProductId: 'spf-1',
            status: ApplicationItemStatus.Substituted,
            source: ApplicationItemSource.Recommended,
          }),
        ]),
      ],
      '2026-05-04',
    );

    expect(history.recordsConsidered).toBe(1);
    expect(history.products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: 'cleanser-1',
          statuses: [ApplicationItemStatus.Applied],
          useCount: 1,
        }),
        expect.objectContaining({
          productId: 'spf-1',
          statuses: [ApplicationItemStatus.Substituted],
          useCount: 1,
          isSubstitution: true,
        }),
      ]),
    );
    expect(history.products).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productId: 'retinoid-1',
        }),
      ]),
    );
  });

  it('does not turn a plain skipped product into a reaction skip signal', () => {
    const signals = buildApplicationProductSignals(
      [
        applicationLog('2026-05-04', [
          applicationItem({
            productId: 'spf-1',
            status: ApplicationItemStatus.Skipped,
            notes: 'Stayed indoors today, no daylight exposure.',
          }),
        ]),
      ],
      '2026-05-04',
    );

    expect(signals.get('spf-1')?.reactionSkipCount ?? 0).toBe(0);
  });

  it('uses recent reaction or intolerance skip notes as a temporary pause signal', () => {
    const signals = buildApplicationProductSignals(
      [
        applicationLog('2026-05-03', [
          applicationItem({
            productId: 'serum-1',
            status: ApplicationItemStatus.Skipped,
            notes: 'Skipped because it stung and caused redness.',
          }),
        ]),
      ],
      '2026-05-05',
    );

    expect(signals.get('serum-1')?.reactionSkipCount).toBe(1);
  });

  it('lets reaction skip pauses expire after a few days', () => {
    const signals = buildApplicationProductSignals(
      [
        applicationLog('2026-05-01', [
          applicationItem({
            productId: 'serum-1',
            status: ApplicationItemStatus.Skipped,
            notes: 'Skipped because it stung and caused redness.',
          }),
        ]),
      ],
      '2026-05-05',
    );

    expect(signals.get('serum-1')?.reactionSkipCount ?? 0).toBe(0);
  });

  it('recognizes Swedish reaction wording in skip notes', () => {
    expect(isReactionRelatedSkipReason('Jag pausade den pga sveda.')).toBe(
      true,
    );
    expect(isReactionRelatedSkipReason('Var hemma hela dagen.')).toBe(false);
  });
});

function applicationLog(
  targetDate: string,
  items: ApplicationLogItem[],
  generalNotes: string | null = null,
): ApplicationLog {
  return {
    id: `log-${targetDate}`,
    target_date: targetDate,
    daypart: 'morning',
    applied_at: new Date(`${targetDate}T08:00:00.000Z`),
    updated_at: new Date(`${targetDate}T08:05:00.000Z`),
    general_notes: generalNotes,
    items,
  } as unknown as ApplicationLog;
}

function applicationItem(input: {
  productId: string;
  substitutedWithProductId?: string;
  status: ApplicationItemStatus;
  source?: ApplicationItemSource;
  notes?: string;
}): ApplicationLogItem {
  return {
    id: `item-${input.productId}`,
    inventory_product_id: input.productId,
    substituted_with_product_id: input.substitutedWithProductId ?? null,
    status: input.status,
    item_source: input.source ?? ApplicationItemSource.Recommended,
    step_label: 'serum',
    notes: input.notes ?? null,
    applied_at: new Date('2026-05-04T08:00:00.000Z'),
    recommended_snapshot: {
      product_id: input.productId,
      brand: 'Eval',
      name: input.productId,
      step_label: 'serum',
    },
    applied_snapshot: input.substitutedWithProductId
      ? {
          product_id: input.substitutedWithProductId,
          brand: 'Eval',
          name: input.substitutedWithProductId,
          step_label: 'serum',
        }
      : null,
  } as unknown as ApplicationLogItem;
}

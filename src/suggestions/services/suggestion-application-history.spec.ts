import {
  ApplicationItemSource,
  ApplicationItemStatus,
} from '../../application-tracking/application-tracking.constants';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { ApplicationLogItem } from '../../application-tracking/entities/application-log-item.entity';
import { buildAppliedProductHistory } from './suggestion-application-history';

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
});

function applicationLog(
  targetDate: string,
  items: ApplicationLogItem[],
): ApplicationLog {
  return {
    id: `log-${targetDate}`,
    target_date: targetDate,
    daypart: 'morning',
    applied_at: new Date(`${targetDate}T08:00:00.000Z`),
    updated_at: new Date(`${targetDate}T08:05:00.000Z`),
    items,
  } as unknown as ApplicationLog;
}

function applicationItem(input: {
  productId: string;
  substitutedWithProductId?: string;
  status: ApplicationItemStatus;
  source?: ApplicationItemSource;
}): ApplicationLogItem {
  return {
    id: `item-${input.productId}`,
    inventory_product_id: input.productId,
    substituted_with_product_id: input.substitutedWithProductId ?? null,
    status: input.status,
    item_source: input.source ?? ApplicationItemSource.Recommended,
    step_label: 'serum',
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

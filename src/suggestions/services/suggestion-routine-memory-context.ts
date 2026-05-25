import { toDateOnlyString, toTimeOnlyString } from '../../common/utils/date';
import {
  ApplicationItemSource,
  ApplicationItemStatus,
} from '../../application-tracking/application-tracking.constants';
import { ApplicationLog } from '../../application-tracking/entities/application-log.entity';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { SuggestionContextSummary } from '../suggestion-context.types';
import { SuggestionDaypart } from '../suggestions.constants';
import { increment, unique } from './suggestion-context-common';
import {
  applicationProductKey,
  resolveAppliedProduct,
  resolveRecommendedProduct,
} from './suggestion-application-history';

export function buildRoutineMemory(
  logs: ApplicationLog[],
  suggestions: SuggestionInstance[],
  daypart: SuggestionDaypart,
): NonNullable<SuggestionContextSummary['routineMemory']> {
  const sortedSuggestions = suggestions.slice().sort(compareSuggestionRecency);
  const suggestionFingerprints = sortedSuggestions
    .map(buildSuggestionFingerprint)
    .filter((fingerprint) => fingerprint.fingerprint.length > 0);
  const sameDaypartFingerprints = sortedSuggestions
    .filter((suggestion) => suggestion.daypart === daypart)
    .map(buildSuggestionFingerprint)
    .filter((fingerprint) => fingerprint.fingerprint.length > 0);
  const exactRepeatCountByFingerprint: Record<string, number> = {};
  const recentlySuggestedProductIds: string[] = [];
  const skippedProducts: Record<string, number> = {};
  const substitutedProducts: Record<string, number> = {};
  const adheredProducts: Record<string, number> = {};
  let editedLogCount = 0;
  let offShelfUseCount = 0;

  for (const fingerprint of suggestionFingerprints) {
    increment(exactRepeatCountByFingerprint, fingerprint.fingerprint);
    for (const productId of fingerprint.productIds) {
      recentlySuggestedProductIds.push(productId);
    }
  }

  for (const log of logs) {
    if (log.has_been_edited) editedLogCount += 1;
    for (const item of log.items ?? []) {
      const recommended = resolveRecommendedProduct(item);
      const applied = resolveAppliedProduct(item);
      if (
        item.is_ad_hoc ||
        item.item_source === ApplicationItemSource.AddedOffShelf ||
        (applied && applied.isOffShelf)
      ) {
        offShelfUseCount += 1;
      }
      if (item.status === ApplicationItemStatus.Skipped && recommended) {
        increment(skippedProducts, applicationProductKey(recommended));
      }
      if (item.status === ApplicationItemStatus.Substituted && applied) {
        increment(substitutedProducts, applicationProductKey(applied));
      }
      if (
        (item.status === ApplicationItemStatus.Applied ||
          item.status === ApplicationItemStatus.Substituted) &&
        applied
      ) {
        increment(adheredProducts, applicationProductKey(applied));
      }
    }
  }

  return {
    recordsConsidered: logs.length + suggestions.length,
    previousSuggestionCount: suggestions.length,
    sameDaypartSuggestionCount: sameDaypartFingerprints.length,
    recentSameDaypartFingerprints: sameDaypartFingerprints.slice(0, 10),
    recentlySuggestedProductIds: unique(recentlySuggestedProductIds).slice(
      0,
      50,
    ),
    exactRepeatCountByFingerprint,
    skippedProducts,
    substitutedProducts,
    adheredProducts,
    editedLogCount,
    offShelfUseCount,
  };
}

function buildSuggestionFingerprint(
  suggestion: SuggestionInstance,
): NonNullable<
  SuggestionContextSummary['routineMemory']
>['recentSameDaypartFingerprints'][number] {
  const steps = (suggestion.steps ?? [])
    .slice()
    .sort((a, b) => a.step_order - b.step_order);
  const productIds = steps
    .map((step) => step.inventory_product_id ?? step.product?.id ?? null)
    .filter((productId): productId is string => Boolean(productId));
  const productNames = steps
    .map((step) => {
      const brand = step.product_brand_snapshot ?? step.product?.brand ?? null;
      const name = step.product_name_snapshot ?? step.product?.name ?? null;
      return [brand, name].filter(Boolean).join(' ').trim();
    })
    .filter(Boolean);
  const fingerprintParts = productIds.length
    ? productIds
    : productNames.map((name) => name.toLowerCase());
  return {
    targetDate: toDateOnlyString(suggestion.target_date),
    targetTime: toTimeOnlyString(suggestion.target_time),
    productIds,
    productNames,
    fingerprint: fingerprintParts.join('>'),
  };
}

function compareSuggestionRecency(
  first: SuggestionInstance,
  second: SuggestionInstance,
): number {
  const firstDate = toDateOnlyString(first.target_date);
  const secondDate = toDateOnlyString(second.target_date);
  if (firstDate !== secondDate) return firstDate < secondDate ? 1 : -1;
  const firstTime = toTimeOnlyString(first.target_time);
  const secondTime = toTimeOnlyString(second.target_time);
  if (firstTime !== secondTime) return firstTime < secondTime ? 1 : -1;
  return (
    (second.created_at?.getTime() ?? 0) - (first.created_at?.getTime() ?? 0)
  );
}

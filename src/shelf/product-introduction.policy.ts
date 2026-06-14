import { ProductIntroductionStatus } from './shelf.types';

const WEEK_ONE_DAYS = 7;
const TOLERATED_AFTER_DAYS = 28;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

type ProductIntroductionLifecycleInput = {
  status: ProductIntroductionStatus | null | undefined;
  startedAt: Date | null | undefined;
};

export type ProductIntroductionSuggestionGuidance = {
  scoreAdjustment: number;
  suitabilityReason: string | null;
  cautionReason: string | null;
  blocksSuggestions: boolean;
  blockReason: string | null;
};

const DEFAULT_SUGGESTION_GUIDANCE: ProductIntroductionSuggestionGuidance = {
  scoreAdjustment: 0,
  suitabilityReason: null,
  cautionReason: null,
  blocksSuggestions: false,
  blockReason: null,
};

const SUGGESTION_BLOCK_REASONS: Partial<
  Record<ProductIntroductionStatus, string>
> = {
  [ProductIntroductionStatus.Paused]: 'product introduction is paused',
  [ProductIntroductionStatus.Failed]:
    'product introduction failed and should not be suggested',
};

export function nextProductIntroductionStatusAfterLoggedUse(
  product: ProductIntroductionLifecycleInput,
  usageAt: Date,
): ProductIntroductionStatus | null {
  const currentStatus = product.status ?? ProductIntroductionStatus.Tolerated;
  const startedAt = product.startedAt ?? usageAt;
  const elapsedDays = fullDaysBetween(startedAt, usageAt);

  if (
    currentStatus === ProductIntroductionStatus.New ||
    currentStatus === ProductIntroductionStatus.PatchTesting
  ) {
    return ProductIntroductionStatus.Week1;
  }

  if (
    currentStatus === ProductIntroductionStatus.Week1 &&
    elapsedDays >= WEEK_ONE_DAYS
  ) {
    return ProductIntroductionStatus.BuildingTolerance;
  }

  if (
    currentStatus === ProductIntroductionStatus.BuildingTolerance &&
    elapsedDays >= TOLERATED_AFTER_DAYS
  ) {
    return ProductIntroductionStatus.Tolerated;
  }

  return null;
}

export function isProductIntroductionEligibleForSuggestions(
  status: ProductIntroductionStatus | null | undefined,
): boolean {
  const guidance = getProductIntroductionSuggestionGuidance(status);
  return !guidance.blocksSuggestions;
}

export function getProductIntroductionSuggestionGuidance(
  status: ProductIntroductionStatus | null | undefined,
): ProductIntroductionSuggestionGuidance {
  switch (status) {
    case ProductIntroductionStatus.New:
    case ProductIntroductionStatus.PatchTesting:
    case ProductIntroductionStatus.Week1:
      return {
        scoreAdjustment: -14,
        suitabilityReason: 'early product introduction',
        cautionReason:
          'introduce with low frequency while skin response is learned',
        blocksSuggestions: false,
        blockReason: null,
      };
    case ProductIntroductionStatus.BuildingTolerance:
      return {
        scoreAdjustment: -6,
        suitabilityReason: 'building product tolerance',
        cautionReason: 'increase frequency only if skin stays calm',
        blocksSuggestions: false,
        blockReason: null,
      };
    case ProductIntroductionStatus.Paused:
    case ProductIntroductionStatus.Failed:
      return {
        scoreAdjustment: -100,
        suitabilityReason: null,
        cautionReason:
          status === ProductIntroductionStatus.Paused
            ? 'product introduction is paused'
            : 'product did not work for this skin',
        blocksSuggestions: true,
        blockReason: SUGGESTION_BLOCK_REASONS[status] ?? null,
      };
    case ProductIntroductionStatus.Tolerated:
    case null:
    case undefined:
      return DEFAULT_SUGGESTION_GUIDANCE;
  }
}

function fullDaysBetween(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / DAY_IN_MS);
}

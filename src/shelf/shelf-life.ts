import {
  ShelfStatFilter,
  ShelfStatus,
  type ShelfProductSnapshot,
} from './shelf.types';
import {
  addMonths,
  diffInDaysRounded,
  nowDate,
  parseUtcDate,
} from '../common/utils/date';

export enum ShelfLifeState {
  Unopened = 'unopened',
  Fresh = 'fresh',
  Aging = 'aging',
  Expired = 'expired',
  Finished = 'finished',
  Archived = 'archived',
}

export type ShelfLifeSnapshot = {
  state: ShelfLifeState;
  remainingFraction: number | null;
  remainingDays: number | null;
};

export function computeEffectiveExpiresAt(
  snapshot: Pick<ShelfProductSnapshot, 'userFields'>,
): Date | null {
  const explicit = parseUtcDate(snapshot.userFields.expiresAt);
  if (explicit) {
    return explicit.toDate();
  }

  const opened = parseUtcDate(snapshot.userFields.openedAt);
  const pao = snapshot.userFields.periodAfterOpeningMonths;
  if (opened && pao && pao > 0) {
    return addMonths(opened, pao);
  }

  return null;
}

export function deriveShelfLife(
  snapshot: Pick<ShelfProductSnapshot, 'status' | 'userFields'>,
  now: Date = nowDate(),
): ShelfLifeSnapshot {
  if (snapshot.status === ShelfStatus.Archived) {
    return {
      state: ShelfLifeState.Archived,
      remainingFraction: null,
      remainingDays: null,
    };
  }

  if (snapshot.status === ShelfStatus.FinishedUp) {
    return {
      state: ShelfLifeState.Finished,
      remainingFraction: null,
      remainingDays: null,
    };
  }

  const opened = parseUtcDate(snapshot.userFields.openedAt);
  if (!opened) {
    return {
      state: ShelfLifeState.Unopened,
      remainingFraction: 1,
      remainingDays: null,
    };
  }

  const effectiveExpiresAt = computeEffectiveExpiresAt(snapshot);
  if (!effectiveExpiresAt) {
    return {
      state: ShelfLifeState.Fresh,
      remainingFraction: null,
      remainingDays: null,
    };
  }

  const totalDays = diffInDaysRounded(opened.toDate(), effectiveExpiresAt);
  const elapsedDays = diffInDaysRounded(opened.toDate(), now);
  const remainingDays = totalDays - elapsedDays;

  if (remainingDays <= 0) {
    return {
      state: ShelfLifeState.Expired,
      remainingFraction: 0,
      remainingDays,
    };
  }

  const remainingFraction =
    totalDays > 0 ? Math.max(0, Math.min(1, remainingDays / totalDays)) : null;

  return {
    state:
      remainingFraction !== null && remainingFraction > 0.5
        ? ShelfLifeState.Fresh
        : ShelfLifeState.Aging,
    remainingFraction,
    remainingDays,
  };
}

export function matchesInventoryStat(
  snapshot: Pick<ShelfProductSnapshot, 'status' | 'userFields'>,
  stat: ShelfStatFilter,
  now: Date = nowDate(),
): boolean {
  if (stat === ShelfStatFilter.All) {
    return snapshot.status !== ShelfStatus.Archived;
  }

  if (stat === ShelfStatFilter.Archived) {
    return snapshot.status === ShelfStatus.Archived;
  }

  if (snapshot.status === ShelfStatus.Archived) {
    return false;
  }

  const life = deriveShelfLife(snapshot, now);

  switch (stat) {
    case ShelfStatFilter.InUse:
      return (
        Boolean(snapshot.userFields.openedAt) &&
        snapshot.status === ShelfStatus.Active
      );
    case ShelfStatFilter.Unopened:
      return (
        !snapshot.userFields.openedAt && snapshot.status === ShelfStatus.Active
      );
    case ShelfStatFilter.NearingExpiry:
      return (
        life.state === ShelfLifeState.Aging ||
        life.state === ShelfLifeState.Expired
      );
    case ShelfStatFilter.Expired:
      return life.state === ShelfLifeState.Expired;
    default:
      return true;
  }
}

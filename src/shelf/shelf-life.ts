import { Temporal } from '@js-temporal/polyfill';
import {
  ShelfStatFilter,
  ShelfStatus,
  type ShelfProductSnapshot,
} from './shelf.types';
import {
  diffShelfCalendarDays,
  parseShelfPlainDate,
  resolveShelfToday,
  toShelfStoredUtcDate,
  type ShelfNowInput,
} from './shelf-date.utils';
import { DEFAULT_TIME_ZONE } from '../common/timezone/timezone.utils';

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

export type ShelfLifeOptions = {
  now?: ShelfNowInput;
  timeZone?: string;
};

function computeEffectiveExpiresPlainDate(
  snapshot: Pick<ShelfProductSnapshot, 'userFields'>,
): Temporal.PlainDate | null {
  const explicit = parseShelfPlainDate(snapshot.userFields.expiresAt);
  if (explicit) {
    return explicit;
  }

  const opened = parseShelfPlainDate(snapshot.userFields.openedAt);
  const pao = snapshot.userFields.periodAfterOpeningMonths;
  if (opened && pao && pao > 0) {
    return opened.add({ months: pao });
  }

  return null;
}

export function computeEffectiveExpiresAt(
  snapshot: Pick<ShelfProductSnapshot, 'userFields'>,
): Date | null {
  const effectiveExpiresAt = computeEffectiveExpiresPlainDate(snapshot);
  return effectiveExpiresAt ? toShelfStoredUtcDate(effectiveExpiresAt) : null;
}

export function deriveShelfLife(
  snapshot: Pick<ShelfProductSnapshot, 'status' | 'userFields'>,
  options: ShelfLifeOptions = {},
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

  const opened = parseShelfPlainDate(snapshot.userFields.openedAt);
  if (!opened) {
    return {
      state: ShelfLifeState.Unopened,
      remainingFraction: 1,
      remainingDays: null,
    };
  }

  const effectiveExpiresAt = computeEffectiveExpiresPlainDate(snapshot);
  if (!effectiveExpiresAt) {
    return {
      state: ShelfLifeState.Fresh,
      remainingFraction: null,
      remainingDays: null,
    };
  }

  const totalDays = diffShelfCalendarDays(opened, effectiveExpiresAt);
  const today = resolveShelfToday(
    options.timeZone ?? DEFAULT_TIME_ZONE,
    options.now,
  );
  const elapsedDays = Math.max(0, diffShelfCalendarDays(opened, today));
  const remainingDays = totalDays - elapsedDays;

  if (remainingDays <= 0) {
    return {
      state: ShelfLifeState.Expired,
      remainingFraction: 0,
      remainingDays,
    };
  }

  const remainingFraction =
    totalDays > 0 ? Math.max(0, Math.min(1, remainingDays / totalDays)) : 0;

  return {
    state:
      remainingFraction > 0.5 ? ShelfLifeState.Fresh : ShelfLifeState.Aging,
    remainingFraction,
    remainingDays,
  };
}

export function matchesInventoryStat(
  snapshot: Pick<ShelfProductSnapshot, 'status' | 'userFields'>,
  stat: ShelfStatFilter,
  options: ShelfLifeOptions = {},
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

  const life = deriveShelfLife(snapshot, options);

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

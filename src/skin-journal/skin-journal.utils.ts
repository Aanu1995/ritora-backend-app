import { BadRequestException } from '@nestjs/common';
import {
  canonicalizeTimeZone,
  DEFAULT_TIME_ZONE,
} from '../common/timezone/timezone.utils';
import type { WrappedPeriodKind } from './skin-journal.constants';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function todayInTimeZone(
  timeZone: string | null | undefined,
  date: Date = new Date(),
): string {
  const tz = resolveSkinJournalTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

export function resolveSkinJournalTimeZone(
  timeZone: string | null | undefined,
): string {
  return canonicalizeTimeZone(timeZone) ?? DEFAULT_TIME_ZONE;
}

export function isValidDate(input: string): boolean {
  if (!ISO_DATE.test(input)) return false;
  const [year, month, day] = input.split('-').map((part) => Number(part));
  if (!year || !month || !day) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function monthRange(month: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new BadRequestException('Invalid month format; expected YYYY-MM');
  }
  const [year, mon] = month.split('-').map((n) => parseInt(n, 10));
  if (mon < 1 || mon > 12) {
    throw new BadRequestException('Invalid month format; expected YYYY-MM');
  }
  const start = `${year}-${String(mon).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const end = `${year}-${String(mon).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function listDatesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  for (
    let d = new Date(startDate);
    d.getTime() <= endDate.getTime();
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

export function periodLabelToRange(
  periodKind: WrappedPeriodKind,
  label: string,
): { start: string; end: string; periodLabel: string } {
  if (periodKind === 'monthly') {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(label)) {
      throw new BadRequestException('Monthly label must be YYYY-MM');
    }
    const range = monthRange(label);
    return { ...range, periodLabel: label };
  }
  if (periodKind === 'quarterly') {
    if (!/^\d{4}-Q[1-4]$/.test(label)) {
      throw new BadRequestException('Quarterly label must be YYYY-Qn');
    }
    const [year, q] = label.split('-Q').map((n) => parseInt(n, 10));
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = q * 3;
    const start = `${year}-${String(startMonth).padStart(2, '0')}-01`;
    const lastDay = daysInMonth(year, endMonth);
    const end = `${year}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { start, end, periodLabel: label };
  }
  if (!/^\d{4}$/.test(label)) {
    throw new BadRequestException('Yearly label must be YYYY');
  }
  const year = parseInt(label, 10);
  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`,
    periodLabel: label,
  };
}

export const parsePeriodLabelToRangeOrThrow = periodLabelToRange;

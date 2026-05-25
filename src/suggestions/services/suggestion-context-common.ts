import { toDateOnlyString } from '../../common/utils/date';

export function daysBetween(fromDate: string, toDate: string): number {
  const from = new Date(`${toDateOnlyString(fromDate)}T00:00:00Z`).getTime();
  const to = new Date(`${toDateOnlyString(toDate)}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

export function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

export function trimForPrompt(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return compact.slice(0, maxLength - 1).trimEnd();
}

export function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

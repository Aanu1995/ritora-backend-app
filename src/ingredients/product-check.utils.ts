import type { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import type { SkinJournalEntry } from '../skin-journal/entities/skin-journal-entry.entity';
import type {
  MatchedIngredient,
  ProductForAnalysis,
} from './ingredients.types';
import {
  ProductCheckContextSignal,
  type ProductCheckContextSummary,
} from './product-check.types';

const REACTION_LOOKBACK_DAYS = 3;

export function normalizeIngredientList(values: string[]): string[] {
  return Array.from(
    new Set(
      values.map((value) => value.trim()).filter((value) => value.length > 0),
    ),
  );
}

export function ingredientOverlapRatio(
  left: string[],
  right: string[],
): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const leftSet = new Set(left.map(normalizeSignal).filter(Boolean));
  const rightSet = new Set(right.map(normalizeSignal).filter(Boolean));
  const smallerSize = Math.min(leftSet.size, rightSet.size);

  if (smallerSize === 0) {
    return 0;
  }

  let sharedCount = 0;
  for (const value of leftSet) {
    if (rightSet.has(value)) {
      sharedCount += 1;
    }
  }

  return sharedCount / smallerSize;
}

export function sharedIngredients(
  checkedProduct: ProductForAnalysis,
  shelfProduct: InventoryProduct,
): string[] {
  const shelfIngredients = normalizeIngredientList(
    shelfProduct.identity?.inciIngredients ?? [],
  );
  const shelfSet = new Set(shelfIngredients.map(normalizeSignal));

  return checkedProduct.inciIngredients.filter((ingredient) =>
    shelfSet.has(normalizeSignal(ingredient)),
  );
}

export function countReactionSignalsNearUse(
  usageDates: string[],
  journalEntries: SkinJournalEntry[],
): number {
  if (usageDates.length === 0 || journalEntries.length === 0) {
    return 0;
  }

  const usageTimes = usageDates.map((date) => isoDateToUtc(date).getTime());
  return journalEntries.filter((entry) => {
    if (!entry.has_reaction_signal) {
      return false;
    }

    const entryTime = isoDateToUtc(entry.entry_date).getTime();
    return usageTimes.some((usageTime) => {
      const daysAfterUse = Math.floor((entryTime - usageTime) / dayMs());
      return daysAfterUse >= 0 && daysAfterUse <= REACTION_LOOKBACK_DAYS;
    });
  }).length;
}

export function joinProductName(
  brand: string | null,
  name: string | null,
): string {
  return [brand, name]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(' ');
}

export function normalizeSignal(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function uniqueIngredientNames(matches: MatchedIngredient[]): string[] {
  return Array.from(
    new Set(matches.map((matched) => matched.ingredient.displayNameEn)),
  );
}

export function shiftIsoDate(referenceDate: Date, days: number): string {
  const date = isoDateToUtc(toIsoDate(referenceDate));
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

export function hasReactionContext(
  context: ProductCheckContextSummary,
): boolean {
  return context.usedSignals.some((signal) =>
    [
      ProductCheckContextSignal.SkinProfile,
      ProductCheckContextSignal.ReactionHistory,
      ProductCheckContextSignal.SkinJournal,
      ProductCheckContextSignal.SuggestionHistory,
    ].includes(signal),
  );
}

function isoDateToUtc(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dayMs(): number {
  return 24 * 60 * 60 * 1000;
}

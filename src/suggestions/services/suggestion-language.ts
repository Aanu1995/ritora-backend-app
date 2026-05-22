import { ApplicationMethod, Quantity } from '../../shelf/shelf.types';

const MAX_GUIDANCE_WORDS = 6;
const DEFAULT_TEXT_MAX_LENGTH = 180;

const APPLICATION_METHOD_LABELS: Record<ApplicationMethod, string> = {
  [ApplicationMethod.Fingertips]: 'Fingertips',
  [ApplicationMethod.CottonPad]: 'Cotton pad',
  [ApplicationMethod.Brush]: 'Brush',
  [ApplicationMethod.Spray]: 'Spray',
  [ApplicationMethod.Dropper]: 'Dropper',
  [ApplicationMethod.Spatula]: 'Spatula',
  [ApplicationMethod.Other]: 'As directed',
};

const QUANTITY_LABELS: Record<Quantity, string> = {
  [Quantity.OneDrop]: '1 drop',
  [Quantity.TwoToThreeDrops]: '2-3 drops',
  [Quantity.PeaSize]: 'Pea-size amount',
  [Quantity.PumpOne]: '1 pump',
  [Quantity.PumpTwo]: '2 pumps',
  [Quantity.CoinSize]: 'Coin-size amount',
  [Quantity.Generous]: 'Generous layer',
  [Quantity.AsNeeded]: 'As needed',
  [Quantity.Other]: 'As needed',
};

export type SuggestionTextOptions = {
  maxLength?: number;
  maxSentences?: number;
};

export function sanitizeSuggestionText(
  value: string | null | undefined,
  options: SuggestionTextOptions = {},
): string | null {
  if (!value) return value ?? null;
  const plain = applySafetyLanguage(
    value
      .replace(/[`*_>#]/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  if (!plain) return null;

  const sentenceLimited = limitSentences(plain, options.maxSentences);
  return limitLength(
    sentenceLimited,
    options.maxLength ?? DEFAULT_TEXT_MAX_LENGTH,
  );
}

export function toHumanApplicationMethod(
  value: string | null | undefined,
): string | null {
  if (!value) return value ?? null;
  if (isApplicationMethod(value)) {
    return APPLICATION_METHOD_LABELS[value];
  }
  return toShortGuidance(value, 'As directed');
}

export function toHumanQuantity(
  value: string | null | undefined,
): string | null {
  if (!value) return value ?? null;
  if (isQuantity(value)) {
    return QUANTITY_LABELS[value];
  }
  return toShortGuidance(value, 'As needed');
}

function toShortGuidance(value: string, fallback: string): string {
  const sanitized = sanitizeSuggestionText(value, {
    maxLength: 40,
    maxSentences: 1,
  });
  if (!sanitized) return fallback;
  return wordCount(value) > MAX_GUIDANCE_WORDS ||
    wordCount(sanitized) >= MAX_GUIDANCE_WORDS
    ? fallback
    : sanitized;
}

function applySafetyLanguage(value: string): string {
  return value
    .replace(/\bdiagnos(?:e|es|ed|ing|is)\b/gi, 'assess')
    .replace(/\btreat(?:s|ed|ing|ment)?\b/gi, 'care')
    .replace(/\bcure(?:s|d|ing)?\b/gi, 'resolve')
    .replace(/\bprescrib(?:e|es|ed|ing)\b/gi, 'recommend')
    .replace(/\bprescription\b/gi, 'routine');
}

function limitSentences(
  value: string,
  maxSentences: number | undefined,
): string {
  if (!maxSentences || maxSentences <= 0) return value;
  const matches = value.match(/[^.!?]+[.!?]?/g);
  if (!matches) return value;
  return matches.slice(0, maxSentences).join(' ').replace(/\s+/g, ' ').trim();
}

function limitLength(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const clipped = value.slice(0, maxLength + 1);
  const lastSpace = clipped.lastIndexOf(' ');
  const boundary =
    lastSpace >= Math.floor(maxLength * 0.65) ? lastSpace : maxLength;
  return clipped
    .slice(0, boundary)
    .replace(/[ ,;:.-]+$/g, '')
    .trim();
}

function wordCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

function isApplicationMethod(value: string): value is ApplicationMethod {
  return Object.values(ApplicationMethod).includes(value as ApplicationMethod);
}

function isQuantity(value: string): value is Quantity {
  return Object.values(Quantity).includes(value as Quantity);
}

import { ApplicationMethod, Quantity } from '../../shelf/shelf.types';
import {
  DEFAULT_LANGUAGE,
  normalizeLanguage,
  type AppLanguage,
} from '../../common/i18n/i18n';

const MAX_GUIDANCE_WORDS = 6;
const DEFAULT_TEXT_MAX_LENGTH = 180;

const APPLICATION_METHOD_LABELS: Record<
  AppLanguage,
  Record<ApplicationMethod, string>
> = {
  en: {
    [ApplicationMethod.Fingertips]: 'Fingertips',
    [ApplicationMethod.CottonPad]: 'Cotton pad',
    [ApplicationMethod.Brush]: 'Brush',
    [ApplicationMethod.Spray]: 'Spray',
    [ApplicationMethod.Dropper]: 'Dropper',
    [ApplicationMethod.Spatula]: 'Spatula',
    [ApplicationMethod.Other]: 'As directed',
  },
  sv: {
    [ApplicationMethod.Fingertips]: 'Fingertoppar',
    [ApplicationMethod.CottonPad]: 'Bomullsrondell',
    [ApplicationMethod.Brush]: 'Borste',
    [ApplicationMethod.Spray]: 'Spray',
    [ApplicationMethod.Dropper]: 'Pipett',
    [ApplicationMethod.Spatula]: 'Spatel',
    [ApplicationMethod.Other]: 'Enligt anvisning',
  },
  es: {
    [ApplicationMethod.Fingertips]: 'Yemas de los dedos',
    [ApplicationMethod.CottonPad]: 'Disco de algodon',
    [ApplicationMethod.Brush]: 'Brocha',
    [ApplicationMethod.Spray]: 'Spray',
    [ApplicationMethod.Dropper]: 'Gotero',
    [ApplicationMethod.Spatula]: 'Espatula',
    [ApplicationMethod.Other]: 'Segun las indicaciones',
  },
};

const QUANTITY_LABELS: Record<AppLanguage, Record<Quantity, string>> = {
  en: {
    [Quantity.OneDrop]: '1 drop',
    [Quantity.TwoToThreeDrops]: '2-3 drops',
    [Quantity.PeaSize]: 'Pea-size amount',
    [Quantity.PumpOne]: '1 pump',
    [Quantity.PumpTwo]: '2 pumps',
    [Quantity.CoinSize]: 'Coin-size amount',
    [Quantity.Generous]: 'Generous layer',
    [Quantity.AsNeeded]: 'As needed',
    [Quantity.Other]: 'As needed',
  },
  sv: {
    [Quantity.OneDrop]: '1 droppe',
    [Quantity.TwoToThreeDrops]: '2-3 droppar',
    [Quantity.PeaSize]: 'En arta',
    [Quantity.PumpOne]: '1 pump',
    [Quantity.PumpTwo]: '2 pump',
    [Quantity.CoinSize]: 'Myntstor mangd',
    [Quantity.Generous]: 'Generost lager',
    [Quantity.AsNeeded]: 'Vid behov',
    [Quantity.Other]: 'Vid behov',
  },
  es: {
    [Quantity.OneDrop]: '1 gota',
    [Quantity.TwoToThreeDrops]: '2-3 gotas',
    [Quantity.PeaSize]: 'Cantidad del tamano de un guisante',
    [Quantity.PumpOne]: '1 pulsacion',
    [Quantity.PumpTwo]: '2 pulsaciones',
    [Quantity.CoinSize]: 'Cantidad del tamano de una moneda',
    [Quantity.Generous]: 'Capa generosa',
    [Quantity.AsNeeded]: 'Segun sea necesario',
    [Quantity.Other]: 'Segun sea necesario',
  },
};

const SHORT_GUIDANCE_FALLBACKS: Record<
  AppLanguage,
  { applicationMethod: string; quantity: string }
> = {
  en: { applicationMethod: 'As directed', quantity: 'As needed' },
  sv: { applicationMethod: 'Enligt anvisning', quantity: 'Vid behov' },
  es: {
    applicationMethod: 'Segun las indicaciones',
    quantity: 'Segun sea necesario',
  },
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
  language: AppLanguage = DEFAULT_LANGUAGE,
): string | null {
  if (!value) return value ?? null;
  const resolvedLanguage = normalizeLanguage(language);
  if (isApplicationMethod(value)) {
    return APPLICATION_METHOD_LABELS[resolvedLanguage][value];
  }
  return toShortGuidance(
    value,
    SHORT_GUIDANCE_FALLBACKS[resolvedLanguage].applicationMethod,
  );
}

export function toHumanQuantity(
  value: string | null | undefined,
  language: AppLanguage = DEFAULT_LANGUAGE,
): string | null {
  if (!value) return value ?? null;
  const resolvedLanguage = normalizeLanguage(language);
  if (isQuantity(value)) {
    return QUANTITY_LABELS[resolvedLanguage][value];
  }
  return toShortGuidance(
    value,
    SHORT_GUIDANCE_FALLBACKS[resolvedLanguage].quantity,
  );
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

import {
  DEFAULT_LANGUAGE,
  normalizeLanguage,
  type AppLanguage,
} from '../../common/i18n/i18n';
import { ProductCategory } from '../../shelf/shelf.types';
import type { SuggestionProductScore } from '../suggestion-context.types';

const PRODUCT_CATEGORY_VALUE_SET = new Set<string>(
  Object.values(ProductCategory),
);

const internalReasonPattern =
  /\b(score|scoring|ranking|rank|verified|data quality|ingredient list available|matches this slot|preferred time|same-daypart|current context|current selection|ai|fallback)\b/i;

const activeTagCopy: Record<string, Record<AppLanguage, string>> = {
  niacinamide: {
    en: 'Adds niacinamide support for tone and post-breakout marks.',
    sv: 'Ger niacinamidstod for hudton och marken efter utbrott.',
    es: 'Anade apoyo de niacinamida para tono y marcas posteriores a brotes.',
  },
  vitamin_c: {
    en: 'Adds brightening antioxidant support for dark marks.',
    sv: 'Ger antioxidativt lysterstod for morka marken.',
    es: 'Anade apoyo antioxidante iluminador para manchas oscuras.',
  },
  retinoid: {
    en: "Uses your tolerated retinoid as this routine's active step.",
    sv: 'Anvander din tolererade retinoid som rutinens aktiva steg.',
    es: 'Usa tu retinoide tolerado como activo de esta rutina.',
  },
  azelaic_acid: {
    en: 'Adds azelaic acid support for marks, texture, and breakouts.',
    sv: 'Ger azelainsyrastod for marken, textur och utbrott.',
    es: 'Anade apoyo de acido azelaico para marcas, textura y brotes.',
  },
  benzoyl_peroxide: {
    en: 'Targets breakout-prone areas today.',
    sv: 'Riktar in sig pa omraden med risk for utbrott idag.',
    es: 'Se enfoca hoy en zonas propensas a brotes.',
  },
  bha: {
    en: 'Adds salicylic-acid support for pores and texture.',
    sv: 'Ger salicylsyrastod for porer och textur.',
    es: 'Anade apoyo de acido salicilico para poros y textura.',
  },
  aha: {
    en: 'Supports texture with an exfoliating step.',
    sv: 'Stodjer textur med ett exfolierande steg.',
    es: 'Apoya la textura con un paso exfoliante.',
  },
  pha: {
    en: 'Supports texture with a gentler exfoliating step.',
    sv: 'Stodjer textur med ett mildare exfolierande steg.',
    es: 'Apoya la textura con un paso exfoliante mas suave.',
  },
  ceramide: {
    en: 'Adds ceramide support for the skin barrier.',
    sv: 'Ger ceramidstod for hudbarriaren.',
    es: 'Anade apoyo de ceramidas para la barrera cutanea.',
  },
  barrier_support: {
    en: 'Adds barrier support to keep the routine comfortable.',
    sv: 'Ger barriarstod for att halla rutinen behaglig.',
    es: 'Anade apoyo de barrera para mantener la rutina comoda.',
  },
  humectant: {
    en: 'Adds hydration support before sealing it in.',
    sv: 'Ger aterfuktning innan den kapslas in.',
    es: 'Anade hidratacion antes de sellarla.',
  },
  spf: {
    en: 'Protects against UV, which can deepen dark marks.',
    sv: 'Skyddar mot UV som kan forstarka morka marken.',
    es: 'Protege frente a UV, que puede intensificar manchas oscuras.',
  },
};

const copy = {
  benefit: {
    en: (value: string) => `Supports ${value} today.`,
    sv: (value: string) => `Stodjer ${value} idag.`,
    es: (value: string) => `Apoya ${value} hoy.`,
  },
  goal: {
    en: (value: string) => `Fits your current focus on ${value}.`,
    sv: (value: string) => `Passar ditt nuvarande fokus pa ${value}.`,
    es: (value: string) => `Encaja con tu enfoque actual en ${value}.`,
  },
  category: {
    [ProductCategory.Cleanser]: {
      en: 'Cleanses before leave-on steps.',
      sv: 'Rengor fore produkter som lamnas kvar.',
      es: 'Limpia antes de los pasos que se dejan en la piel.',
    },
    [ProductCategory.Toner]: {
      en: 'Adds a light prep step before heavier products.',
      sv: 'Ger ett latt forberedande steg fore tyngre produkter.',
      es: 'Anade un paso ligero antes de productos mas densos.',
    },
    [ProductCategory.Essence]: {
      en: 'Adds lightweight hydration before serum or cream.',
      sv: 'Ger latt aterfuktning fore serum eller cream.',
      es: 'Anade hidratacion ligera antes del serum o la crema.',
    },
    [ProductCategory.Serum]: {
      en: 'Adds a targeted leave-on step from your shelf.',
      sv: 'Lagger till ett riktat steg fran din hylla.',
      es: 'Anade un paso especifico de tu estante.',
    },
    [ProductCategory.Treatment]: {
      en: 'Adds the targeted treatment step for this routine.',
      sv: 'Lagger till det riktade behandlingssteget for rutinen.',
      es: 'Anade el paso de tratamiento especifico para esta rutina.',
    },
    [ProductCategory.Exfoliant]: {
      en: 'Uses the exfoliant as the single resurfacing step.',
      sv: 'Anvander exfolieringen som enda utjamnande steg.',
      es: 'Usa el exfoliante como unico paso renovador.',
    },
    [ProductCategory.Moisturizer]: {
      en: 'Finishes with barrier support.',
      sv: 'Avslutar med barriarstod.',
      es: 'Termina con apoyo para la barrera.',
    },
    [ProductCategory.SunProtection]: {
      en: 'Protects daytime skin with SPF.',
      sv: 'Skyddar huden dagtid med SPF.',
      es: 'Protege la piel de dia con SPF.',
    },
    [ProductCategory.EyeCare]: {
      en: 'Targets the eye-area step from your shelf.',
      sv: 'Riktar in sig pa ogonomradet fran din hylla.',
      es: 'Cubre el paso del contorno de ojos de tu estante.',
    },
    [ProductCategory.LipCare]: {
      en: 'Adds the lip-care step for comfort.',
      sv: 'Lagger till lappvard for komfort.',
      es: 'Anade cuidado de labios para comodidad.',
    },
    [ProductCategory.Mask]: {
      en: "Uses the mask as today's focused treatment.",
      sv: 'Anvander masken som dagens riktade behandling.',
      es: 'Usa la mascarilla como tratamiento enfocado de hoy.',
    },
    [ProductCategory.Other]: {
      en: 'Uses this shelf product where it best fits.',
      sv: 'Anvander denna hyllprodukt dar den passar bast.',
      es: 'Usa este producto del estante donde mejor encaja.',
    },
  },
  activeTag: activeTagCopy,
  generic: {
    en: 'Uses this shelf product where it best fits.',
    sv: 'Anvander denna hyllprodukt dar den passar bast.',
    es: 'Usa este producto del estante donde mejor encaja.',
  },
} satisfies {
  benefit: Record<AppLanguage, (value: string) => string>;
  goal: Record<AppLanguage, (value: string) => string>;
  category: Record<ProductCategory, Record<AppLanguage, string>>;
  activeTag: Record<string, Record<AppLanguage, string>>;
  generic: Record<AppLanguage, string>;
};

export interface SuggestionStepExplanationContext {
  language?: AppLanguage | null;
  goalText?: string | null;
}

export function buildProductScoreStepExplanation(
  score: SuggestionProductScore,
  context: SuggestionStepExplanationContext = {},
): string {
  const language = normalizeLanguage(context.language ?? DEFAULT_LANGUAGE);
  const benefit = joinedUserFacingPhrases(
    [...(score.benefits ?? []), ...(score.suitedFor ?? [])],
    language,
  );
  if (benefit) return copy.benefit[language](benefit);

  const goalText = userFacingPhrase(context.goalText);
  if (
    goalText &&
    score.suitabilityReasons.some((reason) =>
      /supports (?:main|selected) skin profile goal/i.test(reason),
    )
  ) {
    return copy.goal[language](goalText);
  }

  const activeTagExplanation = score.activeTags
    .map((tag) => copy.activeTag[tag]?.[language])
    .find((value): value is string => Boolean(value));
  if (activeTagExplanation) return activeTagExplanation;

  const reason = firstUserFacingPhrase(score.suitabilityReasons);
  if (reason) return copy.benefit[language](reason);

  return buildCategoryStepExplanation(score.category, language);
}

export function buildCategoryStepExplanation(
  stepLabel: string,
  languageInput?: AppLanguage | null,
): string {
  const language = normalizeLanguage(languageInput ?? DEFAULT_LANGUAGE);
  if (!PRODUCT_CATEGORY_VALUE_SET.has(stepLabel)) return copy.generic[language];
  const category = stepLabel as ProductCategory;
  return copy.category[category][language];
}

function firstUserFacingPhrase(values: readonly string[]): string | null {
  return (
    values
      .map(userFacingPhrase)
      .find((value): value is string => Boolean(value)) ?? null
  );
}

function joinedUserFacingPhrases(
  values: readonly string[],
  language: AppLanguage,
): string | null {
  const phrases = values
    .map(userFacingPhrase)
    .filter((value): value is string => Boolean(value))
    .filter((value, index, list) => list.indexOf(value) === index)
    .slice(0, 2);
  if (phrases.length === 0) return null;
  if (phrases.length === 1) return phrases[0] ?? null;
  const joiner = { en: ' and ', sv: ' och ', es: ' y ' }[language];
  return phrases.join(joiner);
}

function userFacingPhrase(value: string | null | undefined): string | null {
  const cleaned = value
    ?.trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s{2,}/g, ' ');
  if (!cleaned || internalReasonPattern.test(cleaned)) return null;
  return cleaned.replace(/[.;]\s*$/g, '').toLowerCase();
}

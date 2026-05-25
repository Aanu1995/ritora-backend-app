import {
  AppLanguage,
  DEFAULT_LANGUAGE,
  normalizeLanguage,
} from '../../common/i18n/i18n';
import {
  SmartPicksCoverage,
  SmartPicksCoverageRole,
  SmartPicksCoveredItem,
  SmartPicksGapSnapshot,
  SmartPicksRedundancyGroup,
} from '../smart-picks.types';
import { normalizeSuggestionGapKey } from '../../suggestions/services/suggestion-gap-actions';

export const SMART_PICKS_COVERAGE_ROLES = [
  'cleanse',
  'hydrate',
  'treat',
  'moisturise',
  'spf',
  'eye',
  'treatment-secondary',
  'dark-spot-treatment',
  'antioxidant',
  'exfoliation-mask',
  'acne-treatment',
  'barrier-support',
  'congestion-mask',
  'texture-exfoliant',
  'retinoid',
  'peptide',
  'recovery-mask',
  'goal-primary',
  'goal-support',
] as const satisfies readonly SmartPicksCoverageRole[];

export const SMART_PICKS_ACTIVE_TAGS = [
  'retinoid',
  'aha',
  'bha',
  'pha',
  'vitamin_c',
  'benzoyl_peroxide',
  'azelaic_acid',
  'niacinamide',
  'ceramide',
  'humectant',
  'barrier_support',
  'spf',
  'salicylic_acid',
] as const;

type SmartPicksActiveTag = (typeof SMART_PICKS_ACTIVE_TAGS)[number];

type SmartPicksGapText = Pick<
  SmartPicksGapSnapshot,
  | 'normalizedKey'
  | 'ingredientOrCategory'
  | 'reason'
  | 'shortReason'
  | 'goalAlignment'
>;

type LocalizedGapCopy = Omit<SmartPicksGapText, 'normalizedKey'>;

const COVERAGE_ROLE_LABELS = {
  en: {
    cleanse: 'cleanse',
    hydrate: 'hydrate',
    treat: 'treatment',
    moisturise: 'moisturise',
    spf: 'SPF',
    eye: 'eye care',
    'treatment-secondary': 'second treatment',
    'dark-spot-treatment': 'dark-spot treatment',
    antioxidant: 'antioxidant',
    'exfoliation-mask': 'mask or peel',
    'acne-treatment': 'acne treatment',
    'barrier-support': 'barrier support',
    'congestion-mask': 'congestion mask',
    'texture-exfoliant': 'texture exfoliant',
    retinoid: 'retinoid',
    peptide: 'peptide support',
    'recovery-mask': 'recovery mask',
    'goal-primary': 'goal product',
    'goal-support': 'goal support',
  },
  sv: {
    cleanse: 'rengöring',
    hydrate: 'återfuktning',
    treat: 'behandling',
    moisturise: 'mjukgörande',
    spf: 'SPF',
    eye: 'ögonvård',
    'treatment-secondary': 'andra behandling',
    'dark-spot-treatment': 'pigmentbehandling',
    antioxidant: 'antioxidant',
    'exfoliation-mask': 'mask eller peeling',
    'acne-treatment': 'aknebehandling',
    'barrier-support': 'barriärstöd',
    'congestion-mask': 'mask mot tilltäppthet',
    'texture-exfoliant': 'texturpeeling',
    retinoid: 'retinoid',
    peptide: 'peptidstöd',
    'recovery-mask': 'återhämtningsmask',
    'goal-primary': 'målprodukt',
    'goal-support': 'målstöd',
  },
  es: {
    cleanse: 'limpieza',
    hydrate: 'hidratación',
    treat: 'tratamiento',
    moisturise: 'hidratante',
    spf: 'SPF',
    eye: 'cuidado de ojos',
    'treatment-secondary': 'segundo tratamiento',
    'dark-spot-treatment': 'tratamiento de manchas',
    antioxidant: 'antioxidante',
    'exfoliation-mask': 'mascarilla o exfoliante',
    'acne-treatment': 'tratamiento de acné',
    'barrier-support': 'soporte de barrera',
    'congestion-mask': 'mascarilla para congestión',
    'texture-exfoliant': 'exfoliante de textura',
    retinoid: 'retinoide',
    peptide: 'soporte con péptidos',
    'recovery-mask': 'mascarilla de recuperación',
    'goal-primary': 'producto objetivo',
    'goal-support': 'apoyo al objetivo',
  },
} satisfies Record<AppLanguage, Record<SmartPicksCoverageRole, string>>;

const ACTIVE_TAG_LABELS = {
  en: {
    retinoid: 'retinoid',
    aha: 'AHA',
    bha: 'BHA',
    pha: 'PHA',
    vitamin_c: 'vitamin C',
    benzoyl_peroxide: 'benzoyl peroxide',
    azelaic_acid: 'azelaic acid',
    niacinamide: 'niacinamide',
    ceramide: 'ceramide',
    humectant: 'humectant',
    barrier_support: 'barrier support',
    spf: 'SPF',
    salicylic_acid: 'salicylic acid',
  },
  sv: {
    retinoid: 'retinoid',
    aha: 'AHA',
    bha: 'BHA',
    pha: 'PHA',
    vitamin_c: 'vitamin C',
    benzoyl_peroxide: 'bensoylperoxid',
    azelaic_acid: 'azelainsyra',
    niacinamide: 'niacinamid',
    ceramide: 'ceramid',
    humectant: 'fuktbindare',
    barrier_support: 'barriärstöd',
    spf: 'SPF',
    salicylic_acid: 'salicylsyra',
  },
  es: {
    retinoid: 'retinoide',
    aha: 'AHA',
    bha: 'BHA',
    pha: 'PHA',
    vitamin_c: 'vitamina C',
    benzoyl_peroxide: 'peróxido de benzoilo',
    azelaic_acid: 'ácido azelaico',
    niacinamide: 'niacinamida',
    ceramide: 'ceramida',
    humectant: 'humectante',
    barrier_support: 'soporte de barrera',
    spf: 'SPF',
    salicylic_acid: 'ácido salicílico',
  },
} satisfies Record<AppLanguage, Record<SmartPicksActiveTag, string>>;

const GAP_COPY_BY_LANGUAGE: Record<
  AppLanguage,
  Record<string, LocalizedGapCopy>
> = {
  en: {},
  es: {},
  sv: buildGapCopyMap([
    [
      'Gentle fragrance-free cleanser',
      {
        ingredientOrCategory: 'Mild parfymfri rengöring',
        reason:
          'En gles hylla behöver ett lågrisksteg för rengöring innan aktiva ingredienser läggs till.',
        shortReason:
          'En gles hylla behöver ett lågrisksteg för rengöring innan aktiva ingredienser läggs till.',
        goalAlignment: 'startrutin',
      },
    ],
    [
      'Barrier-support moisturizer',
      {
        ingredientOrCategory: 'Mjukgörare som stödjer hudbarriären',
        reason: 'En enkel mjukgörare håller startrutinen bekväm.',
        shortReason: 'En enkel mjukgörare håller startrutinen bekväm.',
        goalAlignment: 'startrutin',
      },
    ],
    [
      'Broad-spectrum sunscreen SPF 30+',
      {
        ingredientOrCategory: 'Bredspektrumsolskydd SPF 30+',
        reason:
          'Dagligt solskydd är skyddssteget som en starthylla inte bör hoppa över.',
        shortReason:
          'Dagligt solskydd är skyddssteget som en starthylla inte bör hoppa över.',
        goalAlignment: 'solskydd',
      },
    ],
    [
      'PIH-focused serum with azelaic acid or tranexamic acid',
      {
        ingredientOrCategory:
          'Serum mot pigmentmärken med azelainsyra eller tranexamsyra',
        reason:
          'Ditt mål är mörka märken, och den aktiva hyllan visar ännu inget tydligt serum för pigmentstöd.',
        shortReason:
          'Ditt mål är mörka märken, och hyllan saknar ännu ett tydligt serum för pigmentstöd.',
        goalAlignment: 'stöd mot mörka märken',
      },
    ],
    [
      'Vitamin C antioxidant serum',
      {
        ingredientOrCategory: 'Antioxidantserum med vitamin C',
        reason:
          'Vitamin C kan stödja mål kring ojämn hudton när solskydd och ett pigmentserum redan är planerade.',
        shortReason:
          'Vitamin C kan stödja ojämn hudton när solskydd och pigmentserum redan är planerade.',
        goalAlignment: 'stöd mot mörka märken',
      },
    ],
    [
      'Gentle pigment-supporting mask or peel',
      {
        ingredientOrCategory: 'Mild mask eller peeling för pigmentstöd',
        reason:
          'En varsam mask eller peeling ibland kan vara värd att överväga när den dagliga rutinen mot mörka märken är täckt.',
        shortReason:
          'En varsam mask eller peeling kan vara värd att överväga när den dagliga pigmentrutinen är täckt.',
        goalAlignment: 'stöd mot mörka märken',
      },
    ],
    [
      'Beginner retinoid night treatment',
      {
        ingredientOrCategory: 'Nattbehandling med retinoid för nybörjare',
        reason:
          'En mild nattretinoid kan ge starkare stöd när säkerhetsprofilen tillåter det.',
        shortReason:
          'En mild nattretinoid kan ge starkare stöd när säkerhetsprofilen tillåter det.',
        goalAlignment: 'stöd mot mörka märken',
      },
    ],
    [
      'Adapalene or benzoyl peroxide acne treatment',
      {
        ingredientOrCategory:
          'Aknebehandling med adapalen eller bensoylperoxid',
        reason:
          'Ditt mål pekar på finnar och utbrott, och hyllan visar ännu ingen tydlig behandling som lämnas kvar på huden.',
        shortReason:
          'Ditt mål pekar på finnar och utbrott, och hyllan visar ännu ingen tydlig behandling som lämnas kvar på huden.',
        goalAlignment: 'utbrottskontroll',
      },
    ],
    [
      'Benzoyl peroxide or azelaic acid acne treatment',
      {
        ingredientOrCategory:
          'Aknebehandling med bensoylperoxid eller azelainsyra',
        reason:
          'Ditt mål pekar på finnar och utbrott, och säkerhetsprofilen talar för att undvika retinoidstyrda val.',
        shortReason:
          'Ditt mål pekar på finnar och utbrott, och säkerhetsprofilen talar för att undvika retinoidstyrda val.',
        goalAlignment: 'utbrottskontroll',
      },
    ],
    [
      'Azelaic acid acne-and-mark support serum',
      {
        ingredientOrCategory: 'Serum med azelainsyra för finnar och märken',
        reason:
          'Azelainsyra kan stödja rutiner för utbrottsbenägen hud och samtidigt vara användbar när märken ingår i målet.',
        shortReason:
          'Azelainsyra kan stödja utbrottsbenägen hud och vara användbar när märken ingår i målet.',
        goalAlignment: 'utbrottskontroll',
      },
    ],
    [
      'Leave-on salicylic acid or BHA for clogged pores',
      {
        ingredientOrCategory:
          'Leave-on med salicylsyra eller BHA för tilltäppta porer',
        reason:
          'Ett separat BHA-steg är användbart när tilltäppta porer ingår i mönstret och hyllan inte redan visar ett sådant.',
        shortReason:
          'Ett separat BHA-steg är användbart när tilltäppta porer ingår i mönstret.',
        goalAlignment: 'utbrottskontroll',
      },
    ],
    [
      'Barrier-support moisturizer or serum for acne routines',
      {
        ingredientOrCategory:
          'Mjukgörare eller serum för barriärstöd i aknerutiner',
        reason:
          'Aknerutiner fungerar bättre när irritation hålls låg, så barriärstöd är värt att överväga.',
        shortReason:
          'Aknerutiner fungerar bättre när irritation hålls låg, så barriärstöd är värt att överväga.',
        goalAlignment: 'utbrottskontroll',
      },
    ],
    [
      'Clay or sulfur mask for congested weeks',
      {
        ingredientOrCategory: 'Ler- eller svavelmask för tilltäppta veckor',
        reason:
          'En tillfällig mask mot tilltäppthet kan vara användbar utan att lägga till ännu en daglig aktiv produkt.',
        shortReason:
          'En tillfällig mask mot tilltäppthet kan vara användbar utan ännu en daglig aktiv produkt.',
        goalAlignment: 'utbrottskontroll',
      },
    ],
    [
      'Gentle AHA, PHA, or BHA texture treatment',
      {
        ingredientOrCategory: 'Mild texturbehandling med AHA, PHA eller BHA',
        reason:
          'Ditt mål pekar på textur, och hyllan visar ännu inget tydligt steg för försiktig exfoliering.',
        shortReason:
          'Ditt mål pekar på textur, och hyllan visar ännu inget tydligt exfolierande steg.',
        goalAlignment: 'texturstöd',
      },
    ],
    [
      'Smoothing retinoid night treatment',
      {
        ingredientOrCategory: 'Utjämnande nattbehandling med retinoid',
        reason:
          'En retinoid kan ge starkare långsiktigt texturstöd när säkerhetsprofilen tillåter det.',
        shortReason:
          'En retinoid kan ge starkare långsiktigt texturstöd när säkerhetsprofilen tillåter det.',
        goalAlignment: 'texturstöd',
      },
    ],
    [
      'Barrier-support moisturizer or serum for texture routines',
      {
        ingredientOrCategory:
          'Mjukgörare eller serum för barriärstöd i texturrutiner',
        reason:
          'Texturrutiner är lättare att hålla konsekventa när barriärstödet är täckt.',
        shortReason:
          'Texturrutiner är lättare att hålla konsekventa när barriärstödet är täckt.',
        goalAlignment: 'texturstöd',
      },
    ],
    [
      'Occasional smoothing mask or peel',
      {
        ingredientOrCategory: 'Utjämnande mask eller peeling ibland',
        reason:
          'En varsam utjämnande produkt ibland kan vara användbar när dagliga behandlingssteg redan är planerade.',
        shortReason:
          'En varsam utjämnande produkt ibland kan vara användbar när dagliga steg redan är planerade.',
        goalAlignment: 'texturstöd',
      },
    ],
    [
      'Barrier-calming serum with niacinamide, panthenol, or centella',
      {
        ingredientOrCategory:
          'Lugnande barriärserum med niacinamid, pantenol eller centella',
        reason:
          'Ditt mål pekar på känslighet eller barriärstress, och hyllan visar ännu inget lugnande stödjande steg.',
        shortReason:
          'Ditt mål pekar på känslighet eller barriärstress, och hyllan saknar ännu ett lugnande stödjande steg.',
        goalAlignment: 'lugn och barriärstöd',
      },
    ],
    [
      'Recovery mask or barrier balm',
      {
        ingredientOrCategory: 'Återhämtningsmask eller barriärbalm',
        reason:
          'En återhämtningsprodukt kan vara värd att överväga för rutiner med högre komfort, särskilt efter aktiva kvällar.',
        shortReason:
          'En återhämtningsprodukt kan vara värd att överväga, särskilt efter aktiva kvällar.',
        goalAlignment: 'lugn och barriärstöd',
      },
    ],
    [
      'Mineral sunscreen for sensitive skin',
      {
        ingredientOrCategory: 'Mineralsolskydd för känslig hud',
        reason:
          'Ett solskyddsspår för känslig hud kan minska friktion när målet är lugnare hud.',
        shortReason:
          'Ett solskyddsspår för känslig hud kan minska friktion när målet är lugnare hud.',
        goalAlignment: 'lugn och barriärstöd',
      },
    ],
    [
      'Hydrating serum with glycerin or hyaluronic acid',
      {
        ingredientOrCategory:
          'Återfuktande serum med glycerin eller hyaluronsyra',
        reason:
          'Ditt mål pekar på återfuktning, och hyllan visar ännu inget dedikerat fuktbindande stöd.',
        shortReason:
          'Ditt mål pekar på återfuktning, och hyllan visar ännu inget dedikerat fuktbindande stöd.',
        goalAlignment: 'återfuktningsstöd',
      },
    ],
    [
      'Barrier-support moisturizer for hydration routines',
      {
        ingredientOrCategory:
          'Barriärstödjande mjukgörare för återfuktningsrutiner',
        reason:
          'Återfuktningsmål behöver ett steg som låser in fukt, inte bara vattenbindande ingredienser.',
        shortReason:
          'Återfuktningsmål behöver ett steg som låser in fukt, inte bara vattenbindande ingredienser.',
        goalAlignment: 'återfuktningsstöd',
      },
    ],
    [
      'Overnight hydration mask',
      {
        ingredientOrCategory: 'Återfuktande nattmask',
        reason:
          'En mer komfortinriktad återfuktningsrutin kan innehålla en nattmask ibland i stället för ännu ett dagligt serum.',
        shortReason:
          'En nattmask ibland kan ge extra komfort utan ännu ett dagligt serum.',
        goalAlignment: 'återfuktningsstöd',
      },
    ],
    [
      'Beginner retinoid or retinal night treatment',
      {
        ingredientOrCategory:
          'Nattbehandling med retinoid eller retinal för nybörjare',
        reason:
          'Ditt mål pekar på linjer eller fasthet, och hyllan visar ännu inget retinoidliknande nattsteg.',
        shortReason:
          'Ditt mål pekar på linjer eller fasthet, och hyllan visar ännu inget retinoidliknande nattsteg.',
        goalAlignment: 'stöd för tidiga ålderstecken',
      },
    ],
    [
      'Peptide support serum',
      {
        ingredientOrCategory: 'Stödserum med peptider',
        reason:
          'Ett peptidserum kan vara ett stödjande alternativ utan att ersätta den viktigaste nattbehandlingen.',
        shortReason:
          'Ett peptidserum kan vara ett stödjande alternativ utan att ersätta nattbehandlingen.',
        goalAlignment: 'stöd för tidiga ålderstecken',
      },
    ],
    [
      'Antioxidant serum for firmness routines',
      {
        ingredientOrCategory: 'Antioxidantserum för fasthetsrutiner',
        reason:
          'Ett antioxidantsteg kan stödja dagrutiner som fokuserar på fasthet och hudton.',
        shortReason:
          'Ett antioxidantsteg kan stödja dagrutiner som fokuserar på fasthet och hudton.',
        goalAlignment: 'stöd för tidiga ålderstecken',
      },
    ],
    [
      'Barrier-support moisturizer for retinoid nights',
      {
        ingredientOrCategory: 'Barriärstödjande mjukgörare för retinoidkvällar',
        reason:
          'En retinoidfokuserad rutin fungerar bättre när komfort- och mjukgörarstegen är täckta.',
        shortReason:
          'En retinoidfokuserad rutin fungerar bättre när komfort- och mjukgörarstegen är täckta.',
        goalAlignment: 'stöd för tidiga ålderstecken',
      },
    ],
    [
      'Low-irritation acne treatment with azelaic acid or BHA',
      {
        ingredientOrCategory:
          'Aknebehandling med låg irritationsrisk, azelainsyra eller BHA',
        reason:
          'Din profil pekar på utbrott, så startpaketet behöver en mild aknebehandling i stället för flera aktiva produkter.',
        shortReason:
          'Din profil pekar på utbrott, så startpaketet behöver en mild aknebehandling.',
        goalAlignment: 'utbrottskontroll',
      },
    ],
    [
      'Azelaic acid or tranexamic acid dark-spot serum',
      {
        ingredientOrCategory:
          'Serum mot mörka märken med azelainsyra eller tranexamsyra',
        reason:
          'Din profil pekar på mörka märken eller ojämn hudton, så startpaketet behöver en PIH-medveten behandling efter att solskyddet är på plats.',
        shortReason:
          'Din profil pekar på mörka märken eller ojämn hudton, så startpaketet behöver en PIH-medveten behandling.',
        goalAlignment: 'stöd mot mörka märken',
      },
    ],
    [
      'Gentle AHA/PHA texture treatment',
      {
        ingredientOrCategory: 'Mild texturbehandling med AHA/PHA',
        reason:
          'Din profil pekar på ojämn textur eller tilltäppta porer, så startpaketet behöver en texturbehandling som introduceras långsamt.',
        shortReason:
          'Din profil pekar på textur eller tilltäppta porer, så startpaketet behöver en långsamt introducerad behandling.',
        goalAlignment: 'texturstöd',
      },
    ],
    [
      'Barrier-calming serum with niacinamide or panthenol',
      {
        ingredientOrCategory:
          'Barriärlugnande serum med niacinamid eller pantenol',
        reason:
          'Din profil pekar på rodnad eller irritation, så startpaketet bör vara lugnande och barriärfokuserat.',
        shortReason:
          'Din profil pekar på rodnad eller irritation, så startpaketet bör vara lugnande.',
        goalAlignment: 'lugn och barriärstöd',
      },
    ],
    [
      'Pregnancy-conscious peptide or bakuchiol night treatment',
      {
        ingredientOrCategory:
          'Graviditetsmedveten nattbehandling med peptider eller bakuchiol',
        reason:
          'Din profil pekar på stöd för tidiga ålderstecken, men säkerhetsprofilen gör att startpaketet bör undvika retinoidval.',
        shortReason:
          'Din säkerhetsprofil gör att startpaketet bör undvika retinoidval.',
        goalAlignment: 'stöd för tidiga ålderstecken',
      },
    ],
  ]),
};

export function buildSmartPicksCoveredItems(
  coverage: SmartPicksCoverage,
  language: AppLanguage = DEFAULT_LANGUAGE,
): SmartPicksCoveredItem[] {
  return coverage.slots
    .filter((slot) => slot.state === 'filled' && slot.filledByName)
    .map((slot) => ({
      role: slot.role,
      productName: slot.filledByName as string,
      reason: smartPicksCoveredReason(slot.role, language),
    }));
}

export function localizeSmartPicksGapText<T extends SmartPicksGapText>(
  gap: T,
  languageInput: string | null | undefined,
): T {
  const language = normalizeLanguage(languageInput);
  const copy = GAP_COPY_BY_LANGUAGE[language][gap.normalizedKey];
  if (!copy) {
    return gap;
  }

  return {
    ...gap,
    ingredientOrCategory: copy.ingredientOrCategory,
    reason: copy.reason,
    shortReason: copy.shortReason,
    goalAlignment: copy.goalAlignment,
  };
}

export function localizeSmartPicksCoveredItems(
  items: SmartPicksCoveredItem[],
  languageInput: string | null | undefined,
): SmartPicksCoveredItem[] {
  const language = normalizeLanguage(languageInput);
  return items.map((item) => ({
    ...item,
    reason: smartPicksCoveredReason(item.role, language),
  }));
}

export function localizeSmartPicksRedundancyGroups(
  groups: SmartPicksRedundancyGroup[],
  languageInput: string | null | undefined,
): SmartPicksRedundancyGroup[] {
  const language = normalizeLanguage(languageInput);
  return groups.map((group) => ({
    ...group,
    hint: smartPicksRedundancyHint(
      group.activeTag,
      group.products.length,
      language,
    ),
  }));
}

export function smartPicksCoverageRoleLabel(
  role: string,
  languageInput: string | null | undefined,
): string {
  const language = normalizeLanguage(languageInput);
  const labels: Record<string, string> = COVERAGE_ROLE_LABELS[language];
  return labels[role] ?? humanizeSmartPicksToken(role);
}

export function smartPicksActiveTagLabel(
  activeTag: string,
  languageInput: string | null | undefined,
): string {
  const language = normalizeLanguage(languageInput);
  const labels: Record<string, string> = ACTIVE_TAG_LABELS[language];
  const normalizedActiveTag = activeTag.replace(/-/g, '_');
  return (
    labels[normalizedActiveTag] ??
    labels[activeTag] ??
    humanizeSmartPicksToken(activeTag)
  );
}

export function smartPicksRedundancyHint(
  activeTag: string,
  productCount: number,
  languageInput: string | null | undefined = DEFAULT_LANGUAGE,
): string {
  const language = normalizeLanguage(languageInput);
  const tagLabel = smartPicksActiveTagLabel(activeTag, language);
  if (language === 'sv') {
    const noun = productCount === 1 ? 'produkt' : 'produkter';
    return `Du har ${productCount} ${noun} med signaler för ${tagLabel}. Använd upp en innan du lägger till en till.`;
  }

  if (language === 'es') {
    const noun = productCount === 1 ? 'producto' : 'productos';
    return `Tienes ${productCount} ${noun} con señales de ${tagLabel}. Termina uno antes de añadir otro.`;
  }

  const noun = productCount === 1 ? 'product' : 'products';
  return `You have ${productCount} ${noun} with ${tagLabel} signals. Finish one before adding another.`;
}

export function smartPicksStarterKitSummary(
  activeProductCount: number,
  languageInput: string | null | undefined = DEFAULT_LANGUAGE,
): string {
  const language = normalizeLanguage(languageInput);
  if (language === 'sv') {
    return activeProductCount === 0
      ? 'Börja med grunderna. Lägg till behandling sist.'
      : 'Gör klart de saknade startstegen innan du lägger till extra produkter.';
  }

  if (language === 'es') {
    return activeProductCount === 0
      ? 'Empieza con lo esencial. Añade tratamiento al final.'
      : 'Completa los pasos básicos que faltan antes de añadir productos extra.';
  }

  return activeProductCount === 0
    ? 'Start with the essentials. Add treatment last.'
    : 'Complete the missing starter steps before adding extra products.';
}

export function smartPicksStarterStepTitle(
  role: SmartPicksCoverageRole,
  languageInput: string | null | undefined = DEFAULT_LANGUAGE,
): string {
  const language = normalizeLanguage(languageInput);
  const titleByRole: Record<
    AppLanguage,
    Partial<Record<SmartPicksCoverageRole, string>>
  > = {
    en: {
      cleanse: 'Cleanse',
      moisturise: 'Moisturise',
      spf: 'Protect',
      treat: 'Treat',
    },
    sv: {
      cleanse: 'Rengör',
      moisturise: 'Mjukgör',
      spf: 'Skydda',
      treat: 'Behandla',
    },
    es: {
      cleanse: 'Limpiar',
      moisturise: 'Hidratar',
      spf: 'Proteger',
      treat: 'Tratar',
    },
  };

  return (
    titleByRole[language][role] ?? smartPicksCoverageRoleLabel(role, language)
  );
}

export function smartPicksStarterCoveredReason(
  productName: string | null,
  languageInput: string | null | undefined = DEFAULT_LANGUAGE,
): string {
  const language = normalizeLanguage(languageInput);
  if (language === 'sv') {
    return productName
      ? `Du har redan det här startsteget täckt av ${productName}.`
      : 'Du har redan det här startsteget täckt.';
  }

  if (language === 'es') {
    return productName
      ? `Ya tienes este paso inicial cubierto con ${productName}.`
      : 'Ya tienes este paso inicial cubierto.';
  }

  return productName
    ? `You already have this starter step covered by ${productName}.`
    : 'You already have this starter step covered.';
}

export function smartPicksStarterWaitReason(
  role: SmartPicksCoverageRole,
  languageInput: string | null | undefined = DEFAULT_LANGUAGE,
): string {
  const language = normalizeLanguage(languageInput);
  if (language === 'sv') {
    return role === 'treat'
      ? 'Ditt nuvarande mål behöver inte en behandlingsprodukt ännu. Bygg rengöring, mjukgörande och solskydd först.'
      : 'Vänta med det här steget tills din startrutin har grunderna på plats.';
  }

  if (language === 'es') {
    return role === 'treat'
      ? 'Tu objetivo actual todavía no necesita un producto de tratamiento. Construye primero limpiador, hidratante y protector solar.'
      : 'Espera con este paso hasta que tu rutina inicial tenga los básicos cubiertos.';
  }

  return role === 'treat'
    ? 'Your current goal does not need a treatment product yet. Build cleanser, moisturizer, and sunscreen first.'
    : 'Wait on this step until your starter routine has the basics covered.';
}

function smartPicksCoveredReason(role: string, language: AppLanguage): string {
  const roleLabel = smartPicksCoverageRoleLabel(role, language);
  if (language === 'sv') {
    return `Täcker rollen ${roleLabel}.`;
  }

  if (language === 'es') {
    return `Cubre tu rol de ${roleLabel}.`;
  }

  return `Covers your ${roleLabel} role.`;
}

function humanizeSmartPicksToken(value: string): string {
  return value.replace(/[-_]+/g, ' ').trim();
}

function buildGapCopyMap(
  entries: readonly (readonly [string, LocalizedGapCopy])[],
): Record<string, LocalizedGapCopy> {
  return Object.fromEntries(
    entries.map(([englishIngredientOrCategory, copy]) => [
      normalizeSuggestionGapKey(englishIngredientOrCategory),
      copy,
    ]),
  );
}

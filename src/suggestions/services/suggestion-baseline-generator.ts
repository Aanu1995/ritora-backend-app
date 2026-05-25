import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { ProductCategory } from '../../shelf/shelf.types';
import { buildEnvironmentAdaptationPolicy } from '../../environment-intelligence/environment-adaptation-policy';
import {
  DEFAULT_LANGUAGE,
  normalizeLanguage,
  type AppLanguage,
} from '../../common/i18n/i18n';
import type {
  SuggestionGenerationInputs,
  SuggestionGenerationStepOutput,
} from './suggestion-ai-generator';
import {
  SuggestionDaypart,
  SuggestionEvidenceSourceId,
  SuggestionExplanationJson,
  SuggestionGapRecommendationJson,
  SuggestionRequestSource,
  SuggestionStepChipTone,
  SuggestionStepProvenance,
} from '../suggestions.constants';
import { SuggestionProductScore } from '../suggestion-context.types';
import { mergeEvidenceSourceIds } from './suggestion-evidence-sources';
import {
  toHumanApplicationMethod,
  toHumanQuantity,
} from './suggestion-language';

const baselineCopy = {
  noStepsHeadline: {
    en: 'No shelf steps yet',
    sv: 'Inga hyllsteg an',
    es: 'Aun no hay pasos',
  },
  quickHeadline: {
    en: 'Quick shelf suggestion',
    sv: 'Snabbt hyllforslag',
    es: 'Sugerencia rapida',
  },
  shelfHeadline: {
    en: 'Using your shelf today',
    sv: 'Anvander din hylla idag',
    es: 'Usando tu estante hoy',
  },
  scheduledDetail: {
    en: 'Ritora used your shelf and safety rules for this slot.',
    sv: 'Ritora anvande din hylla och sakerhetsregler for denna tid.',
    es: 'Ritora uso tu estante y reglas de seguridad para este horario.',
  },
  noActiveProducts: {
    en: 'No active shelf products are available to apply right now.',
    sv: 'Inga aktiva hyllprodukter finns att applicera just nu.',
    es: 'No hay productos activos disponibles para aplicar ahora.',
  },
  missingSunscreen: {
    en: 'Sunscreen is missing from your shelf, so it stays a gap instead of an invented step.',
    sv: 'Solskydd saknas pa din hylla, sa det blir ett gap i stallet for ett hittat steg.',
    es: 'Falta protector solar en tu estante, asi que queda como carencia y no como paso inventado.',
  },
  pigmentSpfGap: {
    en: 'For dark marks or uneven tone, that SPF gap is essential for daytime care.',
    sv: 'Vid morka marken eller ojamn ton ar SPF-gapet viktigt dagtid.',
    es: 'Para manchas oscuras o tono desigual, esa carencia de SPF es esencial de dia.',
  },
  restart: {
    en: 'Restarting gently after your break.',
    sv: 'Startar forsiktigt igen efter din paus.',
    es: 'Retomando suavemente despues de tu pausa.',
  },
  goodFit: {
    en: 'Good fit for this slot.',
    sv: 'Passar bra for denna tid.',
    es: 'Encaja bien para este horario.',
  },
  evidenceLabel: { en: 'Evidence', sv: 'Underlag', es: 'Evidencia' },
  environmentLabel: { en: 'Environment', sv: 'Miljo', es: 'Entorno' },
  environmentConsidered: {
    en: 'Environment data was considered.',
    sv: 'Miljodata vagdes in.',
    es: 'Se considero el entorno.',
  },
  baselineChip: { en: 'Ritora baseline', sv: 'Ritora-bas', es: 'Base Ritora' },
  sunscreenCategory: {
    en: 'Broad-spectrum sunscreen SPF 30+',
    sv: 'Brett spektrum solskydd SPF 30+',
    es: 'Protector solar de amplio espectro SPF 30+',
  },
  barrierMoisturizerCategory: {
    en: 'Fragrance-free barrier moisturizer',
    sv: 'Parfymfri barriarkram',
    es: 'Hidratante de barrera sin fragancia',
  },
  barrierSupportGoal: {
    en: 'barrier support',
    sv: 'barriarstod',
    es: 'apoyo de barrera',
  },
  gapSunscreen: {
    en: 'Daytime routines need a sunscreen option.',
    sv: 'Rutiner dagtid behover ett solskydd.',
    es: 'Las rutinas diurnas necesitan una opcion de protector solar.',
  },
  gapSunscreenPigment: {
    en: 'A sunscreen is the essential missing daytime step for dark marks or uneven tone.',
    sv: 'Solskydd ar det viktiga saknade steget dagtid for morka marken eller ojamn ton.',
    es: 'El protector solar es el paso diurno esencial que falta para manchas o tono desigual.',
  },
  gapBarrierMoisturizer: {
    en: 'A simple moisturizer can support barrier recovery.',
    sv: 'En enkel kram kan stodja barriaraterhamtning.',
    es: 'Una hidratante simple puede apoyar la recuperacion de la barrera.',
  },
  onDemandPostWorkout: {
    en: 'Post-workout reset: cleanse sweat, keep it quick, and avoid strong actives.',
    sv: 'Efter traning: rengor svett, hall det snabbt och undvik starka aktiva amnen.',
    es: 'Despues de entrenar: limpia el sudor, hazlo rapido y evita activos fuertes.',
  },
  onDemandEventPrep: {
    en: 'Event prep: keep skin calm now and avoid risky last-minute actives.',
    sv: 'Infor event: hall huden lugn och undvik riskabla aktiva amnen i sista minuten.',
    es: 'Antes de un evento: calma la piel y evita activos arriesgados de ultimo momento.',
  },
  onDemandPostSun: {
    en: 'Post-sun reset: keep skin comfortable and prioritize barrier support.',
    sv: 'Efter sol: hall huden bekvam och prioritera barriarstott.',
    es: 'Despues del sol: manten la piel comoda y prioriza la barrera.',
  },
  onDemandPostSwim: {
    en: 'Post-swim reset: rinse, moisturize, and protect the barrier.',
    sv: 'Efter simning: skolj, aterfukta och skydda barriaren.',
    es: 'Despues de nadar: enjuaga, hidrata y protege la barrera.',
  },
  onDemandTravel: {
    en: 'Travel refresh: keep the routine simple and comfortable.',
    sv: 'Resefrisch: hall rutinen enkel och bekvam.',
    es: 'Refresco de viaje: manten la rutina simple y comoda.',
  },
  onDemandQuick: {
    en: 'Quick refresh: use the simplest helpful shelf steps right now.',
    sv: 'Snabb uppfriskning: anvand de enklaste hjalpsamma stegen nu.',
    es: 'Refresco rapido: usa ahora los pasos utiles mas simples.',
  },
  onDemandPostMakeup: {
    en: 'Post-makeup or shower reset: cleanse gently and support the barrier.',
    sv: 'Efter makeup eller dusch: rengor milt och stod barriaren.',
    es: 'Despues del maquillaje o la ducha: limpia suave y apoya la barrera.',
  },
  onDemandOther: {
    en: 'Ritora used your shelf and safety rules for this request.',
    sv: 'Ritora anvande din hylla och sakerhetsregler for denna forfragan.',
    es: 'Ritora uso tu estante y reglas de seguridad para esta solicitud.',
  },
} satisfies Record<string, Record<AppLanguage, string>>;

export function buildDeterministicAiSteps(
  inputs: SuggestionGenerationInputs,
): SuggestionGenerationStepOutput[] {
  const language = normalizeLanguage(inputs.language ?? DEFAULT_LANGUAGE);
  const productById = new Map(
    inputs.shelfActiveProducts.map((product) => [product.id, product]),
  );
  return selectBaselineProducts(inputs)
    .map((score, index) => {
      const product = productById.get(score.productId);
      if (!product) return null;
      return productScoreToStep(product, score, index, language);
    })
    .filter((step): step is SuggestionGenerationStepOutput => step !== null);
}

export function deterministicExplanation(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
): SuggestionExplanationJson {
  const language = normalizeLanguage(inputs.language ?? DEFAULT_LANGUAGE);
  const missingSunscreen = needsMissingDaytimeSunscreen(inputs);
  return {
    headline:
      steps.length === 0
        ? baselineCopy.noStepsHeadline[language]
        : inputs.requestSource === SuggestionRequestSource.OnDemand
          ? baselineCopy.quickHeadline[language]
          : baselineCopy.shelfHeadline[language],
    body: [
      inputs.requestSource === SuggestionRequestSource.OnDemand
        ? onDemandFallbackDetail(inputs, language)
        : baselineCopy.scheduledDetail[language],
      ...(steps.length === 0 ? [baselineCopy.noActiveProducts[language]] : []),
      ...(missingSunscreen ? [baselineCopy.missingSunscreen[language]] : []),
      ...(missingSunscreen && needsPigmentProtection(inputs)
        ? [baselineCopy.pigmentSpfGap[language]]
        : []),
      ...(inputs.contextSummary.routineBreak.recentlyResumed
        ? [baselineCopy.restart[language]]
        : []),
    ],
    perStepReasons: steps.map((step) => ({
      stepOrder: step.stepOrder,
      reason: step.explanation ?? baselineCopy.goodFit[language],
    })),
    skipped: inputs.contextSummary.skippedCandidates.map((candidate) => {
      const product = inputs.contextSummary.productScores.find(
        (score) => score.productId === candidate.productId,
      );
      return {
        name: product
          ? `${product.brand} ${product.name}`
          : candidate.productId,
        reason: deterministicSkippedReason(language),
      };
    }),
    inputs: [
      {
        label: baselineCopy.evidenceLabel[language],
        detail: evidenceDetail(
          inputs.contextSummary.evidenceSources.length,
          language,
        ),
      },
      ...(inputs.contextSummary.environment
        ? [
            {
              label: baselineCopy.environmentLabel[language],
              detail: environmentDetail(
                inputs.contextSummary.environment,
                language,
              ),
            },
          ]
        : []),
    ],
  };
}

function needsMissingDaytimeSunscreen(
  inputs: SuggestionGenerationInputs,
): boolean {
  return (
    (inputs.daypart === SuggestionDaypart.Morning ||
      inputs.daypart === SuggestionDaypart.Noon) &&
    !inputs.contextSummary.productScores.some(
      (score) => score.category === ProductCategory.SunProtection,
    )
  );
}

function evidenceDetail(count: number, language: AppLanguage): string {
  return {
    en: `${count} trusted sources informed the safety check.`,
    sv: `${count} betrodda kallor vagledde sakerhetskontrollen.`,
    es: `${count} fuentes fiables informaron la revision de seguridad.`,
  }[language];
}

function deterministicSkippedReason(language: AppLanguage): string {
  return {
    en: 'Skipped because today calls for a simpler routine.',
    sv: 'Hoppas over eftersom dagen behover en enklare rutin.',
    es: 'Se omite porque hoy conviene una rutina mas simple.',
  }[language];
}

function deterministicStepReason(
  category: ProductCategory,
  language: AppLanguage,
): string {
  const categoryReasons: Partial<
    Record<ProductCategory, Record<AppLanguage, string>>
  > = {
    [ProductCategory.Cleanser]: {
      en: 'Gentle cleanse fits this slot.',
      sv: 'Mild rengoring passar denna tid.',
      es: 'Una limpieza suave encaja en este horario.',
    },
    [ProductCategory.Moisturizer]: {
      en: 'Barrier support fits this slot.',
      sv: 'Barriarstod passar denna tid.',
      es: 'El apoyo de barrera encaja en este horario.',
    },
    [ProductCategory.SunProtection]: {
      en: 'Daytime sun protection fits this slot.',
      sv: 'Solskydd dagtid passar denna tid.',
      es: 'La proteccion solar diurna encaja en este horario.',
    },
  };
  return (
    categoryReasons[category]?.[language] ?? baselineCopy.goodFit[language]
  );
}

function deterministicCautionReason(language: AppLanguage): string {
  return {
    en: 'Use this step gently today.',
    sv: 'Anvand detta steg forsiktigt idag.',
    es: 'Usa este paso con suavidad hoy.',
  }[language];
}

function localizeEnvironmentGapCategory(
  value: string,
  language: AppLanguage,
): string {
  if (/sunscreen|spf/i.test(value))
    return baselineCopy.sunscreenCategory[language];
  if (/moisturizer|barrier/i.test(value)) {
    return {
      en: 'Barrier-support moisturizer',
      sv: 'Barriarstodjande kram',
      es: 'Hidratante de apoyo de barrera',
    }[language];
  }
  return value;
}

function localizeEnvironmentGapReason(
  value: string,
  language: AppLanguage,
): string {
  if (/high uv/i.test(value)) {
    return {
      en: 'High UV makes daily sunscreen important.',
      sv: 'Hog UV gor dagligt solskydd viktigt.',
      es: 'El UV alto hace importante el protector solar diario.',
    }[language];
  }
  if (/dry air|hard-water/i.test(value)) {
    return {
      en: 'Dry air or hard-water sensitivity can increase tightness.',
      sv: 'Torr luft eller kanslighet for hart vatten kan oka stramhet.',
      es: 'El aire seco o la sensibilidad al agua dura puede aumentar la tirantez.',
    }[language];
  }
  return value;
}

function localizeEnvironmentGoal(
  value: string | null | undefined,
  language: AppLanguage,
): string | null {
  if (!value) return null;
  if (/sun protection/i.test(value)) {
    return { en: 'sun protection', sv: 'solskydd', es: 'proteccion solar' }[
      language
    ];
  }
  if (/barrier support/i.test(value))
    return baselineCopy.barrierSupportGoal[language];
  return value;
}

function onDemandFallbackDetail(
  inputs: SuggestionGenerationInputs,
  language: AppLanguage,
): string {
  switch (inputs.requestContext?.intent) {
    case 'post_workout':
      return baselineCopy.onDemandPostWorkout[language];
    case 'event_prep':
      return baselineCopy.onDemandEventPrep[language];
    case 'post_sun':
      return baselineCopy.onDemandPostSun[language];
    case 'post_swim':
      return baselineCopy.onDemandPostSwim[language];
    case 'travel_refresh':
      return baselineCopy.onDemandTravel[language];
    case 'quick_refresh':
      return baselineCopy.onDemandQuick[language];
    case 'post_makeup_or_shower':
      return baselineCopy.onDemandPostMakeup[language];
    case 'other':
    case undefined:
      return baselineCopy.onDemandOther[language];
  }
}

export function buildDeterministicGapRecommendations(
  inputs: SuggestionGenerationInputs,
): SuggestionGapRecommendationJson[] {
  const language = normalizeLanguage(inputs.language ?? DEFAULT_LANGUAGE);
  const productScores = inputs.contextSummary.productScores;
  const hasSunscreen = productScores.some(
    (score) => score.category === ProductCategory.SunProtection,
  );
  const hasMoisturizer = productScores.some(
    (score) => score.category === ProductCategory.Moisturizer,
  );
  const gaps: SuggestionGapRecommendationJson[] = [];
  const environmentPolicy = buildEnvironmentAdaptationPolicy(
    inputs.contextSummary.environment,
  );

  if (
    (inputs.daypart === SuggestionDaypart.Morning ||
      inputs.daypart === SuggestionDaypart.Noon) &&
    !hasSunscreen
  ) {
    const sunscreenReason = needsPigmentProtection(inputs)
      ? baselineCopy.gapSunscreenPigment[language]
      : baselineCopy.gapSunscreen[language];
    gaps.push({
      ingredientOrCategory: baselineCopy.sunscreenCategory[language],
      reason: sunscreenReason,
      budgetTier: null,
      goalAlignment: inputs.skinProfile?.primary_goal ?? null,
      sourceIds: [
        SuggestionEvidenceSourceId.AadSunscreenSelection,
        SuggestionEvidenceSourceId.FdaAhaSunSensitivity,
      ],
    });
  }

  if (
    (inputs.contextSummary.reaction.hasSignal ||
      inputs.contextSummary.reaction.barrierCompromised) &&
    !hasMoisturizer
  ) {
    gaps.push({
      ingredientOrCategory: baselineCopy.barrierMoisturizerCategory[language],
      reason: baselineCopy.gapBarrierMoisturizer[language],
      budgetTier: null,
      goalAlignment: baselineCopy.barrierSupportGoal[language],
      sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
    });
  }

  for (const gap of environmentPolicy.gapRecommendations) {
    const alreadyCovered = gaps.some(
      (candidate) =>
        candidate.ingredientOrCategory.toLowerCase() ===
        gap.ingredientOrCategory.toLowerCase(),
    );
    if (!alreadyCovered) {
      gaps.push({
        ...gap,
        ingredientOrCategory: localizeEnvironmentGapCategory(
          gap.ingredientOrCategory,
          language,
        ),
        reason: localizeEnvironmentGapReason(gap.reason, language),
        budgetTier: null,
        goalAlignment:
          localizeEnvironmentGoal(gap.goalAlignment, language) ??
          inputs.skinProfile?.primary_goal ??
          null,
      });
    }
  }

  return gaps.map((gap) => ({
    ...gap,
    sourceIds: mergeEvidenceSourceIds(gap.sourceIds),
  }));
}

function needsPigmentProtection(inputs: SuggestionGenerationInputs): boolean {
  return /(dark mark|hyperpigmentation|uneven tone|melasma|pigment)/i.test(
    JSON.stringify([
      inputs.skinProfile?.primary_goal ?? '',
      inputs.skinProfile?.current_concerns ?? [],
      inputs.contextSummary.skinProfile.activeConcerns,
    ]),
  );
}

function environmentDetail(
  environment: NonNullable<
    SuggestionGenerationInputs['contextSummary']['environment']
  >,
  language: AppLanguage,
): string {
  const parts = [
    environment.conditionLabel,
    environment.uvRisk !== 'unknown' ? `UV ${environment.uvRisk}` : null,
    environment.humidityBand,
    environment.airQualityRisk !== 'unknown'
      ? `air ${environment.airQualityRisk}`
      : null,
  ].filter(Boolean);
  return parts.length > 0
    ? parts.join(' - ')
    : baselineCopy.environmentConsidered[language];
}

function selectBaselineProducts(
  inputs: SuggestionGenerationInputs,
): SuggestionProductScore[] {
  const preferredOrder = preferredCategoryOrder(inputs);
  const selected: SuggestionProductScore[] = [];
  const usedCategories = new Set<ProductCategory>();
  const skippedProductIds = new Set(
    inputs.contextSummary.skippedCandidates.map(
      (candidate) => candidate.productId,
    ),
  );
  const candidates = inputs.contextSummary.productScores
    .filter((score) => score.suitabilityScore >= 40)
    .filter((score) => !skippedProductIds.has(score.productId))
    .filter((score) =>
      shouldAvoidStrongActives(inputs)
        ? !score.activeTags.some((tag) =>
            ['retinoid', 'aha', 'bha', 'benzoyl_peroxide'].includes(tag),
          )
        : true,
    );

  for (const category of preferredOrder) {
    const match = candidates.find(
      (score) =>
        score.category === category && !usedCategories.has(score.category),
    );
    if (!match) continue;
    selected.push(match);
    usedCategories.add(match.category);
  }

  const limit =
    inputs.requestContext?.intensity === 'minimal'
      ? requiresOwnedDaytimeSpf(inputs)
        ? 3
        : 2
      : 4;
  return selected.slice(0, limit);
}

function preferredCategoryOrder(
  inputs: SuggestionGenerationInputs,
): ProductCategory[] {
  if (inputs.requestSource === SuggestionRequestSource.OnDemand) {
    switch (inputs.requestContext?.intent) {
      case 'post_workout':
      case 'post_makeup_or_shower':
        return [
          ProductCategory.Cleanser,
          ProductCategory.Moisturizer,
          ProductCategory.SunProtection,
        ];
      case 'post_sun':
      case 'post_swim':
        return [
          ProductCategory.Cleanser,
          ProductCategory.Moisturizer,
          ProductCategory.SunProtection,
        ];
      case 'event_prep':
        return [
          ProductCategory.Cleanser,
          ProductCategory.Serum,
          ProductCategory.Moisturizer,
          ProductCategory.SunProtection,
        ];
      case 'quick_refresh':
      case 'travel_refresh':
        return [ProductCategory.Moisturizer, ProductCategory.SunProtection];
      case 'other':
      case undefined:
        break;
    }
  }

  if (prefersMinimalRoutine(inputs)) {
    return inputs.daypart === SuggestionDaypart.Evening
      ? [ProductCategory.Cleanser, ProductCategory.Moisturizer]
      : [
          ProductCategory.Cleanser,
          ProductCategory.Moisturizer,
          ProductCategory.SunProtection,
        ];
  }

  if (shouldAvoidStrongActives(inputs)) {
    return inputs.daypart === SuggestionDaypart.Evening
      ? [ProductCategory.Cleanser, ProductCategory.Moisturizer]
      : [
          ProductCategory.Cleanser,
          ProductCategory.Moisturizer,
          ProductCategory.SunProtection,
        ];
  }

  if (inputs.daypart === SuggestionDaypart.Evening) {
    return [
      ProductCategory.Cleanser,
      ProductCategory.Serum,
      ProductCategory.Treatment,
      ProductCategory.Exfoliant,
      ProductCategory.Moisturizer,
    ];
  }

  return [
    ProductCategory.Cleanser,
    ProductCategory.Serum,
    ProductCategory.Moisturizer,
    ProductCategory.SunProtection,
  ];
}

function shouldAvoidStrongActives(inputs: SuggestionGenerationInputs): boolean {
  return (
    inputs.contextSummary.reaction.hasSignal ||
    inputs.contextSummary.reaction.barrierCompromised ||
    inputs.contextSummary.routineBreak.recentlyResumed ||
    inputs.contextSummary.applicationPatterns.conservativeRestart ||
    hasPregnancyOrMedicationCaution(inputs)
  );
}

function hasPregnancyOrMedicationCaution(
  inputs: SuggestionGenerationInputs,
): boolean {
  const safetyValues = Object.values(inputs.skinProfile?.safety_context ?? {});
  const text = JSON.stringify([
    inputs.skinProfile?.pregnancy_status ?? '',
    safetyValues,
    inputs.skinProfile?.under_dermatologist_care ?? '',
  ]).toLowerCase();
  return /(pregnan|breastfeed|trying|conceiv|medication)/i.test(text);
}

function requiresOwnedDaytimeSpf(inputs: SuggestionGenerationInputs): boolean {
  if (
    inputs.daypart !== SuggestionDaypart.Morning &&
    inputs.daypart !== SuggestionDaypart.Noon
  ) {
    return false;
  }
  if (
    /\b(indoor|indoors|inside|at home all day|no daylight)\b/i.test(
      inputs.requestContext?.note ?? '',
    )
  ) {
    return false;
  }
  return inputs.contextSummary.productScores.some(
    (score) => score.category === ProductCategory.SunProtection,
  );
}

function prefersMinimalRoutine(inputs: SuggestionGenerationInputs): boolean {
  const preferences = inputs.skinProfile?.routine_preferences;
  if (preferences?.pace === 'minimal') return true;
  if (
    inputs.daypart === SuggestionDaypart.Morning &&
    typeof preferences?.am_minutes === 'number' &&
    preferences.am_minutes <= 5
  ) {
    return true;
  }
  if (
    inputs.daypart === SuggestionDaypart.Evening &&
    typeof preferences?.pm_minutes === 'number' &&
    preferences.pm_minutes <= 5
  ) {
    return true;
  }
  return false;
}

function productScoreToStep(
  product: InventoryProduct,
  score: SuggestionProductScore,
  index: number,
  language: AppLanguage,
): SuggestionGenerationStepOutput {
  return {
    stepOrder: index,
    routineStepId: null,
    inventoryProductId: product.id,
    productBrand: product.brand,
    productName: product.name,
    stepLabel: product.category,
    customLabel: null,
    applicationMethod: toHumanApplicationMethod(
      product.guidance?.applicationMethod ?? null,
      language,
    ),
    quantity: toHumanQuantity(product.guidance?.quantity ?? null, language),
    waitAfterMinutes: score.waitMinutes,
    explanation: deterministicStepReason(score.category, language),
    routineNote: null,
    provenance: SuggestionStepProvenance.AiAdded,
    chips: [
      {
        tone: SuggestionStepChipTone.Ai,
        text: baselineCopy.baselineChip[language],
      },
    ],
    safetyWarnings: score.cautionReasons.length
      ? [
          {
            severity: 'info',
            message: deterministicCautionReason(language),
            ingredientSlugs: score.activeTags,
            sourceIds: score.evidenceSourceIds,
          },
        ]
      : [],
  };
}

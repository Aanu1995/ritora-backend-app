import { ProductCategory } from '../../shelf/shelf.types';
import {
  DEFAULT_LANGUAGE,
  normalizeLanguage,
  type AppLanguage,
} from '../../common/i18n/i18n';
import {
  SuggestionContextSummary,
  SuggestionProductScore,
} from '../suggestion-context.types';
import {
  SuggestionDaypart,
  SuggestionEvidenceSourceId,
  SuggestionSafetyFlagJson,
} from '../suggestions.constants';
import {
  buildEnvironmentAdaptationPolicy,
  isHighUvRisk,
} from '../../environment-intelligence/environment-adaptation-policy';
import { EnvironmentSignalKind } from '../../environment-intelligence/environment-intelligence.constants';
import type { SuggestionGenerationStepOutput } from './suggestion-ai-generator';
import { mergeEvidenceSourceIds } from './suggestion-evidence-sources';
import { isStrongActiveTag } from './suggestion-product-intelligence';

export function buildSafetyConstraints(
  context: Pick<SuggestionContextSummary, 'reaction' | 'productScores'> &
    Partial<
      Pick<
        SuggestionContextSummary,
        | 'appliedProductHistory'
        | 'profileSignals'
        | 'safetyConstraints'
        | 'skinProfile'
        | 'targetDate'
      >
    >,
): string[] {
  const constraints: string[] = [];
  if (context.reaction.hasSignal || context.reaction.barrierCompromised) {
    constraints.push('barrier_recovery_mode');
    constraints.push('avoid_new_strong_actives');
  }
  if (
    context.productScores.some((product) => product.activeTags.includes('spf'))
  ) {
    constraints.push('daytime_spf_available');
  }
  if (hasRecentStrongActiveApplication(context)) {
    constraints.push('space_strong_actives');
  }
  if (hasPregnancyOrMedicationCaution(context)) {
    constraints.push('pregnancy_or_medication_active_caution');
  }
  return constraints;
}

export function buildPolicySafetyFlags(
  context: SuggestionContextSummary,
  steps: SuggestionGenerationStepOutput[],
  language: AppLanguage = DEFAULT_LANGUAGE,
): SuggestionSafetyFlagJson[] {
  const resolvedLanguage = normalizeLanguage(language);
  const productById = new Map(
    context.productScores.map((product) => [product.productId, product]),
  );
  const selectedProducts = steps
    .map((step) =>
      step.inventoryProductId ? productById.get(step.inventoryProductId) : null,
    )
    .filter((product): product is SuggestionProductScore => Boolean(product));
  const selectedTags = new Set(selectedProducts.flatMap((p) => p.activeTags));
  const flags: SuggestionSafetyFlagJson[] = [];
  const environmentPolicy = buildEnvironmentAdaptationPolicy(
    context.environment,
  );

  if (context.reaction.hasSignal || context.reaction.barrierCompromised) {
    flags.push({
      severity: 'warning',
      message: localizedSafetyCopy.reaction[resolvedLanguage],
      ingredientSlugs: [],
      sourceIds: [SuggestionEvidenceSourceId.MayoDrySkinCare],
    });
  }
  if (
    (context.daypart === SuggestionDaypart.Morning ||
      context.daypart === SuggestionDaypart.Noon) &&
    !context.productScores.some(
      (product) => product.category === ProductCategory.SunProtection,
    )
  ) {
    flags.push({
      severity: 'info',
      message: localizedSafetyCopy.noSunscreen[resolvedLanguage],
      ingredientSlugs: ['spf'],
      sourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
    });
  }
  if (
    hasPregnancyOrMedicationCaution(context) &&
    context.productScores.some((product) =>
      product.activeTags.some((tag) =>
        ['retinoid', 'retinol', 'adapalene', 'tretinoin'].includes(
          tag.toLowerCase(),
        ),
      ),
    )
  ) {
    flags.push({
      severity: 'warning',
      message: activeCautionMessage(context, resolvedLanguage),
      ingredientSlugs: ['retinoid'],
      sourceIds: [SuggestionEvidenceSourceId.DermNetTopicalRetinoids],
    });
  }
  if (selectedTags.has('retinoid') && selectedTags.has('aha')) {
    flags.push(
      activeMixFlag(localizedSafetyCopy.retinoidAha[resolvedLanguage], [
        SuggestionEvidenceSourceId.AadRetinoidRetinol,
        SuggestionEvidenceSourceId.FdaAhaSunSensitivity,
      ]),
    );
  }
  if (selectedTags.has('retinoid') && selectedTags.has('bha')) {
    flags.push(
      activeMixFlag(localizedSafetyCopy.retinoidBha[resolvedLanguage], [
        SuggestionEvidenceSourceId.AadRetinoidRetinol,
        SuggestionEvidenceSourceId.AadAcneTreatment,
      ]),
    );
  }
  if (selectedTags.has('aha') && selectedTags.has('bha')) {
    flags.push(
      activeMixFlag(localizedSafetyCopy.ahaBha[resolvedLanguage], [
        SuggestionEvidenceSourceId.FdaAhaSunSensitivity,
        SuggestionEvidenceSourceId.AadAcneTreatment,
      ]),
    );
  }
  if (
    (selectedTags.has('retinoid') ||
      selectedTags.has('aha') ||
      selectedTags.has('bha')) &&
    !selectedProducts.some(
      (product) => product.category === ProductCategory.SunProtection,
    )
  ) {
    flags.push({
      severity: 'info',
      message: localizedSafetyCopy.photosensitizing[resolvedLanguage],
      ingredientSlugs: ['retinoid', 'aha', 'bha'],
      sourceIds: [
        SuggestionEvidenceSourceId.AadSunscreenSelection,
        SuggestionEvidenceSourceId.AadRetinoidRetinol,
        SuggestionEvidenceSourceId.FdaAhaSunSensitivity,
      ],
    });
  }
  if (
    context.environment &&
    isHighUvRisk(context.environment.uvRisk) &&
    (context.daypart === SuggestionDaypart.Morning ||
      context.daypart === SuggestionDaypart.Noon)
  ) {
    const hasSelectedSunscreen = selectedProducts.some(
      (product) => product.category === ProductCategory.SunProtection,
    );
    flags.push({
      severity: 'info',
      message: hasSelectedSunscreen
        ? localizedSafetyCopy.highUvWithSunscreen[resolvedLanguage]
        : localizedSafetyCopy.highUvNoSunscreen[resolvedLanguage],
      ingredientSlugs: ['spf'],
      sourceIds: [
        SuggestionEvidenceSourceId.OpenMeteoWeather,
        SuggestionEvidenceSourceId.AadSunscreenSelection,
      ],
    });
  }
  if (
    selectedProducts.some(
      (product) => product.category === ProductCategory.SunProtection,
    ) &&
    needsPigmentProtection(context)
  ) {
    flags.push({
      severity: 'info',
      message: localizedSafetyCopy.pigmentSunscreen[resolvedLanguage],
      ingredientSlugs: ['spf'],
      sourceIds: [
        SuggestionEvidenceSourceId.AadSunscreenSelection,
        SuggestionEvidenceSourceId.DermNetPostInflammatoryHyperpigmentation,
      ],
    });
  }
  for (const signal of environmentPolicy.signals) {
    if (signal.kind === EnvironmentSignalKind.HighUv) continue;
    flags.push({
      severity: signal.severity,
      message: localizedEnvironmentSignalMessage(signal.kind, resolvedLanguage),
      ingredientSlugs: [],
      sourceIds: signal.sourceIds,
    });
  }
  return dedupeFlags(flags);
}

const localizedSafetyCopy: Record<string, Record<AppLanguage, string>> = {
  reaction: {
    en: 'Recent reaction or barrier signal found; keep this routine simple and avoid new strong actives.',
    sv: 'Sen reaktion eller barriarsignal hittades; hall rutinen enkel och undvik nya starka aktiva amnen.',
    es: 'Se encontro una reaccion reciente o senal de barrera; manten la rutina simple y evita nuevos activos fuertes.',
  },
  noSunscreen: {
    en: 'No sunscreen is on your shelf, so daytime SPF stays a gap rather than an application step.',
    sv: 'Ingen solskyddsprodukt finns pa din hylla, sa SPF dagtid blir ett gap i stallet for ett steg.',
    es: 'No hay protector solar en tu estante, asi que el SPF diurno queda como una carencia y no como un paso.',
  },
  pregnancyRetinoid: {
    en: 'Pregnancy or medication context needs clinician guidance before changing strong actives.',
    sv: 'Graviditet eller medicinlage kraver klinisk vagledning innan starka aktiva amnen andras.',
    es: 'El embarazo o el contexto de medicacion requiere orientacion clinica antes de cambiar activos fuertes.',
  },
  medicationRetinoid: {
    en: 'Medication context needs clinician guidance before changing strong actives.',
    sv: 'Medicinlage kraver klinisk vagledning innan starka aktiva amnen andras.',
    es: 'El contexto de medicacion requiere orientacion clinica antes de cambiar activos fuertes.',
  },
  retinoidAha: {
    en: 'Retinoids and AHA exfoliants can be irritating together.',
    sv: 'Retinoider och AHA-exfolianter kan irritera tillsammans.',
    es: 'Los retinoides y los exfoliantes AHA pueden irritar si se combinan.',
  },
  retinoidBha: {
    en: 'Retinoids and BHA exfoliants can be irritating together.',
    sv: 'Retinoider och BHA-exfolianter kan irritera tillsammans.',
    es: 'Los retinoides y los exfoliantes BHA pueden irritar si se combinan.',
  },
  ahaBha: {
    en: 'AHA and BHA exfoliants should be spaced carefully.',
    sv: 'AHA- och BHA-exfolianter bor separeras noggrant.',
    es: 'Los exfoliantes AHA y BHA deben espaciarse con cuidado.',
  },
  photosensitizing: {
    en: 'Photosensitizing actives increase the importance of daytime sun protection.',
    sv: 'Fotosensibiliserande aktiva amnen gor solskydd dagtid extra viktigt.',
    es: 'Los activos fotosensibilizantes aumentan la importancia de la proteccion solar diurna.',
  },
  highUvWithSunscreen: {
    en: 'UV is high today, so keep sunscreen as the priority daytime step.',
    sv: 'UV ar hogt idag, sa lat solskydd vara dagens viktigaste steg.',
    es: 'El UV esta alto hoy, asi que prioriza el protector solar durante el dia.',
  },
  highUvNoSunscreen: {
    en: 'UV is high today, so daytime sunscreen matters.',
    sv: 'UV ar hogt idag, sa solskydd dagtid ar viktigt.',
    es: 'El UV esta alto hoy, asi que el protector solar diurno importa.',
  },
  pigmentSunscreen: {
    en: 'Sunscreen is central when dark marks or uneven tone are priority concerns.',
    sv: 'Solskydd ar centralt nar morka marken eller ojamn ton prioriteras.',
    es: 'El protector solar es central cuando las manchas o el tono desigual son prioridad.',
  },
};

function needsPigmentProtection(context: SuggestionContextSummary): boolean {
  return /(dark mark|hyperpigmentation|uneven tone|melasma|pigment)/i.test(
    JSON.stringify([
      context.skinProfile.primaryGoal ?? '',
      context.skinProfile.activeConcerns,
      context.goalSignals?.mainGoal ?? '',
      context.goalSignals?.primaryGoal ?? '',
      context.goalSignals?.selectedGoals ?? [],
      context.goalSignals?.secondaryGoals.map((goal) => goal.concern) ?? [],
    ]),
  );
}

function localizedEnvironmentSignalMessage(
  kind: EnvironmentSignalKind,
  language: AppLanguage,
): string {
  const messages: Record<EnvironmentSignalKind, Record<AppLanguage, string>> = {
    [EnvironmentSignalKind.HighUv]: {
      en: 'UV is high enough to make sunscreen a priority.',
      sv: 'UV ar tillrackligt hogt for att gora solskydd prioriterat.',
      es: 'El UV es lo bastante alto para priorizar el protector solar.',
    },
    [EnvironmentSignalKind.LowHumidity]: {
      en: 'Dry air can make skin feel tighter.',
      sv: 'Torr luft kan fa huden att kannas stramare.',
      es: 'El aire seco puede hacer que la piel se sienta mas tirante.',
    },
    [EnvironmentSignalKind.ColdDry]: {
      en: 'Cold dry weather favors barrier support.',
      sv: 'Kallt torrt vader gynnar barriarstott.',
      es: 'El clima frio y seco favorece el apoyo de la barrera.',
    },
    [EnvironmentSignalKind.HotHumid]: {
      en: 'Hot humid weather favors lighter layers.',
      sv: 'Varmt fuktigt vader passar battre med lattare lager.',
      es: 'El clima calido y humedo favorece capas mas ligeras.',
    },
    [EnvironmentSignalKind.PollutionElevated]: {
      en: 'Air quality is elevated, so cleansing and barrier support matter.',
      sv: 'Luftkvaliteten ar forhojd, sa rengoring och barriarstott ar viktiga.',
      es: 'La calidad del aire esta elevada, asi que importan la limpieza y el apoyo de la barrera.',
    },
    [EnvironmentSignalKind.HardWaterReported]: {
      en: 'Reported hard-water sensitivity favors gentler cleansing.',
      sv: 'Rapporterad kanslighet for hart vatten talar for mildare rengoring.',
      es: 'La sensibilidad al agua dura favorece una limpieza mas suave.',
    },
    [EnvironmentSignalKind.SeasonalTransitionDryer]: {
      en: 'Dry air is rising, so go slower with exfoliation.',
      sv: 'Luften blir torrare, sa ga langsammare med exfoliering.',
      es: 'El aire esta mas seco, asi que ve mas despacio con la exfoliacion.',
    },
    [EnvironmentSignalKind.SeasonalTransitionUvRising]: {
      en: 'UV is increasing, so daytime sunscreen checks get stricter.',
      sv: 'UV okar, sa kontroller av solskydd dagtid blir striktare.',
      es: 'El UV esta aumentando, asi que los controles de protector solar diurno son mas estrictos.',
    },
  };
  return messages[kind][language];
}

function hasRecentStrongActiveApplication(
  context: Pick<SuggestionContextSummary, 'reaction' | 'productScores'> &
    Partial<
      Pick<SuggestionContextSummary, 'appliedProductHistory' | 'targetDate'>
    >,
): boolean {
  if (!context.targetDate || !context.appliedProductHistory) return false;
  const scoreByProductId = new Map(
    context.productScores.map((product) => [product.productId, product]),
  );
  const latestAppliedDate =
    context.appliedProductHistory.products
      .filter((product) => {
        if (!product.productId || !product.lastAppliedDate) return false;
        return scoreByProductId
          .get(product.productId)
          ?.activeTags.some(isStrongActiveTag);
      })
      .map((product) => product.lastAppliedDate as string)
      .sort((left, right) => right.localeCompare(left))[0] ?? null;
  if (!latestAppliedDate) return false;
  return daysBetweenDates(latestAppliedDate, context.targetDate) <= 1;
}

function daysBetweenDates(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function hasPregnancyOrMedicationCaution(
  context: Partial<
    Pick<
      SuggestionContextSummary,
      'profileSignals' | 'safetyConstraints' | 'skinProfile'
    >
  >,
): boolean {
  const safety = context.profileSignals?.safety;
  return /(pregnan|breastfeed|trying|conceiv|medication)/i.test(
    JSON.stringify([
      context.skinProfile?.pregnancyStatus ?? '',
      safety?.pregnancyStatus ?? '',
      safety?.conditions ?? [],
      safety?.medications ?? [],
      safety?.photosensitizingOther ? 'photosensitizing medication' : '',
      safety?.underDermatologistCare ?? '',
      context.safetyConstraints,
    ]),
  );
}

function hasPregnancyCaution(
  context: Partial<
    Pick<SuggestionContextSummary, 'profileSignals' | 'skinProfile'>
  >,
): boolean {
  const safety = context.profileSignals?.safety;
  return /(pregnan|breastfeed|trying|conceiv)/i.test(
    JSON.stringify([
      context.skinProfile?.pregnancyStatus ?? '',
      safety?.pregnancyStatus ?? '',
      safety?.conditions ?? [],
    ]),
  );
}

function activeCautionMessage(
  context: Partial<
    Pick<SuggestionContextSummary, 'profileSignals' | 'skinProfile'>
  >,
  language: AppLanguage,
): string {
  return hasPregnancyCaution(context)
    ? localizedSafetyCopy.pregnancyRetinoid[language]
    : localizedSafetyCopy.medicationRetinoid[language];
}

export function skippedReasonsFromPolicy(
  context: SuggestionContextSummary,
): SuggestionContextSummary['skippedCandidates'] {
  return context.productScores
    .filter((product) => product.cautionReasons.length > 0)
    .map((product) => ({
      productId: product.productId,
      reason: product.cautionReasons[0],
      sourceIds: product.evidenceSourceIds,
    }));
}

function activeMixFlag(
  message: string,
  sourceIds: SuggestionEvidenceSourceId[],
): SuggestionSafetyFlagJson {
  return {
    severity: 'warning',
    message,
    ingredientSlugs: ['retinoid', 'aha', 'bha'],
    sourceIds,
  };
}

function dedupeFlags(
  flags: SuggestionSafetyFlagJson[],
): SuggestionSafetyFlagJson[] {
  const seen = new Set<string>();
  return flags.filter((flag) => {
    flag.sourceIds = mergeEvidenceSourceIds(flag.sourceIds ?? []);
    const key = `${flag.severity}:${flag.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import { StepLabel, STEP_LABELS } from '../../schedule/dto/schedule.constants';
import { RoutineStep } from '../../schedule/entities/routine-step.entity';
import {
  DEFAULT_LANGUAGE,
  normalizeLanguage,
  type AppLanguage,
} from '../../common/i18n/i18n';
import {
  SuggestionExplanationJson,
  SuggestionGapRecommendationJson,
  SuggestionEvidenceSourceId,
  SuggestionMode,
  SuggestionSafetyFlagJson,
  SuggestionStepChipJson,
  SuggestionStepProvenance,
} from '../suggestions.constants';
import type {
  SuggestionGenerationInputs,
  SuggestionGenerationStepOutput,
} from './suggestion-ai-generator';
import { RawSuggestionStepResponse } from './suggestion-ai-contract';
import { buildPolicySafetyFlags } from './suggestion-safety-policy';
import { mergeEvidenceSourceIds } from './suggestion-evidence-sources';
import {
  sanitizeSuggestionText,
  toHumanApplicationMethod,
  toHumanQuantity,
} from './suggestion-language';
import { resolveSuggestionProductScores } from './suggestion-product-score-resolver';

export type AssemblyContext = {
  language: AppLanguage;
  lockedSteps: RoutineStep[];
  routineById: Map<string, RoutineStep>;
  activeProductById: Map<string, InventoryProduct>;
  activeProductByName: Map<string, InventoryProduct>;
};

export function buildAssemblyContext(
  inputs: SuggestionGenerationInputs,
): AssemblyContext {
  return {
    language: normalizeLanguage(inputs.language ?? DEFAULT_LANGUAGE),
    lockedSteps: inputs.routineSteps
      .filter((step) => step.is_specialist_locked)
      .sort((a, b) => a.step_order - b.step_order),
    routineById: new Map(inputs.routineSteps.map((step) => [step.id, step])),
    activeProductById: new Map(
      inputs.shelfActiveProducts.map((product) => [product.id, product]),
    ),
    activeProductByName: new Map(
      inputs.shelfActiveProducts.map((product) => [
        productKey(product.brand, product.name),
        product,
      ]),
    ),
  };
}

export function resolveRawStep(
  rawStep: RawSuggestionStepResponse,
  index: number,
  context: AssemblyContext,
): SuggestionGenerationStepOutput | null {
  const routineSource = rawStep.routineStepId
    ? (context.routineById.get(rawStep.routineStepId) ?? null)
    : null;
  if (rawStep.routineStepId && !routineSource) return null;
  if (routineSource?.is_specialist_locked) {
    return routineStepToOutput(routineSource, routineSource.step_order, {
      language: context.language,
      explanation: rawStep.explanation ?? null,
      safetyWarnings: rawStep.safetyWarnings ?? [],
    });
  }

  const product = resolveActiveProduct(rawStep, context);
  const provenance = rawStep.provenance ?? SuggestionStepProvenance.AiAdded;
  if (provenance === SuggestionStepProvenance.AiAdded && !product) return null;
  if (rawStep.inventoryProductId && !product) return null;
  if (!product && rawStep.productBrand && rawStep.productName) return null;

  const sourceProduct = product ?? routineSource?.product ?? null;
  return {
    stepOrder: rawStep.stepOrder ?? index,
    routineStepId: routineSource?.id ?? rawStep.routineStepId ?? null,
    inventoryProductId: sourceProduct?.id ?? null,
    productBrand: sourceProduct?.brand ?? null,
    productName: sourceProduct?.name ?? null,
    stepLabel:
      sourceProduct?.category ??
      toStepLabel(rawStep.stepLabel ?? routineSource?.step_label),
    customLabel: rawStep.customLabel ?? routineSource?.custom_label ?? null,
    applicationMethod: toHumanApplicationMethod(
      rawStep.applicationMethod ??
        sourceProduct?.guidance?.applicationMethod ??
        null,
      context.language,
    ),
    quantity: toHumanQuantity(
      rawStep.quantity ?? sourceProduct?.guidance?.quantity ?? null,
      context.language,
    ),
    waitAfterMinutes:
      rawStep.waitAfterMinutes ?? sourceProduct?.guidance?.waitMinutes ?? null,
    explanation: sanitizeSuggestionText(rawStep.explanation ?? null, {
      maxLength: 140,
      maxSentences: 1,
    }),
    routineNote: normalizeRoutineNote(routineSource?.notes ?? null),
    provenance,
    chips: sanitizeChips(rawStep.chips ?? []),
    safetyWarnings: sanitizeSafetyFlags(rawStep.safetyWarnings ?? []),
  };
}

export function lockedStepsAreIntact(
  inputs: SuggestionGenerationInputs,
  rawSteps: RawSuggestionStepResponse[],
): boolean {
  const lockedSteps = inputs.routineSteps
    .filter((step) => step.is_specialist_locked)
    .sort((a, b) => a.step_order - b.step_order);
  const rawLocked = rawSteps
    .filter(
      (step) => step.provenance === SuggestionStepProvenance.SpecialistLocked,
    )
    .sort((a, b) => (a.stepOrder ?? 0) - (b.stepOrder ?? 0));
  if (rawLocked.length !== lockedSteps.length) return false;
  return lockedSteps.every((lockedStep, index) => {
    const rawStep = rawLocked[index];
    if (rawStep.routineStepId !== lockedStep.id) return false;
    if (
      rawStep.inventoryProductId &&
      rawStep.inventoryProductId !== lockedStep.inventory_product_id
    ) {
      return false;
    }
    return !(
      rawStep.stepLabel &&
      toStepLabel(rawStep.stepLabel) !== lockedStep.step_label
    );
  });
}

export function routineStepToOutput(
  step: RoutineStep,
  index: number,
  overrides?: {
    language?: AppLanguage;
    explanation?: string | null;
    safetyWarnings?: SuggestionSafetyFlagJson[];
  },
): SuggestionGenerationStepOutput {
  const language = normalizeLanguage(overrides?.language ?? DEFAULT_LANGUAGE);
  return {
    stepOrder: index,
    routineStepId: step.id,
    inventoryProductId: step.inventory_product_id,
    productBrand: step.product?.brand ?? null,
    productName: step.product?.name ?? null,
    stepLabel: step.step_label,
    customLabel: step.custom_label,
    applicationMethod: toHumanApplicationMethod(
      step.product?.guidance?.applicationMethod ?? null,
      language,
    ),
    quantity: toHumanQuantity(
      step.product?.guidance?.quantity ?? null,
      language,
    ),
    waitAfterMinutes: step.product?.guidance?.waitMinutes ?? null,
    explanation: sanitizeSuggestionText(overrides?.explanation ?? null, {
      maxLength: 140,
      maxSentences: 1,
    }),
    routineNote: normalizeRoutineNote(step.notes),
    provenance: step.is_specialist_locked
      ? SuggestionStepProvenance.SpecialistLocked
      : SuggestionStepProvenance.UserRoutine,
    chips: step.is_specialist_locked
      ? [{ tone: 'specialist', text: localizedSpecialistLocked(language) }]
      : [],
    safetyWarnings: sanitizeSafetyFlags(overrides?.safetyWarnings ?? []),
  };
}

function normalizeRoutineNote(note: string | null | undefined): string | null {
  if (typeof note !== 'string') return null;
  const trimmed = note.trim();
  return trimmed || null;
}

export function isAllSpecialistLocked(
  inputs: SuggestionGenerationInputs,
): boolean {
  return (
    inputs.routineSteps.length > 0 &&
    inputs.routineSteps.every((step) => step.is_specialist_locked)
  );
}

export function computeMode(
  steps: SuggestionGenerationStepOutput[],
  hasLockedInput: boolean,
): SuggestionMode {
  const hasAi = steps.some(
    (step) => step.provenance === SuggestionStepProvenance.AiAdded,
  );
  const hasManual = steps.some(
    (step) =>
      step.provenance === SuggestionStepProvenance.UserRoutine ||
      step.provenance === SuggestionStepProvenance.SpecialistLocked,
  );
  if (hasManual && hasAi) return SuggestionMode.Mixed;
  if (hasLockedInput || hasManual) return SuggestionMode.Manual;
  return SuggestionMode.Ai;
}

export function buildDeterministicSafetyFlags(
  inputs: SuggestionGenerationInputs,
  steps: SuggestionGenerationStepOutput[],
): SuggestionSafetyFlagJson[] {
  const language = normalizeLanguage(inputs.language ?? DEFAULT_LANGUAGE);
  const contextWithResolvedScores = {
    ...inputs.contextSummary,
    productScores: resolveSuggestionProductScores(inputs),
  };
  const flags: SuggestionSafetyFlagJson[] = buildPolicySafetyFlags(
    contextWithResolvedScores,
    steps,
    language,
  );
  if (
    hasPregnancyOrMedicationCaution(inputs) &&
    !flags.some((flag) => hasMedicalCautionText(flag.message))
  ) {
    flags.push({
      severity: 'info',
      message: localizedMedicalSafetyMessage(inputs, language),
      ingredientSlugs: [],
      sourceIds: [SuggestionEvidenceSourceId.DermNetTopicalRetinoids],
    });
  }
  return flags;
}

function hasPregnancyOrMedicationCaution(
  inputs: SuggestionGenerationInputs,
): boolean {
  return /(pregnan|breastfeed|trying|conceiv|medication)/i.test(
    JSON.stringify([
      inputs.skinProfile?.pregnancy_status ?? '',
      inputs.skinProfile?.safety_context?.conditions ?? [],
      inputs.skinProfile?.safety_context?.medications ?? [],
      inputs.skinProfile?.safety_context?.photosensitizing_other
        ? 'photosensitizing medication'
        : '',
      inputs.skinProfile?.under_dermatologist_care ?? '',
    ]),
  );
}

function hasPregnancyCaution(inputs: SuggestionGenerationInputs): boolean {
  return /(pregnan|breastfeed|trying|conceiv)/i.test(
    JSON.stringify([
      inputs.skinProfile?.pregnancy_status ?? '',
      inputs.skinProfile?.safety_context?.conditions ?? [],
    ]),
  );
}

function hasMedicalCautionText(value: string): boolean {
  return /\b(medication|medicacion|medicin|medicine|pregnan|embarazo|gravid|breastfeed|clinician|clinica|klinisk|specialist|doctor|prescrib)\b/i.test(
    value,
  );
}

function localizedSpecialistLocked(language: AppLanguage): string {
  return {
    en: 'Specialist locked',
    sv: 'Last av specialist',
    es: 'Bloqueado por especialista',
  }[language];
}

function localizedMedicalSafetyMessage(
  inputs: SuggestionGenerationInputs,
  language: AppLanguage,
): string {
  if (hasPregnancyCaution(inputs)) {
    return {
      en: 'Check active ingredients with your specialist during pregnancy or medication changes.',
      sv: 'Stam av aktiva ingredienser med din specialist vid graviditet eller medicinbyte.',
      es: 'Consulta los activos con tu especialista durante el embarazo o cambios de medicacion.',
    }[language];
  }
  return {
    en: 'Check active ingredients with your specialist during medication changes.',
    sv: 'Stam av aktiva ingredienser med din specialist vid medicinbyte.',
    es: 'Consulta los activos con tu especialista durante cambios de medicacion.',
  }[language];
}

export function sanitizeExplanation(
  explanation: SuggestionExplanationJson,
): SuggestionExplanationJson {
  return {
    headline:
      sanitizeSuggestionText(explanation.headline, {
        maxLength: 80,
        maxSentences: 1,
      }) ?? '',
    body: explanation.body.map(
      (value) =>
        sanitizeSuggestionText(value, {
          maxLength: 160,
          maxSentences: 1,
        }) ?? '',
    ),
    perStepReasons: explanation.perStepReasons.map((reason) => ({
      stepOrder: reason.stepOrder,
      reason:
        sanitizeSuggestionText(reason.reason, {
          maxLength: 140,
          maxSentences: 1,
        }) ?? '',
    })),
    skipped: explanation.skipped.map((item) => ({
      name: sanitizeSuggestionText(item.name, { maxLength: 80 }) ?? '',
      reason:
        sanitizeSuggestionText(item.reason, {
          maxLength: 140,
          maxSentences: 1,
        }) ?? '',
    })),
    inputs: explanation.inputs.map((input) => ({
      label: sanitizeSuggestionText(input.label, { maxLength: 40 }) ?? '',
      detail:
        sanitizeSuggestionText(input.detail, {
          maxLength: 120,
          maxSentences: 1,
        }) ?? '',
    })),
  };
}

export function sanitizeGapRecommendations(
  gaps: SuggestionGapRecommendationJson[],
): SuggestionGapRecommendationJson[] {
  return gaps
    .map((gap) => ({
      ingredientOrCategory:
        sanitizeSuggestionText(gap.ingredientOrCategory, { maxLength: 80 }) ??
        '',
      reason:
        sanitizeSuggestionText(gap.reason, {
          maxLength: 150,
          maxSentences: 1,
        }) ?? '',
      budgetTier: gap.budgetTier,
      goalAlignment: sanitizeSuggestionText(gap.goalAlignment, {
        maxLength: 80,
        maxSentences: 1,
      }),
      sourceIds: mergeEvidenceSourceIds(gap.sourceIds ?? []),
    }))
    .filter((gap) => !isNoOpGapRecommendation(gap));
}

export function sanitizeSafetyFlags(
  flags: SuggestionSafetyFlagJson[],
): SuggestionSafetyFlagJson[] {
  return flags.map((flag) => ({
    severity: flag.severity,
    message:
      sanitizeSuggestionText(flag.message, {
        maxLength: 160,
        maxSentences: 1,
      }) ?? '',
    ingredientSlugs: flag.ingredientSlugs ?? [],
    sourceIds: mergeEvidenceSourceIds(flag.sourceIds ?? []),
  }));
}

function resolveActiveProduct(
  rawStep: RawSuggestionStepResponse,
  context: AssemblyContext,
): InventoryProduct | null {
  if (rawStep.inventoryProductId) {
    return context.activeProductById.get(rawStep.inventoryProductId) ?? null;
  }
  if (rawStep.productBrand && rawStep.productName) {
    return (
      context.activeProductByName.get(
        productKey(rawStep.productBrand, rawStep.productName),
      ) ?? null
    );
  }
  return null;
}

function isNoOpGapRecommendation(
  gap: SuggestionGapRecommendationJson,
): boolean {
  return /^(none|n\/a|nothing|no gap|no gaps)$/i.test(
    gap.ingredientOrCategory.trim(),
  );
}

function toStepLabel(value: string | null | undefined): StepLabel {
  return STEP_LABELS.includes(value as StepLabel)
    ? (value as StepLabel)
    : 'custom';
}

function sanitizeChips(
  chips: SuggestionStepChipJson[],
): SuggestionStepChipJson[] {
  return chips.map((chip) => ({
    tone: chip.tone,
    text:
      sanitizeSuggestionText(chip.text, {
        maxLength: 32,
        maxSentences: 1,
      }) ?? '',
  }));
}

function productKey(brand: string, name: string): string {
  return `${brand}|${name}`.trim().toLowerCase();
}

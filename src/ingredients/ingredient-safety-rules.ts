import {
  AnalysisSeverity,
  IngredientCategory,
  type ConflictRule,
} from './ingredients.types';

export const INGREDIENT_CATEGORY_CONFLICT_RULES: ConflictRule[] = [
  {
    code: 'RETINOID_AHA',
    severity: AnalysisSeverity.High,
    left: { categories: [IngredientCategory.Retinoid] },
    right: { categories: [IngredientCategory.Aha] },
    descriptionEn:
      'Retinoids and alpha hydroxy acids in the same routine can raise irritation and barrier stress.',
    mitigationEn: 'Use them on alternate nights or separate them by routine.',
  },
  {
    code: 'RETINOID_BHA',
    severity: AnalysisSeverity.High,
    left: { categories: [IngredientCategory.Retinoid] },
    right: { categories: [IngredientCategory.Bha] },
    descriptionEn:
      'Retinoids and beta hydroxy acids together can be too aggressive for many routines.',
    mitigationEn: 'Alternate use and keep barrier support in the routine.',
  },
  {
    code: 'RETINOID_PHA',
    severity: AnalysisSeverity.Medium,
    left: { categories: [IngredientCategory.Retinoid] },
    right: { categories: [IngredientCategory.Pha] },
    descriptionEn:
      'Retinoids and exfoliating acids together can increase dryness or sensitivity.',
    mitigationEn: 'Use cautiously, especially if your skin is reactive.',
  },
  {
    code: 'BENZOYL_PEROXIDE_RETINOID',
    severity: AnalysisSeverity.High,
    left: { categories: [IngredientCategory.BenzoylPeroxide] },
    right: { categories: [IngredientCategory.Retinoid] },
    descriptionEn:
      'Benzoyl peroxide and retinoids can raise irritation when layered in the same routine.',
    mitigationEn: 'Separate them by time of day or alternate nights.',
  },
  {
    code: 'AHA_BHA',
    severity: AnalysisSeverity.Medium,
    left: { categories: [IngredientCategory.Aha] },
    right: { categories: [IngredientCategory.Bha] },
    descriptionEn:
      'Multiple exfoliating acid categories can increase cumulative exfoliation.',
    mitigationEn: 'Keep frequency modest and avoid stacking on sensitive days.',
  },
  {
    code: 'AHA_PHA',
    severity: AnalysisSeverity.Low,
    left: { categories: [IngredientCategory.Aha] },
    right: { categories: [IngredientCategory.Pha] },
    descriptionEn:
      'Multiple exfoliating acid categories can add up, even when one is gentler.',
    mitigationEn:
      'Reduce frequency if dryness, stinging, or tightness appears.',
  },
  {
    code: 'BHA_PHA',
    severity: AnalysisSeverity.Low,
    left: { categories: [IngredientCategory.Bha] },
    right: { categories: [IngredientCategory.Pha] },
    descriptionEn:
      'Multiple exfoliating acid categories can add up in one routine.',
    mitigationEn: 'Reduce frequency if irritation appears.',
  },
  {
    code: 'BPO_AHA',
    severity: AnalysisSeverity.Medium,
    left: { categories: [IngredientCategory.BenzoylPeroxide] },
    right: { categories: [IngredientCategory.Aha] },
    descriptionEn:
      'Benzoyl peroxide and exfoliating acids can be drying or irritating together.',
    mitigationEn: 'Separate them or reduce frequency.',
  },
  {
    code: 'BPO_BHA',
    severity: AnalysisSeverity.Medium,
    left: { categories: [IngredientCategory.BenzoylPeroxide] },
    right: { categories: [IngredientCategory.Bha] },
    descriptionEn:
      'Benzoyl peroxide and salicylic-style exfoliation can increase dryness.',
    mitigationEn: 'Separate them or reduce frequency.',
  },
  {
    code: 'BPO_VITAMIN_C',
    severity: AnalysisSeverity.Medium,
    left: { categories: [IngredientCategory.BenzoylPeroxide] },
    right: { categories: [IngredientCategory.VitaminC] },
    descriptionEn:
      'Benzoyl peroxide and vitamin C can be an unstable or irritating pairing.',
    mitigationEn:
      'Use vitamin C in the morning and benzoyl peroxide separately.',
  },
  {
    code: 'VITAMIN_C_AHA',
    severity: AnalysisSeverity.Medium,
    left: { categories: [IngredientCategory.VitaminC] },
    right: { categories: [IngredientCategory.Aha] },
    descriptionEn:
      'Vitamin C and exfoliating alpha hydroxy acids can increase same-routine irritation risk.',
    mitigationEn:
      'Use vitamin C and alpha hydroxy acids in separate routines if sensitivity, stinging, or dryness appears.',
    onlyWhenVitaminCIsPhSensitive: true,
  },
  {
    code: 'RETINOID_VITAMIN_C',
    severity: AnalysisSeverity.Medium,
    left: { categories: [IngredientCategory.Retinoid] },
    right: { categories: [IngredientCategory.VitaminC] },
    descriptionEn:
      'Retinoids and low-pH vitamin C can stack irritation in the same routine.',
    mitigationEn: 'Use vitamin C in the morning and retinoids in the evening.',
    onlyWhenVitaminCIsPhSensitive: true,
  },
  {
    code: 'VITAMIN_C_NIACINAMIDE',
    severity: AnalysisSeverity.Medium,
    left: { categories: [IngredientCategory.VitaminC] },
    right: { categories: [IngredientCategory.Niacinamide] },
    descriptionEn:
      'Low-pH vitamin C can be less comfortable when layered with niacinamide for some users.',
    mitigationEn:
      'Split them between routines if stinging or flushing appears.',
    onlyWhenVitaminCIsPhSensitive: true,
  },
  {
    code: 'HYDROQUINONE_EXFOLIATING_ACID',
    severity: AnalysisSeverity.High,
    left: { categories: [IngredientCategory.Hydroquinone] },
    right: {
      categories: [
        IngredientCategory.Aha,
        IngredientCategory.Bha,
        IngredientCategory.Pha,
      ],
    },
    descriptionEn:
      'Hydroquinone-style brightening and exfoliating acids can be high irritation risk.',
    mitigationEn:
      'Use only with professional guidance and strong sun protection.',
  },
  {
    code: 'HYDROQUINONE_RETINOID',
    severity: AnalysisSeverity.High,
    left: { categories: [IngredientCategory.Hydroquinone] },
    right: { categories: [IngredientCategory.Retinoid] },
    descriptionEn:
      'Hydroquinone-style brightening and retinoids can be high irritation risk.',
    mitigationEn:
      'Use only with professional guidance and strong sun protection.',
  },
  {
    code: 'AZELAIC_EXFOLIATING_ACID',
    severity: AnalysisSeverity.Medium,
    left: { categories: [IngredientCategory.AzelaicAcid] },
    right: {
      categories: [
        IngredientCategory.Aha,
        IngredientCategory.Bha,
        IngredientCategory.Pha,
      ],
    },
    descriptionEn:
      'Azelaic acid and exfoliating acids can increase tingling or dryness.',
    mitigationEn: 'Separate routines if the skin feels reactive.',
  },
  {
    code: 'PEPTIDE_LOW_PH_ACID',
    severity: AnalysisSeverity.Low,
    left: { categories: [IngredientCategory.Peptide] },
    right: {
      categories: [IngredientCategory.Aha, IngredientCategory.VitaminC],
    },
    descriptionEn:
      'Some peptides may be less useful or less comfortable in low-pH acid routines.',
    mitigationEn: 'Use peptides in a separate, calmer routine if needed.',
    onlyWhenVitaminCIsPhSensitive: true,
  },
  {
    code: 'MINERAL_CHEMICAL_SPF',
    severity: AnalysisSeverity.Low,
    left: { categories: [IngredientCategory.MineralSpf] },
    right: { categories: [IngredientCategory.ChemicalSpf] },
    descriptionEn:
      'Mixed sunscreen filter types are common, but confirm the product is meant to be used as a complete sunscreen.',
    mitigationEn:
      'Do not DIY mix sunscreens; use finished SPF products as directed.',
  },
];

export function defaultOverlapSeverityForCategory(
  category: IngredientCategory,
): AnalysisSeverity {
  if (
    [
      IngredientCategory.Retinoid,
      IngredientCategory.Aha,
      IngredientCategory.Bha,
      IngredientCategory.BenzoylPeroxide,
      IngredientCategory.Hydroquinone,
    ].includes(category)
  ) {
    return AnalysisSeverity.High;
  }

  if (
    [
      IngredientCategory.Pha,
      IngredientCategory.VitaminC,
      IngredientCategory.AzelaicAcid,
      IngredientCategory.TyrosinaseInhibitor,
    ].includes(category)
  ) {
    return AnalysisSeverity.Medium;
  }

  return AnalysisSeverity.Low;
}

export function applyCategorySafetyDefaults(input: {
  category: IngredientCategory;
  phSensitive: boolean;
  photosensitizing: boolean;
  requiresSpf: boolean;
  irritationRisk: boolean;
  overlapSeverity: AnalysisSeverity;
}): {
  phSensitive: boolean;
  photosensitizing: boolean;
  requiresSpf: boolean;
  irritationRisk: boolean;
  overlapSeverity: AnalysisSeverity;
} {
  const exfoliatingCategory = [
    IngredientCategory.Aha,
    IngredientCategory.Bha,
    IngredientCategory.Pha,
  ].includes(input.category);
  const highIrritationCategory = [
    IngredientCategory.Retinoid,
    IngredientCategory.BenzoylPeroxide,
    IngredientCategory.Hydroquinone,
    IngredientCategory.Sulphur,
  ].includes(input.category);
  const photosensitizingCategory = [
    IngredientCategory.Retinoid,
    IngredientCategory.Aha,
    IngredientCategory.Pha,
    IngredientCategory.Hydroquinone,
  ].includes(input.category);

  return {
    phSensitive: input.phSensitive || input.category === IngredientCategory.Aha,
    photosensitizing:
      input.photosensitizing || photosensitizingCategory || exfoliatingCategory,
    requiresSpf:
      input.requiresSpf || photosensitizingCategory || exfoliatingCategory,
    irritationRisk:
      input.irritationRisk || highIrritationCategory || exfoliatingCategory,
    overlapSeverity:
      input.overlapSeverity ??
      defaultOverlapSeverityForCategory(input.category),
  };
}

export function categorySummary(
  displayName: string,
  category: IngredientCategory,
): string {
  return `${displayName} was classified for routine safety as ${category}.`;
}

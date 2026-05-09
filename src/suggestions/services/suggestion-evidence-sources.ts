import {
  SuggestionEvidenceSourceId,
  SuggestionEvidenceSourceJson,
} from '../suggestions.constants';

const REVIEWED_AT = '2026-05-04';

const EVIDENCE_SOURCES: Record<
  SuggestionEvidenceSourceId,
  SuggestionEvidenceSourceJson
> = {
  [SuggestionEvidenceSourceId.AadSunscreenSelection]: {
    id: SuggestionEvidenceSourceId.AadSunscreenSelection,
    title: 'How to select a sunscreen',
    organization: 'American Academy of Dermatology',
    url: 'https://www.aad.org/public/everyday-care/sun-protection/shade-clothing-sunscreen/how-to-select-sunscreen',
    evidenceType: 'dermatology_association',
    summary:
      'Use broad-spectrum sunscreen with SPF 30 or higher; water resistance matters when sweating or swimming.',
    reviewedAt: REVIEWED_AT,
  },
  [SuggestionEvidenceSourceId.AadRetinoidRetinol]: {
    id: SuggestionEvidenceSourceId.AadRetinoidRetinol,
    title: 'Retinoid or retinol?',
    organization: 'American Academy of Dermatology',
    url: 'https://www.aad.org/public/everyday-care/skin-care-secrets/anti-aging/retinoid-retinol',
    evidenceType: 'dermatology_association',
    summary:
      'Retinoids are typically introduced slowly at night, with daytime sun protection and attention to irritation.',
    reviewedAt: REVIEWED_AT,
  },
  [SuggestionEvidenceSourceId.AadAcneTreatment]: {
    id: SuggestionEvidenceSourceId.AadAcneTreatment,
    title: 'Acne: Diagnosis and treatment',
    organization: 'American Academy of Dermatology',
    url: 'https://www.aad.org/public/diseases/acne/derm-treat/treat',
    evidenceType: 'dermatology_association',
    summary:
      'Common acne-supporting actives include salicylic acid, benzoyl peroxide, azelaic acid, and retinoids; irritation risk still matters.',
    reviewedAt: REVIEWED_AT,
  },
  [SuggestionEvidenceSourceId.FdaAhaSunSensitivity]: {
    id: SuggestionEvidenceSourceId.FdaAhaSunSensitivity,
    title: 'Labeling for Cosmetics Containing Alpha Hydroxy Acids',
    organization: 'U.S. Food and Drug Administration',
    url: 'https://www.fda.gov/regulatory-information/search-fda-guidance-documents/guidance-industry-labeling-cosmetics-containing-alpha-hydroxy-acids',
    evidenceType: 'regulatory_guidance',
    summary:
      'AHA products may increase sun sensitivity during use and for up to one week after stopping; sunscreen and sun-limiting behavior are recommended.',
    reviewedAt: REVIEWED_AT,
  },
  [SuggestionEvidenceSourceId.MayoDrySkinCare]: {
    id: SuggestionEvidenceSourceId.MayoDrySkinCare,
    title: 'Dry skin: Diagnosis and treatment',
    organization: 'Mayo Clinic',
    url: 'https://www.mayoclinic.org/diseases-conditions/dry-skin/diagnosis-treatment/drc-20353891',
    evidenceType: 'clinical_reference',
    summary:
      'Barrier-supportive routines emphasize moisturizer, fragrance-free noncomedogenic products, and broad-spectrum SPF 30 or higher.',
    reviewedAt: REVIEWED_AT,
  },
  [SuggestionEvidenceSourceId.DermNetTopicalRetinoids]: {
    id: SuggestionEvidenceSourceId.DermNetTopicalRetinoids,
    title: 'Topical retinoids',
    organization: 'DermNet',
    url: 'https://dermnetnz.org/topics/topical-retinoids',
    evidenceType: 'clinical_reference',
    summary:
      'Topical retinoids can be drying, may worsen eczema, and are commonly applied at night with daytime sunscreen and moisturizer support.',
    reviewedAt: REVIEWED_AT,
  },
  [SuggestionEvidenceSourceId.NationalEczemaSocietyHardWater]: {
    id: SuggestionEvidenceSourceId.NationalEczemaSocietyHardWater,
    title: 'SOFTER trial: hard water and eczema',
    organization: 'National Eczema Society',
    url: 'https://eczema.org/research/eczema-research-initiatives/softer/',
    evidenceType: 'clinical_reference',
    summary:
      'Hard-water exposure can affect skin barrier comfort for some sensitive users; gentle cleansing and moisturizing support are reasonable non-diagnostic guidance.',
    reviewedAt: REVIEWED_AT,
  },
  [SuggestionEvidenceSourceId.OpenMeteoWeather]: {
    id: SuggestionEvidenceSourceId.OpenMeteoWeather,
    title: 'Weather Forecast API',
    organization: 'Open-Meteo',
    url: 'https://open-meteo.com/en/docs',
    evidenceType: 'environmental_data_provider',
    summary:
      'Weather forecast data provides temperature, relative humidity, weather code, and UV context for city-level routine adaptation.',
    reviewedAt: REVIEWED_AT,
  },
  [SuggestionEvidenceSourceId.OpenMeteoAirQuality]: {
    id: SuggestionEvidenceSourceId.OpenMeteoAirQuality,
    title: 'Air Quality API',
    organization: 'Open-Meteo',
    url: 'https://open-meteo.com/en/docs/air-quality-api',
    evidenceType: 'environmental_data_provider',
    summary:
      'Air-quality data provides European AQI, particulate matter, UV, and pollen context for city-level routine adaptation.',
    reviewedAt: REVIEWED_AT,
  },
  [SuggestionEvidenceSourceId.OpenMeteoSeasonalForecast]: {
    id: SuggestionEvidenceSourceId.OpenMeteoSeasonalForecast,
    title: 'Seasonal Forecast API',
    organization: 'Open-Meteo',
    url: 'https://open-meteo.com/en/docs/seasonal-forecast-api',
    evidenceType: 'environmental_data_provider',
    summary:
      'Seasonal forecast data provides broad transition signals, used only for gentle routine-preparation guidance.',
    reviewedAt: REVIEWED_AT,
  },
};

export function getSuggestionEvidenceSources(
  sourceIds: readonly SuggestionEvidenceSourceId[],
): SuggestionEvidenceSourceJson[] {
  return mergeEvidenceSourceIds(sourceIds).map((sourceId) => ({
    ...EVIDENCE_SOURCES[sourceId],
  }));
}

export function sourceIdsForActiveTags(
  activeTags: readonly string[],
): SuggestionEvidenceSourceId[] {
  const sourceIds: SuggestionEvidenceSourceId[] = [];
  if (activeTags.includes('spf')) {
    sourceIds.push(SuggestionEvidenceSourceId.AadSunscreenSelection);
  }
  if (activeTags.includes('retinoid')) {
    sourceIds.push(
      SuggestionEvidenceSourceId.AadRetinoidRetinol,
      SuggestionEvidenceSourceId.DermNetTopicalRetinoids,
    );
  }
  if (activeTags.includes('aha')) {
    sourceIds.push(SuggestionEvidenceSourceId.FdaAhaSunSensitivity);
  }
  if (
    activeTags.some((tag) =>
      ['bha', 'benzoyl_peroxide', 'azelaic_acid'].includes(tag),
    )
  ) {
    sourceIds.push(SuggestionEvidenceSourceId.AadAcneTreatment);
  }
  if (
    activeTags.some((tag) =>
      ['ceramide', 'humectant', 'barrier_support'].includes(tag),
    )
  ) {
    sourceIds.push(SuggestionEvidenceSourceId.MayoDrySkinCare);
  }
  return mergeEvidenceSourceIds(sourceIds);
}

export function mergeEvidenceSourceIds(
  ...groups: readonly (readonly SuggestionEvidenceSourceId[])[]
): SuggestionEvidenceSourceId[] {
  const seen = new Set<SuggestionEvidenceSourceId>();
  const merged: SuggestionEvidenceSourceId[] = [];
  for (const group of groups) {
    for (const sourceId of group) {
      if (seen.has(sourceId)) continue;
      seen.add(sourceId);
      merged.push(sourceId);
    }
  }
  return merged;
}

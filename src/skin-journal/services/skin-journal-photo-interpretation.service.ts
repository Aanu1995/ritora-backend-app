import { Injectable } from '@nestjs/common';
import type {
  AnalysisConcern,
  AnalysisObservations,
  AnalysisRoutineContext,
  AnalysisSafetyReason,
  AnalysisSkinContext,
  EventSeverity,
  PhotoAnalysisGuidanceActionCode,
  PhotoAnalysisGuidanceAvoidCode,
  PhotoAnalysisGuidanceFactorCode,
  PhotoAnalysisConcernGuidance,
  PhotoAnalysisInterpretation,
  PhotoAnalysisInterpretationCode,
  PhotoAnalysisReadingQuality,
  PhotoAnalysisSourceCitation,
  PhotoAnalysisTextRef,
  RecentChangePayload,
} from '../skin-journal.constants';

const PHOTO_INTERPRETATION_VERSION = '1.1' as const;
const LAST_VERIFIED = '2026-05-01';
const FORBIDDEN_GENERATED_GUIDANCE_LANGUAGE =
  /\b(diagnose|diagnosis|treat|treatment|cure|prescribe|stop all|stop every|immediately stop|discontinue|prescribed|prescription|medicine|medication|proves?|confirmed cause|caused|caused by|is causing|are causing|was caused by|were caused by|the cause|must avoid|never eat|eliminate all|guaranteed|guarantee)\b/i;
const AI_STYLE_PUNCTUATION = /[-—–]/;
const RETINOID_KEYWORDS = [
  'retinol',
  'retinoid',
  'tretinoin',
  'adapalene',
  'retinal',
  'retinaldehyde',
] as const;
const EXFOLIANT_KEYWORDS = [
  'acid',
  'aha',
  'bha',
  'glycolic',
  'lactic',
  'salicylic',
  'mandelic',
  'exfoliant',
  'peel',
] as const;
const BENZOYL_PEROXIDE_KEYWORDS = ['benzoyl peroxide', 'bpo'] as const;
const ACNE_DIET_NOTE_KEYWORDS = [
  'milk',
  'dairy',
  'cheese',
  'yogurt',
  'ice cream',
  'sugar',
  'sugary',
  'sweet',
  'sweets',
  'chocolate',
  'soda',
  'juice',
  'white bread',
  'pasta',
  'late eating',
  'late-night',
  'late night',
  'midnight snack',
  'snack before bed',
  'before bed',
] as const;
const ACNE_CONTEXT_KEYWORDS = [
  'acne',
  'adapalene',
  'benzoyl peroxide',
  'breakout',
  'bpo',
  'cleanser',
  'pimple',
  'spot',
  'retinoid',
  'retinol',
  'salicylic',
  'comedone',
  'whitehead',
  'blackhead',
  'blemish',
  'jawline',
] as const;
const PIGMENT_CONTEXT_KEYWORDS = [
  'pigment',
  'dark mark',
  'dark spot',
  'hyperpigmentation',
  'uneven tone',
  'tone',
  'spf',
  'sunscreen',
  'sun screen',
  'vitamin c',
  'azelaic',
  'brighten',
] as const;
const OIL_PORE_CONTEXT_KEYWORDS = [
  'oil',
  'oily',
  'shine',
  'shiny',
  'pore',
  'pores',
  'sebum',
  'cleanser',
  'salicylic',
  'bha',
  'niacinamide',
  'clay',
  'mattifying',
] as const;
const BARRIER_CONTEXT_KEYWORDS = [
  'dry',
  'dryness',
  'tight',
  'sting',
  'stinging',
  'burn',
  'burning',
  'red',
  'redness',
  'irritation',
  'irritated',
  'sensitive',
  'flaking',
  'peeling',
  'barrier',
  'benzoyl peroxide',
  'bpo',
  'acid',
  'exfoliant',
  'moisturizer',
  'moisturiser',
  'retinoid',
  'retinol',
  'ceramide',
  'cream',
] as const;
const TEXTURE_CONTEXT_KEYWORDS = [
  'texture',
  'rough',
  'bumpy',
  'bumps',
  'fine line',
  'wrinkle',
  'retinol',
  'retinoid',
  'exfoliant',
  'acid',
] as const;
const UNDER_EYE_CONTEXT_KEYWORDS = [
  'under eye',
  'undereye',
  'dark circle',
  'eye bag',
  'sleep',
] as const;

type AnalysisProductForKeywordSearch = Pick<
  AnalysisRoutineContext['active_shelf_products'][number],
  | 'brand'
  | 'name'
  | 'category'
  | 'step_label'
  | 'ingredient_preview'
  | 'guidance_cautions'
  | 'guidance_steps'
  | 'benefit_tags'
  | 'suited_for_tags'
  | 'user_product_note'
>;

type AnalysisApplicationItemForKeywordSearch =
  AnalysisRoutineContext['recent_applications'][number]['items'][number];
const CONTEXT_KEYWORDS_BY_CONCERN: Record<AnalysisConcern, readonly string[]> =
  {
    acne: ACNE_CONTEXT_KEYWORDS,
    hyperpigmentation: PIGMENT_CONTEXT_KEYWORDS,
    redness_inflammation: BARRIER_CONTEXT_KEYWORDS,
    texture: TEXTURE_CONTEXT_KEYWORDS,
    oiliness: OIL_PORE_CONTEXT_KEYWORDS,
    dryness: BARRIER_CONTEXT_KEYWORDS,
    fine_lines: TEXTURE_CONTEXT_KEYWORDS,
    skin_barrier_damage: BARRIER_CONTEXT_KEYWORDS,
    eczema_indicator: BARRIER_CONTEXT_KEYWORDS,
    uneven_tone: PIGMENT_CONTEXT_KEYWORDS,
    under_eye_darkness: UNDER_EYE_CONTEXT_KEYWORDS,
    large_pores: OIL_PORE_CONTEXT_KEYWORDS,
  };

interface PhotoAnalysisInterpretationContext {
  skinContext?: AnalysisSkinContext | null;
  recentChange?: RecentChangePayload | null;
  routineContext?: AnalysisRoutineContext | null;
}

type ContextSignals = {
  factorKeys: PhotoAnalysisTextRef[];
  sourceIds: string[];
};

const FACTOR_CODE_KEY_CANDIDATES: Record<
  PhotoAnalysisGuidanceFactorCode,
  readonly string[]
> = {
  check_in_oiliness: ['journal.analysis.guidance.factors.checkInOiliness'],
  check_in_irritation: ['journal.analysis.guidance.factors.checkInIrritation'],
  check_in_sun: ['journal.analysis.guidance.factors.checkInSun'],
  check_in_sweat: ['journal.analysis.guidance.factors.checkInSweat'],
  check_in_stress: ['journal.analysis.guidance.factors.checkInStress'],
  check_in_sleep: ['journal.analysis.guidance.factors.checkInSleep'],
  check_in_feel: ['journal.analysis.guidance.factors.checkInFeel'],
  note_diet_acne: ['journal.analysis.guidance.factors.noteDietAcne'],
  recent_product_change: [
    'journal.analysis.guidance.factors.recentProductChangeNamed',
  ],
  recent_routine_change: [
    'journal.analysis.guidance.factors.recentRoutineChange',
  ],
  routine_product_timing: [
    'journal.analysis.guidance.factors.routineProductTiming',
  ],
  active_ingredient_timing: [
    'journal.analysis.guidance.factors.activeIngredientTiming',
  ],
  sunscreen_context: ['journal.analysis.guidance.factors.sunscreenContext'],
  recent_application_change: [
    'journal.analysis.guidance.factors.recentApplicationChange',
  ],
  acne_common_contributors: [
    'journal.analysis.guidance.factors.acneCommonContributors',
  ],
  pigment_common_contributors: [
    'journal.analysis.guidance.factors.pigmentCommonContributors',
  ],
  oil_pore_common_contributors: [
    'journal.analysis.guidance.factors.oilPoreCommonContributors',
  ],
  barrier_common_contributors: [
    'journal.analysis.guidance.factors.barrierCommonContributors',
  ],
  appearance_common_contributors: [
    'journal.analysis.guidance.factors.appearanceCommonContributors',
  ],
  general_common_contributors: [
    'journal.analysis.guidance.factors.generalCommonContributors',
  ],
};

const ACTION_CODE_TO_KEY: Record<PhotoAnalysisGuidanceActionCode, string> = {
  acne_steady_routine: 'journal.analysis.guidance.actions.acneSteadyRoutine',
  non_comedogenic: 'journal.analysis.guidance.actions.nonComedogenic',
  log_clusters: 'journal.analysis.guidance.actions.logClusters',
  spf_context: 'journal.analysis.guidance.actions.spfContext',
  prevent_irritation: 'journal.analysis.guidance.actions.preventIrritation',
  same_light: 'journal.analysis.guidance.actions.sameLight',
  gentle_cleanse: 'journal.analysis.guidance.actions.gentleCleanse',
  oil_free_when_possible:
    'journal.analysis.guidance.actions.oilFreeWhenPossible',
  watch_shine_pattern: 'journal.analysis.guidance.actions.watchShinePattern',
  simplify_routine: 'journal.analysis.guidance.actions.simplifyRoutine',
  moisturizer_support: 'journal.analysis.guidance.actions.moisturizerSupport',
  watch_comfort: 'journal.analysis.guidance.actions.watchComfort',
  watch_pattern: 'journal.analysis.guidance.actions.watchPattern',
};

const AVOID_CODE_TO_KEY: Record<PhotoAnalysisGuidanceAvoidCode, string> = {
  multiple_new_actives: 'journal.analysis.guidance.avoid.multipleNewActives',
  picking_or_squeezing: 'journal.analysis.guidance.avoid.picking',
  logged_diet_pattern: 'journal.analysis.guidance.avoid.dietPatternIfLogged',
  sweat_friction_after_exercise:
    'journal.analysis.guidance.avoid.sweatFrictionAfterExercise',
  pore_clogging_products:
    'journal.analysis.guidance.avoid.poreCloggingProducts',
  inconsistent_spf: 'journal.analysis.guidance.avoid.inconsistentSpf',
  irritating_scrubs: 'journal.analysis.guidance.avoid.irritatingScrubs',
  stripping_skin: 'journal.analysis.guidance.avoid.strippingSkin',
  over_exfoliation_for_pores: 'journal.analysis.guidance.avoid.overExfoliation',
  adding_actives_while_stressed:
    'journal.analysis.guidance.avoid.addingActives',
  fragrance_if_sensitive:
    'journal.analysis.guidance.avoid.fragranceIfSensitive',
  known_irritant_reexposure:
    'journal.analysis.guidance.avoid.knownIrritantReexposure',
};

const SUMMARY_KEY_BY_CODE: Record<PhotoAnalysisInterpretationCode, string> = {
  retake_needed: 'journal.analysis.interpretation.retakeNeeded.summary',
  urgent_review: 'journal.analysis.interpretation.urgentReview.summary',
  professional_review:
    'journal.analysis.interpretation.professionalReview.summary',
  barrier_support: 'journal.analysis.interpretation.barrierSupport.summary',
  acne_progress_timing:
    'journal.analysis.interpretation.acneProgressTiming.summary',
  hyperpigmentation_tracking:
    'journal.analysis.interpretation.hyperpigmentationTracking.summary',
  retinoid_irritation_context:
    'journal.analysis.interpretation.retinoidIrritationContext.summary',
  stable_baseline: 'journal.analysis.interpretation.stableBaseline.summary',
};

const GUIDANCE_KEY_BY_CODE: Record<PhotoAnalysisInterpretationCode, string> = {
  retake_needed: 'journal.analysis.interpretation.retakeNeeded.guidance',
  urgent_review: 'journal.analysis.interpretation.urgentReview.guidance',
  professional_review:
    'journal.analysis.interpretation.professionalReview.guidance',
  barrier_support: 'journal.analysis.interpretation.barrierSupport.guidance',
  acne_progress_timing:
    'journal.analysis.interpretation.acneProgressTiming.guidance',
  hyperpigmentation_tracking:
    'journal.analysis.interpretation.hyperpigmentationTracking.guidance',
  retinoid_irritation_context:
    'journal.analysis.interpretation.retinoidIrritationContext.guidance',
  stable_baseline: 'journal.analysis.interpretation.stableBaseline.guidance',
};

const NOT_DIAGNOSIS_CAVEAT =
  'journal.analysis.interpretation.caveats.notDiagnosis';
const QUALITY_LIMITED_CAVEAT =
  'journal.analysis.interpretation.caveats.qualityLimited';
const CORRELATION_CAVEAT =
  'journal.analysis.interpretation.caveats.progressNeedsTime';

const PHOTO_SOURCES: Record<string, PhotoAnalysisSourceCitation> = {
  aad_skin_photo_quality: {
    id: 'aad_skin_photo_quality',
    title_key: 'journal.analysis.sources.aad_skin_photo_quality.title',
    organization: 'American Academy of Dermatology',
    summary_key: 'journal.analysis.sources.aad_skin_photo_quality.summary',
    url: 'https://www.aad.org/public/fad/digital-health/taking-pictures-skin',
    evidence_grade: 'moderate',
    last_verified: LAST_VERIFIED,
  },
  aad_acne_treatment_timing: {
    id: 'aad_acne_treatment_timing',
    title_key: 'journal.analysis.sources.aad_acne_treatment_timing.title',
    organization: 'American Academy of Dermatology',
    summary_key: 'journal.analysis.sources.aad_acne_treatment_timing.summary',
    url: 'https://www.aad.org/public/diseases/acne/derm-treat/treat',
    evidence_grade: 'moderate',
    last_verified: LAST_VERIFIED,
  },
  aad_acne_skin_care_tips: {
    id: 'aad_acne_skin_care_tips',
    title_key: 'journal.analysis.sources.aad_acne_skin_care_tips.title',
    organization: 'American Academy of Dermatology',
    summary_key: 'journal.analysis.sources.aad_acne_skin_care_tips.summary',
    url: 'https://www.aad.org/public/diseases/acne/skin-care/tips',
    evidence_grade: 'moderate',
    last_verified: LAST_VERIFIED,
  },
  aad_acne_causes: {
    id: 'aad_acne_causes',
    title_key: 'journal.analysis.sources.aad_acne_causes.title',
    organization: 'American Academy of Dermatology',
    summary_key: 'journal.analysis.sources.aad_acne_causes.summary',
    url: 'https://www.aad.org/public/diseases/acne/causes',
    evidence_grade: 'moderate',
    last_verified: LAST_VERIFIED,
  },
  aad_dark_spots_skin_tones: {
    id: 'aad_dark_spots_skin_tones',
    title_key: 'journal.analysis.sources.aad_dark_spots_skin_tones.title',
    organization: 'American Academy of Dermatology',
    summary_key: 'journal.analysis.sources.aad_dark_spots_skin_tones.summary',
    url: 'https://www.aad.org/public/everyday-care/skin-care-secrets/routine/fade-dark-spots?pp=1',
    evidence_grade: 'moderate',
    last_verified: LAST_VERIFIED,
  },
  aad_skin_of_color: {
    id: 'aad_skin_of_color',
    title_key: 'journal.analysis.sources.aad_skin_of_color.title',
    organization: 'American Academy of Dermatology',
    summary_key: 'journal.analysis.sources.aad_skin_of_color.summary',
    url: 'https://www.aad.org/skin-of-color',
    evidence_grade: 'moderate',
    last_verified: LAST_VERIFIED,
  },
  aad_oily_skin: {
    id: 'aad_oily_skin',
    title_key: 'journal.analysis.sources.aad_oily_skin.title',
    organization: 'American Academy of Dermatology',
    summary_key: 'journal.analysis.sources.aad_oily_skin.summary',
    url: 'https://www.aad.org/public/skin-hair-nails/skin-care/oily-skin',
    evidence_grade: 'moderate',
    last_verified: LAST_VERIFIED,
  },
  aad_retinoid_retinol_guidance: {
    id: 'aad_retinoid_retinol_guidance',
    title_key: 'journal.analysis.sources.aad_retinoid_retinol_guidance.title',
    organization: 'American Academy of Dermatology',
    summary_key:
      'journal.analysis.sources.aad_retinoid_retinol_guidance.summary',
    url: 'https://www.aad.org/public/everyday-care/skin-care-secrets/anti-aging/retinoid-retinol',
    evidence_grade: 'moderate',
    last_verified: LAST_VERIFIED,
  },
  aad_contact_dermatitis_symptoms: {
    id: 'aad_contact_dermatitis_symptoms',
    title_key: 'journal.analysis.sources.aad_contact_dermatitis_symptoms.title',
    organization: 'American Academy of Dermatology',
    summary_key:
      'journal.analysis.sources.aad_contact_dermatitis_symptoms.summary',
    url: 'https://www.aad.org/diseases/eczema/contact-dermatitis-symptoms',
    evidence_grade: 'moderate',
    last_verified: LAST_VERIFIED,
  },
  aad_contact_dermatitis_patch_testing: {
    id: 'aad_contact_dermatitis_patch_testing',
    title_key:
      'journal.analysis.sources.aad_contact_dermatitis_patch_testing.title',
    organization: 'American Academy of Dermatology',
    summary_key:
      'journal.analysis.sources.aad_contact_dermatitis_patch_testing.summary',
    url: 'https://www.aad.org/public/diseases/eczema/types/contact-dermatitis/patch-testing-rash',
    evidence_grade: 'moderate',
    last_verified: LAST_VERIFIED,
  },
  aad_hives_emergency: {
    id: 'aad_hives_emergency',
    title_key: 'journal.analysis.sources.aad_hives_emergency.title',
    organization: 'American Academy of Dermatology',
    summary_key: 'journal.analysis.sources.aad_hives_emergency.summary',
    url: 'https://www.aad.org/public/diseases/a-z/hives-treatment',
    evidence_grade: 'strong',
    last_verified: LAST_VERIFIED,
  },
  aad_dry_skin_relief: {
    id: 'aad_dry_skin_relief',
    title_key: 'journal.analysis.sources.aad_dry_skin_relief.title',
    organization: 'American Academy of Dermatology',
    summary_key: 'journal.analysis.sources.aad_dry_skin_relief.summary',
    url: 'https://www.aad.org/public/skin-hair-nails/skin-care/dry-skin-relief',
    evidence_grade: 'moderate',
    last_verified: LAST_VERIFIED,
  },
  mayo_acne_treatment_timing: {
    id: 'mayo_acne_treatment_timing',
    title_key: 'journal.analysis.sources.mayo_acne_treatment_timing.title',
    organization: 'Mayo Clinic',
    summary_key: 'journal.analysis.sources.mayo_acne_treatment_timing.summary',
    url: 'https://www.mayoclinic.org/diseases-conditions/acne/diagnosis-treatment/drc-20368048',
    evidence_grade: 'moderate',
    last_verified: LAST_VERIFIED,
  },
};

@Injectable()
export class SkinJournalPhotoInterpretationService {
  interpret(
    observations: AnalysisObservations,
    generatedAt = new Date(),
    context: PhotoAnalysisInterpretationContext = {},
  ): PhotoAnalysisInterpretation {
    const decision = this.chooseInterpretation(observations, context);
    const readingQuality = this.buildReadingQuality(observations);
    const concernGuidance = this.buildConcernGuidance(
      observations,
      readingQuality,
      context,
    );
    const caveatKeys = new Set<string>([NOT_DIAGNOSIS_CAVEAT]);
    if (decision.code === 'retake_needed') {
      caveatKeys.add(QUALITY_LIMITED_CAVEAT);
    }
    if (
      decision.code === 'acne_progress_timing' ||
      decision.code === 'hyperpigmentation_tracking'
    ) {
      caveatKeys.add(CORRELATION_CAVEAT);
    }

    const sourceIds = [
      ...new Set([
        ...decision.sourceIds,
        ...concernGuidance.flatMap((item) => item.source_ids),
      ]),
    ];

    return {
      version: PHOTO_INTERPRETATION_VERSION,
      code: decision.code,
      severity: decision.severity,
      summary_key: SUMMARY_KEY_BY_CODE[decision.code],
      summary_values: {},
      guidance_keys: [GUIDANCE_KEY_BY_CODE[decision.code]],
      caveat_keys: [...caveatKeys],
      source_ids: sourceIds,
      sources: sourceIds.flatMap((id) => {
        const source = PHOTO_SOURCES[id];
        return source ? [source] : [];
      }),
      generated_at: generatedAt.toISOString(),
      reading_quality: readingQuality,
      concern_guidance: concernGuidance,
    };
  }

  private chooseInterpretation(
    observations: AnalysisObservations,
    context: PhotoAnalysisInterpretationContext,
  ): {
    code: PhotoAnalysisInterpretationCode;
    severity: EventSeverity;
    sourceIds: string[];
  } {
    if (this.needsRetake(observations)) {
      return {
        code: 'retake_needed',
        severity: 'warning',
        sourceIds: ['aad_skin_photo_quality'],
      };
    }

    if (this.hasUrgentSafetySignal(observations)) {
      return {
        code: 'urgent_review',
        severity: 'critical',
        sourceIds: ['aad_hives_emergency'],
      };
    }

    if (this.hasDoctorFollowUpSignal(observations)) {
      return {
        code: 'professional_review',
        severity: 'warning',
        sourceIds: this.professionalReviewSources(observations),
      };
    }

    if (
      this.hasRetinoidContext(context.recentChange) &&
      this.hasBarrierSupportSignal(observations)
    ) {
      return {
        code: 'retinoid_irritation_context',
        severity: 'warning',
        sourceIds: ['aad_retinoid_retinol_guidance', 'aad_dry_skin_relief'],
      };
    }

    if (this.hasBarrierSupportSignal(observations)) {
      return {
        code: 'barrier_support',
        severity: 'warning',
        sourceIds: ['aad_dry_skin_relief'],
      };
    }

    if (this.hasAcneProgressSignal(observations)) {
      return {
        code: 'acne_progress_timing',
        severity: 'info',
        sourceIds: ['aad_acne_treatment_timing', 'mayo_acne_treatment_timing'],
      };
    }

    if (this.hasHyperpigmentationSignal(observations)) {
      return {
        code: 'hyperpigmentation_tracking',
        severity: 'info',
        sourceIds: this.hyperpigmentationSources(context.skinContext),
      };
    }

    return {
      code: 'stable_baseline',
      severity: 'info',
      sourceIds: [],
    };
  }

  private buildReadingQuality(
    observations: AnalysisObservations,
  ): PhotoAnalysisReadingQuality {
    if (this.needsRetake(observations)) {
      return {
        visual_label: 'needs_retake',
        trend_label: 'needs_retake',
        reason_keys: [textRef('journal.analysis.reading.reasons.retake')],
      };
    }

    const qualityScore = observations.image_quality.quality_score ?? 0.7;
    const visualLimited =
      qualityScore < 0.65 ||
      observations.image_quality.lighting_quality === 'fair' ||
      observations.image_quality.framing_quality === 'fair' ||
      observations.image_quality.issues.length > 0;
    const trendLimited =
      !observations.comparison_reference ||
      observations.image_quality.excluded_from_trends_reason !== null ||
      observations.overall_change_from_previous === 'unknown' ||
      observations.overall_change_from_previous === 'not_comparable';
    const reasonKeys: PhotoAnalysisTextRef[] = [];

    if (visualLimited) {
      reasonKeys.push(
        textRef('journal.analysis.reading.reasons.visualLimited'),
      );
    } else if ((observations.per_angle_quality?.length ?? 0) >= 3) {
      reasonKeys.push(textRef('journal.analysis.reading.reasons.multiAngle'));
    } else {
      reasonKeys.push(textRef('journal.analysis.reading.reasons.clearFront'));
    }

    if (trendLimited) {
      reasonKeys.push(
        observations.comparison_reference
          ? textRef('journal.analysis.reading.reasons.trendLimited')
          : textRef('journal.analysis.reading.reasons.noPrior'),
      );
    } else {
      reasonKeys.push(
        textRef('journal.analysis.reading.reasons.priorReference'),
      );
    }

    return {
      visual_label: visualLimited ? 'limited' : 'useful',
      trend_label: trendLimited ? 'limited' : 'useful',
      reason_keys: reasonKeys,
    };
  }

  private buildConcernGuidance(
    observations: AnalysisObservations,
    readingQuality: PhotoAnalysisReadingQuality,
    context: PhotoAnalysisInterpretationContext,
  ): PhotoAnalysisConcernGuidance[] {
    if (readingQuality.visual_label === 'needs_retake') {
      return [];
    }

    const strongestByConcern = new Map<
      string,
      AnalysisObservations['detected_concerns'][number]
    >();
    for (const concern of observations.detected_concerns) {
      if (concern.confidence < 0.45) {
        continue;
      }
      const existing = strongestByConcern.get(concern.concern);
      if (
        !existing ||
        severityScore(concern.severity) > severityScore(existing.severity) ||
        concern.confidence > existing.confidence
      ) {
        strongestByConcern.set(concern.concern, concern);
      }
    }

    return [...strongestByConcern.values()]
      .sort(
        (a, b) =>
          severityScore(b.severity) - severityScore(a.severity) ||
          b.confidence - a.confidence,
      )
      .slice(0, 4)
      .map((concern) =>
        this.buildConcernGuidanceItem(concern, observations, context),
      );
  }

  private buildConcernGuidanceItem(
    detected: AnalysisObservations['detected_concerns'][number],
    observations: AnalysisObservations,
    context: PhotoAnalysisInterpretationContext,
  ): PhotoAnalysisConcernGuidance {
    const group = guidanceGroup(detected.concern);
    const contextSignals = this.contextSignals(detected.concern, context);
    const guidanceDecision = guidanceDecisionForConcern(
      observations,
      detected.concern,
    );
    const possibleFactorKeys = factorKeysFromGuidanceDecision(
      guidanceDecision,
      contextSignals,
      detected.concern,
    );
    const actionKeys = actionKeysFromGuidanceDecision(
      guidanceDecision,
      detected.concern,
    );
    const avoidKeys = avoidKeysFromGuidanceDecision(
      guidanceDecision,
      detected.concern,
      contextSignals,
      context,
    );
    const possibleCauseItems = generatedGuidanceItems(
      guidanceDecision?.possible_cause_items,
    );
    const tryNextItems = generatedGuidanceItems(
      guidanceDecision?.try_next_items,
    );
    const avoidItems = generatedGuidanceItems(guidanceDecision?.avoid_items);
    const sourceIds = [
      ...new Set([
        ...sourceIdsForConcern(detected.concern, context.skinContext),
        ...contextSignals.sourceIds,
      ]),
    ];
    return {
      concern: detected.concern,
      severity: detected.severity,
      locations: detected.locations,
      confidence_label:
        detected.confidence >= 0.72
          ? 'likely_visible'
          : detected.confidence >= 0.55
            ? 'possible'
            : 'limited',
      title_key: `journal.analysis.guidance.${group}.title`,
      summary: textRef(`journal.analysis.guidance.${group}.summary`, {
        severity: detected.severity,
        locations: formatLocations(detected.locations),
      }),
      possible_factor_keys: (possibleFactorKeys.length > 0
        ? possibleFactorKeys
        : [
            ...contextSignals.factorKeys,
            ...defaultCauseKeysForConcern(detected.concern),
          ]
      ).slice(0, 4),
      possible_cause_items:
        possibleFactorKeys.length > 0 && possibleCauseItems.length > 0
          ? possibleCauseItems
          : undefined,
      action_keys:
        actionKeys.length > 0
          ? actionKeys
          : actionKeysForConcern(detected.concern),
      try_next_items:
        actionKeys.length > 0 && tryNextItems.length > 0
          ? tryNextItems
          : undefined,
      avoid_keys:
        avoidKeys.length > 0
          ? avoidKeys
          : avoidKeysForConcern(detected.concern, contextSignals, context),
      avoid_items:
        avoidKeys.length > 0 && avoidItems.length > 0 ? avoidItems : undefined,
      track_key: textRef(`journal.analysis.guidance.${group}.track`),
      escalation_key: escalationKeyForConcern(detected),
      source_ids: sourceIds,
      sources: sourceIds.flatMap((id) => {
        const source = PHOTO_SOURCES[id];
        return source ? [source] : [];
      }),
    };
  }

  private contextSignals(
    concern: AnalysisConcern,
    context: PhotoAnalysisInterpretationContext,
  ): ContextSignals {
    const routineContext = context.routineContext;
    const currentCheckIn = routineContext?.recent_check_ins[0] ?? null;
    const factorKeys: PhotoAnalysisTextRef[] = [];
    const checkInFactorKeys: PhotoAnalysisTextRef[] = [];
    const sourceIds = new Set<string>();
    const add = (key: string, values?: Record<string, string | number>) => {
      if (!factorKeys.some((item) => item.key === key)) {
        factorKeys.push(textRef(key, values));
      }
    };
    const addCheckIn = (
      key: string,
      values?: Record<string, string | number>,
    ) => {
      if (!checkInFactorKeys.some((item) => item.key === key)) {
        checkInFactorKeys.push(textRef(key, values));
      }
    };

    if (currentCheckIn) {
      this.addCheckInFactors(concern, currentCheckIn, addCheckIn);
    }

    if (context.recentChange) {
      const product = context.recentChange.related_inventory_product_id
        ? this.productNameForId(
            context.recentChange.related_inventory_product_id,
            routineContext,
          )
        : null;
      if (
        this.contextTextMatchesConcern(concern, [
          product,
          context.recentChange.note,
        ])
      ) {
        add(
          product
            ? 'journal.analysis.guidance.factors.recentProductChangeNamed'
            : 'journal.analysis.guidance.factors.recentRoutineChange',
          product ? { product } : undefined,
        );
      }
    }

    const sunscreen = this.findExposureProductByKeywords(routineContext, [
      'spf',
      'sunscreen',
      'sun screen',
      'broad spectrum',
      'sun-protection',
    ]);
    const activeProduct = this.relevantActiveProduct(concern, routineContext);
    const sunscreenAlreadyExplainsPigmentContext =
      Boolean(sunscreen) &&
      (concern === 'hyperpigmentation' || concern === 'uneven_tone');
    if (activeProduct && !sunscreenAlreadyExplainsPigmentContext) {
      add('journal.analysis.guidance.factors.routineProductTiming', {
        product: activeProduct,
      });
    }

    const retinoidOrExfoliant = this.findExposureProductByKeywords(
      routineContext,
      [
        ...RETINOID_KEYWORDS,
        ...EXFOLIANT_KEYWORDS,
        ...BENZOYL_PEROXIDE_KEYWORDS,
      ],
    );
    if (
      retinoidOrExfoliant &&
      [
        'acne',
        'texture',
        'dryness',
        'redness_inflammation',
        'skin_barrier_damage',
        'eczema_indicator',
      ].includes(concern)
    ) {
      add('journal.analysis.guidance.factors.activeIngredientTiming', {
        product: retinoidOrExfoliant,
      });
      sourceIds.add('aad_retinoid_retinol_guidance');
    }

    if (
      sunscreen &&
      (concern === 'hyperpigmentation' || concern === 'uneven_tone')
    ) {
      add('journal.analysis.guidance.factors.sunscreenContext', {
        product: sunscreen,
      });
      sourceIds.add('aad_dark_spots_skin_tones');
    }

    if (this.hasRelevantApplicationChange(concern, routineContext)) {
      add('journal.analysis.guidance.factors.recentApplicationChange');
    }

    return {
      factorKeys: dedupeTextRefs([
        ...checkInFactorKeys.slice(0, 1),
        ...factorKeys,
        ...checkInFactorKeys.slice(1),
      ]),
      sourceIds: [...sourceIds],
    };
  }

  private addCheckInFactors(
    concern: AnalysisConcern,
    checkIn: NonNullable<AnalysisRoutineContext['recent_check_ins']>[number],
    add: (key: string, values?: Record<string, string | number>) => void,
  ): void {
    const ratings = checkIn.ratings ?? {};
    if (
      (concern === 'large_pores' ||
        concern === 'oiliness' ||
        concern === 'acne') &&
      (ratings.oiliness ?? 0) >= 4
    ) {
      add('journal.analysis.guidance.factors.checkInOiliness');
    }
    if (
      (concern === 'dryness' ||
        concern === 'skin_barrier_damage' ||
        concern === 'redness_inflammation' ||
        concern === 'eczema_indicator') &&
      ((ratings.dryness ?? 0) >= 4 ||
        (ratings.irritation ?? 0) >= 4 ||
        (ratings.sensitivity ?? 0) >= 4 ||
        (ratings.redness ?? 0) >= 4)
    ) {
      add('journal.analysis.guidance.factors.checkInIrritation');
    }
    if (
      (concern === 'hyperpigmentation' ||
        concern === 'uneven_tone' ||
        concern === 'redness_inflammation') &&
      checkIn.sun_exposure_today &&
      checkIn.sun_exposure_today !== 'none'
    ) {
      add('journal.analysis.guidance.factors.checkInSun');
    }
    if (
      (concern === 'acne' ||
        concern === 'large_pores' ||
        concern === 'oiliness') &&
      checkIn.sweat_exercise_today === true
    ) {
      add('journal.analysis.guidance.factors.checkInSweat');
    }
    if (
      (concern === 'acne' ||
        concern === 'redness_inflammation' ||
        concern === 'skin_barrier_damage') &&
      checkIn.stress_today === 'high'
    ) {
      add('journal.analysis.guidance.factors.checkInStress');
    }
    if (
      (concern === 'acne' ||
        concern === 'under_eye_darkness' ||
        concern === 'skin_barrier_damage') &&
      checkIn.sleep_band === 'lt5h'
    ) {
      add('journal.analysis.guidance.factors.checkInSleep');
    }
    if (
      isBarrierLikeConcern(concern) &&
      checkIn.overall_feel &&
      (checkIn.overall_feel === 'awful' || checkIn.overall_feel === 'bad')
    ) {
      add('journal.analysis.guidance.factors.checkInFeel');
    }
    if (concern === 'acne' && noteMentionsDietAcneTrigger(checkIn)) {
      add('journal.analysis.guidance.factors.noteDietAcne');
    }
  }

  private hasRelevantApplicationChange(
    concern: AnalysisConcern,
    routineContext: AnalysisRoutineContext | null | undefined,
  ): boolean {
    return (
      routineContext?.recent_applications.some((application) =>
        application.items.some(
          (item) =>
            (item.status === 'skipped' || item.status === 'substituted') &&
            this.contextTextMatchesConcern(concern, [
              item.name,
              item.brand,
              item.category,
              item.step_label,
            ]),
        ),
      ) ?? false
    );
  }

  private contextTextMatchesConcern(
    concern: AnalysisConcern,
    values: Array<string | null | undefined>,
  ): boolean {
    const normalized = values
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .toLowerCase();
    if (!normalized) {
      return false;
    }
    return CONTEXT_KEYWORDS_BY_CONCERN[concern].some((keyword) =>
      normalized.includes(keyword),
    );
  }

  private relevantActiveProduct(
    concern: string,
    routineContext: AnalysisRoutineContext | null | undefined,
  ): string | null {
    if (!routineContext) return null;
    if (concern === 'hyperpigmentation' || concern === 'uneven_tone') {
      return this.findExposureProductByKeywords(routineContext, [
        'spf',
        'sunscreen',
        'sun-protection',
        'vitamin c',
        'azelaic',
        'niacinamide',
      ]);
    }
    if (concern === 'acne') {
      return this.findExposureProductByKeywords(routineContext, [
        'salicylic',
        'benzoyl peroxide',
        'adapalene',
        'retinol',
        'retinoid',
        'cleanser',
      ]);
    }
    if (
      concern === 'dryness' ||
      concern === 'skin_barrier_damage' ||
      concern === 'redness_inflammation' ||
      concern === 'eczema_indicator'
    ) {
      return this.findExposureProductByKeywords(routineContext, [
        'retinol',
        'retinoid',
        'acid',
        'exfoliant',
        'cleanser',
      ]);
    }
    return null;
  }

  private findExposureProductByKeywords(
    routineContext: AnalysisRoutineContext | null | undefined,
    keywords: readonly string[],
  ): string | null {
    if (!routineContext) return null;
    for (const product of routineContext.routine_products) {
      if (productMatchesKeywords(product, keywords)) {
        return productDisplayName(product.brand, product.name);
      }
    }
    for (const application of routineContext.recent_applications) {
      for (const item of application.items) {
        if (!isAppliedExposureItem(item)) continue;
        if (applicationItemMatchesKeywords(item, keywords)) {
          return productDisplayName(
            item.applied_brand ?? item.brand,
            item.applied_name ?? item.name,
          );
        }
      }
    }
    return null;
  }

  private productNameForId(
    productId: string,
    routineContext: AnalysisRoutineContext | null | undefined,
  ): string | null {
    const routineProduct = routineContext?.routine_products.find(
      (product) => product.product_id === productId,
    );
    if (routineProduct) {
      return productDisplayName(routineProduct.brand, routineProduct.name);
    }
    const shelfProduct = routineContext?.active_shelf_products.find(
      (product) => product.product_id === productId,
    );
    if (shelfProduct) {
      return productDisplayName(shelfProduct.brand, shelfProduct.name);
    }
    for (const application of routineContext?.recent_applications ?? []) {
      const item = application.items.find((candidate) => {
        return (
          candidate.product_id === productId ||
          candidate.recommended_product_id === productId ||
          candidate.applied_product_id === productId
        );
      });
      if (item) {
        return productDisplayName(
          item.applied_brand ?? item.recommended_brand ?? item.brand,
          item.applied_name ?? item.recommended_name ?? item.name,
        );
      }
    }
    return null;
  }

  private needsRetake(observations: AnalysisObservations): boolean {
    return (
      observations.image_quality.face_detected === false ||
      observations.image_quality.needs_retake === true
    );
  }

  private hasUrgentSafetySignal(observations: AnalysisObservations): boolean {
    const reasons = observations.safety_flags?.reasons ?? [];
    return (
      observations.safety_flags?.urgent_review_recommended === true ||
      reasons.includes('possible_swelling') ||
      reasons.includes('hive_like_appearance') ||
      observations.reaction_signals.indicators.includes(
        'swelling_appearance',
      ) ||
      observations.reaction_signals.indicators.includes('hives_appearance')
    );
  }

  private hasDoctorFollowUpSignal(observations: AnalysisObservations): boolean {
    return (
      observations.should_flag_for_doctor ||
      observations.safety_flags?.doctor_follow_up_recommended === true ||
      (observations.safety_flags?.reasons.length ?? 0) > 0
    );
  }

  private professionalReviewSources(
    observations: AnalysisObservations,
  ): string[] {
    const reasons = observations.safety_flags?.reasons ?? [];
    if (this.hasReason(reasons, 'cracking_or_open_skin_appearance')) {
      return [
        'aad_contact_dermatitis_symptoms',
        'aad_contact_dermatitis_patch_testing',
      ];
    }
    if (
      observations.detected_concerns.some(
        (concern) => concern.concern === 'eczema_indicator',
      )
    ) {
      return [
        'aad_contact_dermatitis_symptoms',
        'aad_contact_dermatitis_patch_testing',
      ];
    }
    return ['aad_hives_emergency'];
  }

  private hasBarrierSupportSignal(observations: AnalysisObservations): boolean {
    return (
      observations.barrier_signs.barrier_compromise ||
      observations.barrier_signs.indicators.length > 0 ||
      (observations.reaction_signals.reaction_detected &&
        (observations.reaction_signals.reaction_severity === 'moderate' ||
          observations.reaction_signals.reaction_severity === 'severe'))
    );
  }

  private hasAcneProgressSignal(observations: AnalysisObservations): boolean {
    return observations.detected_concerns.some(
      (concern) =>
        concern.concern === 'acne' &&
        concern.change_from_previous !== 'unknown' &&
        concern.change_from_previous !== 'not_comparable',
    );
  }

  private hasHyperpigmentationSignal(
    observations: AnalysisObservations,
  ): boolean {
    return observations.detected_concerns.some(
      (concern) =>
        (concern.concern === 'hyperpigmentation' ||
          concern.concern === 'uneven_tone') &&
        concern.confidence >= 0.55,
    );
  }

  private hyperpigmentationSources(
    skinContext: AnalysisSkinContext | null | undefined,
  ): string[] {
    const sources = ['aad_dark_spots_skin_tones'];
    if (this.isSkinOfColorContext(skinContext)) {
      sources.push('aad_skin_of_color');
    }
    return sources;
  }

  private isSkinOfColorContext(
    skinContext: AnalysisSkinContext | null | undefined,
  ): boolean {
    const phototype = skinContext?.fitzpatrick_phototype?.toUpperCase();
    if (phototype === 'IV' || phototype === 'V' || phototype === 'VI') {
      return true;
    }
    const tone = skinContext?.skin_tone?.toLowerCase() ?? '';
    return (
      tone.includes('medium_deep') ||
      tone.includes('deep') ||
      tone.includes('dark')
    );
  }

  private hasRetinoidContext(
    recentChange: RecentChangePayload | null | undefined,
  ): boolean {
    if (recentChange?.kind !== 'started_new_product') {
      return false;
    }
    const note = recentChange.note?.toLowerCase() ?? '';
    return RETINOID_KEYWORDS.some((keyword) => note.includes(keyword));
  }

  private hasReason(
    reasons: AnalysisSafetyReason[],
    reason: AnalysisSafetyReason,
  ): boolean {
    return reasons.includes(reason);
  }
}

function textRef(
  key: string,
  values?: Record<string, string | number>,
): PhotoAnalysisTextRef {
  return values ? { key, values } : { key };
}

function dedupeTextRefs(refs: PhotoAnalysisTextRef[]): PhotoAnalysisTextRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    if (seen.has(ref.key)) {
      return false;
    }
    seen.add(ref.key);
    return true;
  });
}

function generatedGuidanceItems(
  items: readonly string[] | null | undefined,
): string[] {
  if (!items) {
    return [];
  }
  const seen = new Set<string>();
  return items
    .map((item) => item.replace(/\s+/g, ' ').slice(0, 180).trim())
    .filter((item) => {
      if (
        item.length < 12 ||
        FORBIDDEN_GENERATED_GUIDANCE_LANGUAGE.test(item) ||
        AI_STYLE_PUNCTUATION.test(item)
      ) {
        return false;
      }
      const normalized = item.toLowerCase();
      if (seen.has(normalized)) {
        return false;
      }
      seen.add(normalized);
      return true;
    })
    .slice(0, 3);
}

function severityScore(severity: 'mild' | 'moderate' | 'severe'): number {
  if (severity === 'severe') return 3;
  if (severity === 'moderate') return 2;
  return 1;
}

function isBarrierLikeConcern(concern: AnalysisConcern): boolean {
  return (
    concern === 'dryness' ||
    concern === 'skin_barrier_damage' ||
    concern === 'redness_inflammation' ||
    concern === 'eczema_indicator'
  );
}

function guidanceGroup(concern: string): string {
  if (concern === 'hyperpigmentation' || concern === 'uneven_tone') {
    return 'hyperpigmentation';
  }
  if (concern === 'large_pores' || concern === 'oiliness') {
    return 'poresOil';
  }
  if (
    concern === 'dryness' ||
    concern === 'skin_barrier_damage' ||
    concern === 'redness_inflammation' ||
    concern === 'eczema_indicator'
  ) {
    return 'barrier';
  }
  if (concern === 'fine_lines' || concern === 'under_eye_darkness') {
    return 'photoSensitive';
  }
  return concern;
}

function sourceIdsForConcern(
  concern: string,
  skinContext: AnalysisSkinContext | null | undefined,
): string[] {
  switch (concern) {
    case 'acne':
      return [
        'aad_acne_causes',
        'aad_acne_treatment_timing',
        'aad_acne_skin_care_tips',
      ];
    case 'hyperpigmentation':
    case 'uneven_tone':
      return isSkinOfColorContextValue(skinContext)
        ? ['aad_dark_spots_skin_tones', 'aad_skin_of_color']
        : ['aad_dark_spots_skin_tones'];
    case 'large_pores':
    case 'oiliness':
      return ['aad_oily_skin', 'aad_acne_skin_care_tips'];
    case 'dryness':
    case 'skin_barrier_damage':
      return ['aad_dry_skin_relief'];
    case 'redness_inflammation':
    case 'eczema_indicator':
      return ['aad_dry_skin_relief', 'aad_contact_dermatitis_symptoms'];
    case 'texture':
    case 'fine_lines':
    case 'under_eye_darkness':
      return ['aad_skin_photo_quality'];
    default:
      return ['aad_skin_photo_quality'];
  }
}

function guidanceDecisionForConcern(
  observations: AnalysisObservations,
  concern: AnalysisConcern,
): NonNullable<AnalysisObservations['guidance_decisions']>[number] | null {
  return (
    observations.guidance_decisions?.find(
      (decision) => decision.concern === concern,
    ) ?? null
  );
}

function factorKeysFromGuidanceDecision(
  decision:
    | NonNullable<AnalysisObservations['guidance_decisions']>[number]
    | null,
  contextSignals: ContextSignals,
  concern: AnalysisConcern,
): PhotoAnalysisTextRef[] {
  if (!decision) {
    return [];
  }
  const availableFactors = [
    ...contextSignals.factorKeys,
    ...defaultCauseKeysForConcern(concern),
  ];
  return dedupeTextRefs(
    decision.possible_factor_codes.flatMap((code) => {
      const candidateKeys = FACTOR_CODE_KEY_CANDIDATES[code];
      const available = availableFactors.find((factor) =>
        candidateKeys.includes(factor.key),
      );
      return available ? [available] : [];
    }),
  );
}

function actionKeysFromGuidanceDecision(
  decision:
    | NonNullable<AnalysisObservations['guidance_decisions']>[number]
    | null,
  concern: AnalysisConcern,
): PhotoAnalysisTextRef[] {
  if (!decision) {
    return [];
  }
  const allowed = allowedActionCodesForConcern(concern);
  return dedupeTextRefs(
    decision.action_codes.flatMap((code) =>
      allowed.includes(code) ? [textRef(ACTION_CODE_TO_KEY[code])] : [],
    ),
  );
}

function avoidKeysFromGuidanceDecision(
  decision:
    | NonNullable<AnalysisObservations['guidance_decisions']>[number]
    | null,
  concern: AnalysisConcern,
  contextSignals: ContextSignals,
  context: PhotoAnalysisInterpretationContext,
): PhotoAnalysisTextRef[] {
  if (!decision) {
    return [];
  }
  const allowed = allowedAvoidCodesForConcern(concern);
  return dedupeTextRefs(
    decision.avoid_codes.flatMap((code) =>
      allowed.includes(code) &&
      avoidCodeSupportedByContext(code, concern, contextSignals, context)
        ? [textRef(AVOID_CODE_TO_KEY[code])]
        : [],
    ),
  );
}

function allowedActionCodesForConcern(
  concern: AnalysisConcern,
): readonly PhotoAnalysisGuidanceActionCode[] {
  switch (concern) {
    case 'acne':
      return [
        'acne_steady_routine',
        'non_comedogenic',
        'log_clusters',
        'same_light',
        'watch_pattern',
      ];
    case 'hyperpigmentation':
    case 'uneven_tone':
      return [
        'spf_context',
        'prevent_irritation',
        'same_light',
        'watch_pattern',
      ];
    case 'large_pores':
    case 'oiliness':
      return [
        'gentle_cleanse',
        'oil_free_when_possible',
        'watch_shine_pattern',
        'watch_pattern',
      ];
    case 'dryness':
    case 'skin_barrier_damage':
    case 'redness_inflammation':
    case 'eczema_indicator':
      return [
        'simplify_routine',
        'moisturizer_support',
        'watch_comfort',
        'prevent_irritation',
        'same_light',
      ];
    default:
      return ['same_light', 'watch_pattern'];
  }
}

function allowedAvoidCodesForConcern(
  concern: AnalysisConcern,
): readonly PhotoAnalysisGuidanceAvoidCode[] {
  switch (concern) {
    case 'acne':
      return [
        'logged_diet_pattern',
        'pore_clogging_products',
        'sweat_friction_after_exercise',
        'multiple_new_actives',
        'picking_or_squeezing',
      ];
    case 'hyperpigmentation':
    case 'uneven_tone':
      return ['inconsistent_spf', 'irritating_scrubs', 'picking_or_squeezing'];
    case 'large_pores':
    case 'oiliness':
      return [
        'pore_clogging_products',
        'sweat_friction_after_exercise',
        'stripping_skin',
        'over_exfoliation_for_pores',
      ];
    case 'dryness':
    case 'skin_barrier_damage':
    case 'redness_inflammation':
    case 'eczema_indicator':
      return [
        'adding_actives_while_stressed',
        'known_irritant_reexposure',
        'fragrance_if_sensitive',
        'irritating_scrubs',
        'multiple_new_actives',
      ];
    default:
      return [
        'irritating_scrubs',
        'adding_actives_while_stressed',
        'known_irritant_reexposure',
      ];
  }
}

function avoidCodeSupportedByContext(
  code: PhotoAnalysisGuidanceAvoidCode,
  concern: AnalysisConcern,
  contextSignals: ContextSignals,
  context: PhotoAnalysisInterpretationContext,
): boolean {
  switch (code) {
    case 'logged_diet_pattern':
      return hasFactorKey(
        contextSignals,
        'journal.analysis.guidance.factors.noteDietAcne',
      );
    case 'sweat_friction_after_exercise':
      return hasFactorKey(
        contextSignals,
        'journal.analysis.guidance.factors.checkInSweat',
      );
    case 'multiple_new_actives':
      return (
        hasAnyFactorKey(contextSignals, [
          'journal.analysis.guidance.factors.recentProductChangeNamed',
          'journal.analysis.guidance.factors.recentRoutineChange',
          'journal.analysis.guidance.factors.routineProductTiming',
          'journal.analysis.guidance.factors.activeIngredientTiming',
        ]) ||
        context.recentChange?.kind === 'started_new_product' ||
        context.recentChange?.kind === 'changed_frequency'
      );
    case 'fragrance_if_sensitive':
      return (
        context.skinContext?.sensitivity_level === 'high' ||
        isBarrierLikeConcern(concern)
      );
    case 'known_irritant_reexposure':
      return (
        isBarrierLikeConcern(concern) &&
        hasAnyFactorKey(contextSignals, [
          'journal.analysis.guidance.factors.checkInIrritation',
          'journal.analysis.guidance.factors.recentProductChangeNamed',
          'journal.analysis.guidance.factors.recentRoutineChange',
          'journal.analysis.guidance.factors.activeIngredientTiming',
        ])
      );
    default:
      return true;
  }
}

function hasFactorKey(contextSignals: ContextSignals, key: string): boolean {
  return contextSignals.factorKeys.some((factor) => factor.key === key);
}

function hasAnyFactorKey(
  contextSignals: ContextSignals,
  keys: readonly string[],
): boolean {
  return contextSignals.factorKeys.some((factor) => keys.includes(factor.key));
}

function defaultCauseKeysForConcern(concern: string): PhotoAnalysisTextRef[] {
  switch (concern) {
    case 'acne':
      return [
        textRef('journal.analysis.guidance.factors.acneCommonContributors'),
      ];
    case 'hyperpigmentation':
    case 'uneven_tone':
      return [
        textRef('journal.analysis.guidance.factors.pigmentCommonContributors'),
      ];
    case 'large_pores':
    case 'oiliness':
      return [
        textRef('journal.analysis.guidance.factors.oilPoreCommonContributors'),
      ];
    case 'dryness':
    case 'skin_barrier_damage':
    case 'redness_inflammation':
    case 'eczema_indicator':
      return [
        textRef('journal.analysis.guidance.factors.barrierCommonContributors'),
      ];
    case 'fine_lines':
    case 'texture':
    case 'under_eye_darkness':
      return [
        textRef(
          'journal.analysis.guidance.factors.appearanceCommonContributors',
        ),
      ];
    default:
      return [
        textRef('journal.analysis.guidance.factors.generalCommonContributors'),
      ];
  }
}

function noteMentionsDietAcneTrigger(
  checkIn: NonNullable<AnalysisRoutineContext['recent_check_ins']>[number],
): boolean {
  const note = checkIn.complaint_note?.toLowerCase() ?? '';
  return ACNE_DIET_NOTE_KEYWORDS.some((keyword) => note.includes(keyword));
}

function actionKeysForConcern(concern: string): PhotoAnalysisTextRef[] {
  switch (concern) {
    case 'acne':
      return [
        textRef('journal.analysis.guidance.actions.acneSteadyRoutine'),
        textRef('journal.analysis.guidance.actions.nonComedogenic'),
        textRef('journal.analysis.guidance.actions.logClusters'),
      ];
    case 'hyperpigmentation':
    case 'uneven_tone':
      return [
        textRef('journal.analysis.guidance.actions.spfContext'),
        textRef('journal.analysis.guidance.actions.preventIrritation'),
        textRef('journal.analysis.guidance.actions.sameLight'),
      ];
    case 'large_pores':
    case 'oiliness':
      return [
        textRef('journal.analysis.guidance.actions.gentleCleanse'),
        textRef('journal.analysis.guidance.actions.oilFreeWhenPossible'),
        textRef('journal.analysis.guidance.actions.watchShinePattern'),
      ];
    case 'dryness':
    case 'skin_barrier_damage':
    case 'redness_inflammation':
    case 'eczema_indicator':
      return [
        textRef('journal.analysis.guidance.actions.simplifyRoutine'),
        textRef('journal.analysis.guidance.actions.moisturizerSupport'),
        textRef('journal.analysis.guidance.actions.watchComfort'),
      ];
    default:
      return [
        textRef('journal.analysis.guidance.actions.sameLight'),
        textRef('journal.analysis.guidance.actions.watchPattern'),
      ];
  }
}

function avoidKeysForConcern(
  concern: AnalysisConcern,
  contextSignals: ContextSignals,
  context: PhotoAnalysisInterpretationContext,
): PhotoAnalysisTextRef[] {
  const fallbackCodes = fallbackAvoidCodesForConcern(concern);
  return dedupeTextRefs(
    fallbackCodes.flatMap((code) =>
      avoidCodeSupportedByContext(code, concern, contextSignals, context)
        ? [textRef(AVOID_CODE_TO_KEY[code])]
        : [],
    ),
  ).slice(0, 3);
}

function fallbackAvoidCodesForConcern(
  concern: AnalysisConcern,
): PhotoAnalysisGuidanceAvoidCode[] {
  switch (concern) {
    case 'acne':
      return [
        'logged_diet_pattern',
        'sweat_friction_after_exercise',
        'multiple_new_actives',
        'pore_clogging_products',
        'picking_or_squeezing',
      ];
    case 'hyperpigmentation':
    case 'uneven_tone':
      return ['inconsistent_spf', 'irritating_scrubs', 'picking_or_squeezing'];
    case 'large_pores':
    case 'oiliness':
      return [
        'pore_clogging_products',
        'stripping_skin',
        'over_exfoliation_for_pores',
      ];
    case 'dryness':
    case 'skin_barrier_damage':
    case 'redness_inflammation':
    case 'eczema_indicator':
      return [
        'adding_actives_while_stressed',
        'known_irritant_reexposure',
        'fragrance_if_sensitive',
        'irritating_scrubs',
      ];
    default:
      return ['irritating_scrubs'];
  }
}

function escalationKeyForConcern(
  detected: AnalysisObservations['detected_concerns'][number],
): PhotoAnalysisTextRef | null {
  if (
    detected.severity === 'severe' ||
    detected.concern === 'eczema_indicator' ||
    detected.concern === 'skin_barrier_damage'
  ) {
    return textRef('journal.analysis.guidance.escalation.persistentOrPainful');
  }
  return null;
}

function formatLocations(locations: string[]): string {
  if (locations.length === 0) {
    return 'visible areas';
  }
  return locations.map(humanizeLocation).join(', ');
}

function humanizeLocation(location: string): string {
  return location.replace(/_/g, ' ');
}

function productMatchesKeywords(
  product: AnalysisProductForKeywordSearch,
  keywords: readonly string[],
): boolean {
  const haystack = [
    product.brand,
    product.name,
    product.category,
    product.step_label,
    ...(product.ingredient_preview ?? []),
    ...(product.guidance_cautions ?? []),
    ...(product.guidance_steps ?? []),
    ...(product.benefit_tags ?? []),
    ...(product.suited_for_tags ?? []),
    product.user_product_note,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

function applicationItemMatchesKeywords(
  item: AnalysisApplicationItemForKeywordSearch,
  keywords: readonly string[],
): boolean {
  const haystack = [
    item.brand,
    item.name,
    item.category,
    item.step_label,
    item.recommended_brand,
    item.recommended_name,
    item.applied_brand,
    item.applied_name,
    item.ad_hoc_brand,
    item.ad_hoc_name,
    item.notes,
    item.substitution_reason,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

function isAppliedExposureItem(
  item: AnalysisApplicationItemForKeywordSearch,
): boolean {
  return item.status === 'applied' || item.status === 'substituted';
}

function productDisplayName(
  brand: string | null | undefined,
  name: string | null | undefined,
): string {
  return [brand, name].filter(Boolean).join(' ').trim() || 'a routine product';
}

function isSkinOfColorContextValue(
  skinContext: AnalysisSkinContext | null | undefined,
): boolean {
  const phototype = skinContext?.fitzpatrick_phototype?.toUpperCase();
  if (phototype === 'IV' || phototype === 'V' || phototype === 'VI') {
    return true;
  }
  const tone = skinContext?.skin_tone?.toLowerCase() ?? '';
  return (
    tone.includes('medium_deep') ||
    tone.includes('deep') ||
    tone.includes('dark')
  );
}

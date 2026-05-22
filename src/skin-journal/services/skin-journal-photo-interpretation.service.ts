import { Injectable } from '@nestjs/common';
import type {
  AnalysisObservations,
  AnalysisSafetyReason,
  AnalysisSkinContext,
  EventSeverity,
  PhotoAnalysisInterpretation,
  PhotoAnalysisInterpretationCode,
  PhotoAnalysisSourceCitation,
  RecentChangePayload,
} from '../skin-journal.constants';

const PHOTO_INTERPRETATION_VERSION = '1.0' as const;
const LAST_VERIFIED = '2026-05-01';
const RETINOID_KEYWORDS = [
  'retinol',
  'retinoid',
  'tretinoin',
  'adapalene',
  'retinal',
  'retinaldehyde',
] as const;

interface PhotoAnalysisInterpretationContext {
  skinContext?: AnalysisSkinContext | null;
  recentChange?: RecentChangePayload | null;
}

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
    url: 'https://www.aad.org/public/everyday-care/skin-care-basics/dry/dermatologists-tips-relieve-dry-skin',
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

    const sourceIds = [...new Set(decision.sourceIds)];

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

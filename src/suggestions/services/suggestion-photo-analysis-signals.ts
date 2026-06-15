import type { SkinJournalEntry } from '../../skin-journal/entities/skin-journal-entry.entity';
import type {
  AnalysisAngleQuality,
  AnalysisChangeDirection,
  AnalysisObservations,
  PhotoAnalysisConcernGuidance,
  PhotoAnalysisInterpretation,
} from '../../skin-journal/skin-journal.constants';
import type { SuggestionContextSummary } from '../suggestion-context.types';
import { increment, trimForPrompt, unique } from './suggestion-context-common';
import {
  addTextRefKeys,
  addGuidanceItems,
  buildConcernGuidance,
  buildDetectedConcerns,
  buildInterpretationSignals,
  buildVisualChanges,
  createConcernGuidanceAggregate,
  createDetectedConcernAggregate,
  createInterpretationAggregate,
  createVisualChangeAggregate,
  hasNeedsRetake,
  isComparableChange,
  roundedAverage,
  strongestSeverity,
} from './suggestion-photo-analysis-signal-utils';
import type {
  ConcernGuidanceAggregate,
  DetectedConcernAggregate,
  InterpretationAggregate,
  VisualChangeAggregate,
} from './suggestion-photo-analysis-signal-utils';

type JournalSignals = NonNullable<SuggestionContextSummary['journalSignals']>;

export class JournalPhotoAnalysisSignalCollector {
  private readonly detectedConcernMap = new Map<
    string,
    DetectedConcernAggregate
  >();

  private readonly visualChangesMap = new Map<string, VisualChangeAggregate>();

  private readonly interpretationMap = new Map<
    string,
    InterpretationAggregate
  >();

  private readonly concernGuidanceMap = new Map<
    string,
    ConcernGuidanceAggregate
  >();

  private readonly visualLabelCounts: Record<string, number> = {};

  private readonly trendLabelCounts: Record<string, number> = {};

  private readonly lightingQualityCounts: Record<string, number> = {};

  private readonly framingQualityCounts: Record<string, number> = {};

  private readonly issueCounts: Record<string, number> = {};

  private readonly trendExcludedReasons: Record<string, number> = {};

  private readonly qualityScores: number[] = [];

  private readonly interpretationSourceIds = new Set<string>();

  private readonly guidanceKeys = new Set<string>();

  private readonly caveatKeys = new Set<string>();

  private readonly safetyReasons = new Set<string>();

  private readonly doctorFlagReasons: string[] = [];

  private usedForAnalysisImages = 0;

  private urgentReviewRecommended = false;

  private doctorFollowUpRecommended = false;

  private flaggedEntryCount = 0;

  private retakeCount = 0;

  collect(entry: SkinJournalEntry, entryDate: string): void {
    const observations = entry.analysis_observations ?? null;
    const interpretation = entry.analysis_interpretation ?? null;

    if (hasNeedsRetake(entry, observations)) {
      this.retakeCount += 1;
    }
    this.collectObservationQuality(observations);
    this.usedForAnalysisImages += (
      observations?.per_angle_quality ?? []
    ).filter((quality) => quality.used_for_analysis).length;
    this.collectInterpretationSignals(interpretation, entryDate);
    this.collectSafetySignals(observations);
    this.collectDetectedConcerns(observations, entryDate);
  }

  build(): Pick<
    JournalSignals,
    | 'detectedConcerns'
    | 'analysisQuality'
    | 'interpretationSignals'
    | 'concernGuidance'
    | 'visualChanges'
    | 'safetySignals'
  > & {
    needsRetakeCount: number;
    trendSignals: string[];
  } {
    return {
      detectedConcerns: buildDetectedConcerns(this.detectedConcernMap),
      analysisQuality: {
        visualLabelCounts: this.visualLabelCounts,
        trendLabelCounts: this.trendLabelCounts,
        lightingQualityCounts: this.lightingQualityCounts,
        framingQualityCounts: this.framingQualityCounts,
        issueCounts: this.issueCounts,
        trendExcludedReasons: this.trendExcludedReasons,
        averageQualityScore: roundedAverage(
          this.qualityScores.reduce((sum, score) => sum + score, 0),
          this.qualityScores.length,
        ),
        usedForAnalysisImages: this.usedForAnalysisImages,
      },
      interpretationSignals: buildInterpretationSignals(
        this.interpretationMap,
        this.interpretationSourceIds,
        this.guidanceKeys,
        this.caveatKeys,
      ),
      concernGuidance: buildConcernGuidance(this.concernGuidanceMap),
      visualChanges: buildVisualChanges(this.visualChangesMap),
      safetySignals: {
        urgentReviewRecommended: this.urgentReviewRecommended,
        doctorFollowUpRecommended: this.doctorFollowUpRecommended,
        doctorFlagReasons: unique(this.doctorFlagReasons).slice(0, 10),
        safetyReasons: Array.from(this.safetyReasons).sort(),
        flaggedEntryCount: this.flaggedEntryCount,
      },
      needsRetakeCount: this.retakeCount,
      trendSignals: this.buildTrendSignals(),
    };
  }

  private collectDetectedConcerns(
    observations: AnalysisObservations | null,
    entryDate: string,
  ): void {
    for (const concern of observations?.detected_concerns ?? []) {
      const aggregate =
        this.detectedConcernMap.get(concern.concern) ??
        createDetectedConcernAggregate();
      aggregate.count += 1;
      aggregate.severities.add(concern.severity);
      for (const location of concern.locations ?? []) {
        aggregate.locations.add(location);
      }
      if (Number.isFinite(concern.confidence)) {
        aggregate.confidenceTotal += concern.confidence;
        aggregate.confidenceCount += 1;
        aggregate.maxConfidence =
          aggregate.maxConfidence === null
            ? concern.confidence
            : Math.max(aggregate.maxConfidence, concern.confidence);
      }
      if (isComparableChange(concern.change_from_previous)) {
        aggregate.changeDirections.add(concern.change_from_previous);
        this.collectVisualChange(
          concern.concern,
          concern.change_from_previous,
          concern.change_confidence ?? null,
          entryDate,
        );
      }
      this.detectedConcernMap.set(concern.concern, aggregate);
    }
  }

  private collectVisualChange(
    concern: string,
    direction: Exclude<AnalysisChangeDirection, 'not_comparable' | 'unknown'>,
    confidence: number | null,
    entryDate: string,
  ): void {
    const aggregate =
      this.visualChangesMap.get(concern) ?? createVisualChangeAggregate();
    aggregate.directions.add(direction);
    aggregate.count += 1;
    if (confidence !== null && Number.isFinite(confidence)) {
      aggregate.confidenceTotal += confidence;
      aggregate.confidenceCount += 1;
    }
    if (!aggregate.latestEntryDate || aggregate.latestEntryDate <= entryDate) {
      aggregate.latestEntryDate = entryDate;
      aggregate.latestDirection = direction;
    }
    this.visualChangesMap.set(concern, aggregate);
  }

  private collectObservationQuality(
    observations: AnalysisObservations | null,
  ): void {
    if (!observations) return;
    this.collectQualityItem(observations.image_quality);
    for (const quality of observations.per_angle_quality ?? []) {
      this.collectQualityItem(quality);
    }
  }

  private collectQualityItem(
    quality:
      | AnalysisObservations['image_quality']
      | AnalysisAngleQuality
      | null
      | undefined,
  ): void {
    if (!quality) return;
    increment(this.lightingQualityCounts, quality.lighting_quality);
    increment(this.framingQualityCounts, quality.framing_quality);
    for (const issue of quality.issues ?? [])
      increment(this.issueCounts, issue);
    const qualityScore = quality.quality_score ?? null;
    if (qualityScore !== null && Number.isFinite(qualityScore)) {
      this.qualityScores.push(qualityScore);
    }
    if ('excluded_from_trends_reason' in quality) {
      const reason = quality.excluded_from_trends_reason;
      if (reason) increment(this.trendExcludedReasons, reason);
    }
  }

  private collectInterpretationSignals(
    interpretation: PhotoAnalysisInterpretation | null,
    entryDate: string,
  ): void {
    if (!interpretation) return;
    const aggregate =
      this.interpretationMap.get(interpretation.code) ??
      createInterpretationAggregate(interpretation.severity);
    aggregate.count += 1;
    aggregate.severity = strongestSeverity(
      aggregate.severity,
      interpretation.severity,
    );
    if (!aggregate.latestEntryDate || aggregate.latestEntryDate <= entryDate) {
      aggregate.latestEntryDate = entryDate;
    }
    for (const sourceId of interpretation.source_ids ?? []) {
      aggregate.sourceIds.add(sourceId);
      this.interpretationSourceIds.add(sourceId);
    }
    for (const key of interpretation.guidance_keys ?? []) {
      this.guidanceKeys.add(key);
    }
    for (const key of interpretation.caveat_keys ?? [])
      this.caveatKeys.add(key);
    if (interpretation.reading_quality) {
      increment(
        this.visualLabelCounts,
        interpretation.reading_quality.visual_label,
      );
      increment(
        this.trendLabelCounts,
        interpretation.reading_quality.trend_label,
      );
    }
    for (const guidance of interpretation.concern_guidance ?? []) {
      this.collectConcernGuidance(guidance);
    }
    this.interpretationMap.set(interpretation.code, aggregate);
  }

  private collectConcernGuidance(guidance: PhotoAnalysisConcernGuidance): void {
    const aggregate =
      this.concernGuidanceMap.get(guidance.concern) ??
      createConcernGuidanceAggregate(guidance.severity);
    aggregate.count += 1;
    aggregate.severity = strongestSeverity(
      aggregate.severity,
      guidance.severity,
    );
    for (const location of guidance.locations ?? []) {
      aggregate.locations.add(location);
    }
    aggregate.confidenceLabels.add(guidance.confidence_label);
    addTextRefKeys(aggregate.actionKeys, guidance.action_keys);
    addTextRefKeys(aggregate.avoidKeys, guidance.avoid_keys);
    addTextRefKeys(aggregate.factorKeys, guidance.possible_factor_keys);
    addGuidanceItems(
      aggregate.possibleCauseItems,
      guidance.possible_cause_items,
    );
    addGuidanceItems(aggregate.tryNextItems, guidance.try_next_items);
    addGuidanceItems(aggregate.avoidItems, guidance.avoid_items);
    if (guidance.escalation_key) {
      aggregate.escalationKeys.add(guidance.escalation_key.key);
    }
    for (const sourceId of guidance.source_ids ?? []) {
      aggregate.sourceIds.add(sourceId);
    }
    this.concernGuidanceMap.set(guidance.concern, aggregate);
  }

  private collectSafetySignals(
    observations: AnalysisObservations | null,
  ): void {
    if (!observations) return;
    const safetyFlags = observations.safety_flags ?? null;
    const hasUrgentFlag = safetyFlags?.urgent_review_recommended === true;
    const hasDoctorFollowUp =
      safetyFlags?.doctor_follow_up_recommended === true ||
      observations.should_flag_for_doctor === true;
    const hasSafetyReason = (safetyFlags?.reasons ?? []).length > 0;
    if (hasUrgentFlag) this.urgentReviewRecommended = true;
    if (hasDoctorFollowUp) this.doctorFollowUpRecommended = true;
    for (const reason of safetyFlags?.reasons ?? [])
      this.safetyReasons.add(reason);
    if (observations.doctor_flag_reason) {
      this.doctorFlagReasons.push(
        trimForPrompt(observations.doctor_flag_reason, 120),
      );
    }
    if (
      hasUrgentFlag ||
      hasDoctorFollowUp ||
      hasSafetyReason ||
      Boolean(observations.doctor_flag_reason)
    ) {
      this.flaggedEntryCount += 1;
    }
  }

  private buildTrendSignals(): string[] {
    const signals: string[] = [];
    for (const code of this.interpretationMap.keys()) {
      signals.push(`photo_interpretation_${code}`);
    }
    for (const label of Object.keys(this.trendLabelCounts)) {
      signals.push(`photo_trend_${label}`);
    }
    for (const aggregate of this.visualChangesMap.values()) {
      for (const direction of aggregate.directions) {
        signals.push(`photo_concern_${direction}`);
      }
    }
    if (this.urgentReviewRecommended) {
      signals.push('urgent_photo_review_recommended');
    }
    if (this.doctorFollowUpRecommended) {
      signals.push('doctor_follow_up_recommended');
    }
    return unique(signals);
  }
}

import { createHash } from 'crypto';
import { ApplicationItemStatus } from '../../application-tracking/application-tracking.constants';
import {
  SUGGESTION_SAFETY_POLICY_VERSION,
  SuggestionRequestSource,
} from '../suggestions.constants';
import { SUGGESTION_PRODUCT_SCORING_VERSION } from './suggestion-product-intelligence';
import { routineBreakCacheParts } from './suggestion-routine-break-context';
import { isReactionRelatedSkipReason } from './suggestion-application-history';
import type { SuggestionContextBuilderInput } from './suggestion-context-builder.service';

export function buildSuggestionContextCacheKey(
  inputs: SuggestionContextBuilderInput,
): string {
  return createHash('sha256')
    .update(JSON.stringify(toCacheKeyParts(inputs)))
    .digest('hex')
    .slice(0, 32);
}

function toCacheKeyParts(inputs: SuggestionContextBuilderInput) {
  return {
    safetyPolicyVersion: SUGGESTION_SAFETY_POLICY_VERSION,
    productScoringVersion: SUGGESTION_PRODUCT_SCORING_VERSION,
    targetDate: inputs.targetDate,
    targetTime: inputs.targetTime,
    requestSource: inputs.requestSource ?? SuggestionRequestSource.Scheduled,
    requestContext:
      inputs.requestSource === SuggestionRequestSource.OnDemand
        ? (inputs.requestContext ?? null)
        : null,
    profile: inputs.skinProfile?.updated_at?.toISOString() ?? null,
    routineSteps: inputs.routineSteps
      .slice()
      .sort((a, b) => a.step_order - b.step_order || a.id.localeCompare(b.id))
      .map((step) => [
        step.id,
        step.updated_at?.toISOString() ?? null,
        step.inventory_product_id,
        step.step_order,
        step.step_label,
        step.is_specialist_locked,
      ]),
    products: inputs.shelfActiveProducts
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((product) => [
        product.id,
        product.updated_at?.toISOString() ?? null,
        product.status,
      ]),
    journals: inputs.recentJournalEntries
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((entry) => [
        entry.id,
        entry.updated_at?.toISOString() ?? null,
        entry.analysis_status,
        entry.analysis_version,
        entry.analysis_completed_at?.toISOString() ?? null,
        entry.analysis_input_image_count,
        entry.has_reaction_signal,
        entry.needs_retake,
        entry.overall_feel,
        entry.sleep_band,
        entry.stress_today,
        entry.sun_exposure_today,
        entry.sweat_exercise_today,
        entry.cycle_marker,
        entry.recent_change
          ? [
              entry.recent_change.kind,
              entry.recent_change.related_inventory_product_id ?? null,
            ]
          : null,
        entry.analysis_concern_keys ?? [],
        entry.analysis_observations?.reaction_signals ?? null,
        entry.analysis_observations?.barrier_signs ?? null,
        entry.analysis_observations
          ? [
              entry.analysis_observations.schema_version,
              entry.analysis_observations.model_version,
              entry.analysis_observations.overall_change_from_previous ?? null,
              entry.analysis_observations.image_quality
                ? [
                    entry.analysis_observations.image_quality.face_detected,
                    entry.analysis_observations.image_quality.lighting_quality,
                    entry.analysis_observations.image_quality.framing_quality,
                    entry.analysis_observations.image_quality.blur_detected,
                    entry.analysis_observations.image_quality.needs_retake ??
                      null,
                    entry.analysis_observations.image_quality.quality_score ??
                      null,
                    entry.analysis_observations.image_quality
                      .excluded_from_trends_reason ?? null,
                    entry.analysis_observations.image_quality.issues ?? [],
                  ]
                : null,
              entry.analysis_observations.safety_flags
                ? [
                    entry.analysis_observations.safety_flags
                      .urgent_review_recommended,
                    entry.analysis_observations.safety_flags
                      .doctor_follow_up_recommended,
                    entry.analysis_observations.safety_flags.reasons ?? [],
                  ]
                : null,
              entry.analysis_observations.should_flag_for_doctor,
            ]
          : null,
        entry.analysis_observations?.detected_concerns?.map((concern) => [
          concern.concern,
          concern.severity,
          concern.locations,
          concern.confidence,
          concern.change_from_previous ?? null,
          concern.change_confidence ?? null,
        ]) ?? [],
        entry.analysis_observations?.per_angle_quality?.map((quality) => [
          quality.angle,
          quality.face_detected,
          quality.lighting_quality,
          quality.framing_quality,
          quality.blur_detected,
          quality.issues ?? [],
          quality.used_for_analysis,
          quality.needs_retake,
          quality.quality_score ?? null,
        ]) ?? [],
        entry.analysis_interpretation
          ? [
              entry.analysis_interpretation.version,
              entry.analysis_interpretation.code,
              entry.analysis_interpretation.severity,
              entry.analysis_interpretation.summary_key,
              Object.entries(
                entry.analysis_interpretation.summary_values ?? {},
              ).sort(([firstKey], [secondKey]) =>
                firstKey.localeCompare(secondKey),
              ),
              entry.analysis_interpretation.guidance_keys ?? [],
              entry.analysis_interpretation.caveat_keys ?? [],
              entry.analysis_interpretation.source_ids ?? [],
              entry.analysis_interpretation.reading_quality
                ? [
                    entry.analysis_interpretation.reading_quality.visual_label,
                    entry.analysis_interpretation.reading_quality.trend_label,
                    (
                      entry.analysis_interpretation.reading_quality
                        .reason_keys ?? []
                    ).map((ref) => ref.key),
                  ]
                : null,
              (entry.analysis_interpretation.concern_guidance ?? []).map(
                (guidance) => [
                  guidance.concern,
                  guidance.severity,
                  guidance.locations,
                  guidance.confidence_label,
                  guidance.summary.key,
                  guidance.possible_factor_keys.map((ref) => ref.key),
                  guidance.action_keys.map((ref) => ref.key),
                  guidance.avoid_keys.map((ref) => ref.key),
                  guidance.track_key.key,
                  guidance.escalation_key?.key ?? null,
                  guidance.source_ids ?? [],
                ],
              ),
            ]
          : null,
      ]),
    logs: inputs.recentApplications
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((log) => [
        log.id,
        log.updated_at?.toISOString() ?? null,
        log.edit_count,
        log.has_been_edited,
        hasSingleSkippedItemWithReactionReason(log),
        (log.items ?? [])
          .slice()
          .sort(
            (a, b) =>
              a.step_order - b.step_order ||
              (a.id ?? '').localeCompare(b.id ?? ''),
          )
          .map((item) => [
            item.id,
            item.status,
            item.item_source,
            item.inventory_product_id,
            item.substituted_with_product_id,
            item.step_label,
            item.status === ApplicationItemStatus.Skipped &&
              isReactionRelatedSkipReason(item.notes),
            item.suggestion_step_id,
            item.is_ad_hoc,
            item.updated_at?.toISOString() ?? null,
            item.applied_at?.toISOString() ?? null,
            item.product
              ? [
                  item.product.id,
                  item.product.category,
                  item.product.updated_at?.toISOString() ?? null,
                ]
              : null,
            item.substituted_with_product
              ? [
                  item.substituted_with_product.id,
                  item.substituted_with_product.category,
                  item.substituted_with_product.updated_at?.toISOString() ??
                    null,
                ]
              : null,
          ]),
      ]),
    suggestions: (inputs.recentSuggestions ?? [])
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((suggestion) => [
        suggestion.id,
        suggestion.updated_at?.toISOString() ?? null,
        suggestion.target_date,
        suggestion.target_time,
        suggestion.daypart,
        suggestion.mode,
        suggestion.generation_status,
        (suggestion.steps ?? [])
          .slice()
          .sort(
            (a, b) =>
              a.step_order - b.step_order ||
              (a.id ?? '').localeCompare(b.id ?? ''),
          )
          .map((step) => [
            step.id,
            step.created_at?.toISOString() ?? null,
            step.step_order,
            step.inventory_product_id,
            step.step_label,
            step.provenance,
            step.product
              ? [
                  step.product.id,
                  step.product.category,
                  step.product.updated_at?.toISOString() ?? null,
                ]
              : null,
          ]),
      ]),
    routineBreaks: routineBreakCacheParts(inputs.recentRoutineBreaks ?? []),
    environment: inputs.environment
      ? {
          generatedAt: inputs.environment.generatedAt,
          status: inputs.environment.status,
          provider: inputs.environment.provider,
          season: inputs.environment.season,
          temperatureBand: inputs.environment.temperatureBand,
          humidityBand: inputs.environment.humidityBand,
          uvRisk: inputs.environment.uvRisk,
          airQualityRisk: inputs.environment.airQualityRisk,
          waterHardness: inputs.environment.waterHardness,
          waterSensitivity: inputs.environment.waterSensitivity,
          transitionSignals: inputs.environment.transitionSignals,
        }
      : null,
    aiPersonalizationAllowed: inputs.aiPersonalizationAllowed ?? true,
    aiPersonalizationBlockedReason:
      inputs.aiPersonalizationBlockedReason ?? null,
  };
}

function hasSingleSkippedItemWithReactionReason(
  log: SuggestionContextBuilderInput['recentApplications'][number],
): boolean {
  const skippedItems = (log.items ?? []).filter(
    (item) => item.status === ApplicationItemStatus.Skipped,
  );
  return (
    skippedItems.length === 1 && isReactionRelatedSkipReason(log.general_notes)
  );
}

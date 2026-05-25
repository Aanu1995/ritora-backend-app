import { createHash } from 'crypto';
import { SuggestionRequestSource } from '../suggestions.constants';
import { routineBreakCacheParts } from './suggestion-routine-break-context';
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
        entry.analysis_observations?.image_quality?.needs_retake ?? null,
        entry.analysis_observations?.detected_concerns?.map((concern) => [
          concern.concern,
          concern.severity,
          concern.locations,
          concern.change_from_previous ?? null,
        ]) ?? [],
        entry.analysis_observations?.per_angle_quality?.map((quality) => [
          quality.angle,
          quality.used_for_analysis,
          quality.needs_retake,
          quality.quality_score ?? null,
        ]) ?? [],
      ]),
    logs: inputs.recentApplications
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((log) => [
        log.id,
        log.updated_at?.toISOString() ?? null,
        log.edit_count,
        log.has_been_edited,
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

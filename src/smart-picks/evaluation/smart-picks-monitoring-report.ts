import {
  SuggestionObservabilityEventKind,
  SuggestionObservabilitySeverity,
} from '../../suggestions/suggestions.constants';
import { type SuggestionObservabilityMetadata } from '../../suggestions/entities/suggestion-observability-event.entity';

export const SMART_PICK_MONITORED_EVENT_KINDS = [
  'smart_pick_generation_completed',
  'smart_pick_generation_degraded',
  'smart_pick_ai_failed',
  'smart_pick_no_pick',
  'smart_pick_quality_drift',
  'smart_pick_unsafe_output_blocked',
  'smart_pick_user_feedback',
] as const satisfies readonly SuggestionObservabilityEventKind[];

export type SmartPickMonitoredEventKind =
  (typeof SMART_PICK_MONITORED_EVENT_KINDS)[number];

export const SMART_PICK_MONITORING_RECOMMENDED_ACTIONS = [
  'investigate_ai_provider',
  'review_safety_guardrails',
  'review_no_pick_cases',
  'review_quality_drift',
  'review_degraded_generation',
  'review_low_save_feedback',
] as const;

export type SmartPickMonitoringRecommendedAction =
  (typeof SMART_PICK_MONITORING_RECOMMENDED_ACTIONS)[number];

export interface SmartPicksMonitoringThresholds {
  noPickCount: number;
  noPickRate: number;
  aiFailureRate: number;
  minFeedbackCount: number;
  lowFeedbackSaveRate: number;
}

const DEFAULT_SMART_PICK_MONITORING_THRESHOLDS: SmartPicksMonitoringThresholds =
  {
    noPickCount: 3,
    noPickRate: 0.2,
    aiFailureRate: 0.05,
    minFeedbackCount: 10,
    lowFeedbackSaveRate: 0.25,
  };

export interface SmartPicksMonitoringEventInput {
  kind: SmartPickMonitoredEventKind;
  severity: SuggestionObservabilitySeverity;
  createdAt: Date;
  metadata?: SuggestionObservabilityMetadata;
}

export interface SmartPicksMonitoringKindSummary {
  kind: SmartPickMonitoredEventKind;
  count: number;
  warningCount: number;
  criticalCount: number;
}

export interface SmartPicksMonitoringRates {
  generationAttemptCount: number;
  aiFailureRate: number;
  degradedGenerationRate: number;
  noPickRate: number;
  unsafeOutputBlockedRate: number;
}

export interface SmartPicksMonitoringFeedbackSummary {
  savedCount: number;
  dismissedCount: number;
  totalCount: number;
  saveRate: number;
}

export interface SmartPicksMonitoringReport {
  generatedAt: string;
  windowHours: number;
  totalEvents: number;
  byKind: SmartPicksMonitoringKindSummary[];
  rates: SmartPicksMonitoringRates;
  feedback: SmartPicksMonitoringFeedbackSummary;
  thresholds: SmartPicksMonitoringThresholds;
  alerts: {
    aiFailures: boolean;
    unsafeOutputBlocked: boolean;
    noPickSpike: boolean;
    qualityDrift: boolean;
    degradedGeneration: boolean;
    lowPositiveFeedback: boolean;
  };
  recommendedActions: SmartPickMonitoringRecommendedAction[];
}

export function buildSmartPicksMonitoringReport(input: {
  events: readonly SmartPicksMonitoringEventInput[];
  generatedAt: Date;
  windowHours: number;
  noPickAlertThreshold?: number;
  thresholds?: Partial<SmartPicksMonitoringThresholds>;
}): SmartPicksMonitoringReport {
  const thresholds = {
    ...DEFAULT_SMART_PICK_MONITORING_THRESHOLDS,
    ...input.thresholds,
    ...(input.noPickAlertThreshold
      ? { noPickCount: input.noPickAlertThreshold }
      : {}),
  };
  const byKind = SMART_PICK_MONITORED_EVENT_KINDS.map((kind) => {
    const matching = input.events.filter((event) => event.kind === kind);
    return {
      kind,
      count: matching.length,
      warningCount: matching.filter((event) => event.severity === 'warning')
        .length,
      criticalCount: matching.filter((event) => event.severity === 'critical')
        .length,
    };
  });
  const countFor = (kind: SmartPickMonitoredEventKind) =>
    byKind.find((summary) => summary.kind === kind)?.count ?? 0;
  const generationAttemptCount =
    countFor('smart_pick_generation_completed') +
    countFor('smart_pick_generation_degraded') +
    countFor('smart_pick_ai_failed');
  const rateFor = (count: number) =>
    generationAttemptCount > 0 ? count / generationAttemptCount : 0;
  const feedback = summarizeFeedback(input.events);
  const rates: SmartPicksMonitoringRates = {
    generationAttemptCount,
    aiFailureRate: rateFor(countFor('smart_pick_ai_failed')),
    degradedGenerationRate: rateFor(countFor('smart_pick_generation_degraded')),
    noPickRate: rateFor(countFor('smart_pick_no_pick')),
    unsafeOutputBlockedRate: rateFor(
      countFor('smart_pick_unsafe_output_blocked'),
    ),
  };
  const alerts = {
    aiFailures:
      countFor('smart_pick_ai_failed') > 0 ||
      rates.aiFailureRate >= thresholds.aiFailureRate,
    unsafeOutputBlocked: countFor('smart_pick_unsafe_output_blocked') > 0,
    noPickSpike:
      countFor('smart_pick_no_pick') >= thresholds.noPickCount ||
      rates.noPickRate >= thresholds.noPickRate,
    qualityDrift: countFor('smart_pick_quality_drift') > 0,
    degradedGeneration: countFor('smart_pick_generation_degraded') > 0,
    lowPositiveFeedback:
      feedback.totalCount >= thresholds.minFeedbackCount &&
      feedback.saveRate <= thresholds.lowFeedbackSaveRate,
  };
  return {
    generatedAt: input.generatedAt.toISOString(),
    windowHours: input.windowHours,
    totalEvents: input.events.length,
    byKind,
    rates,
    feedback,
    thresholds,
    alerts,
    recommendedActions: recommendedActionsForAlerts(alerts),
  };
}

function summarizeFeedback(
  events: readonly SmartPicksMonitoringEventInput[],
): SmartPicksMonitoringFeedbackSummary {
  let savedCount = 0;
  let dismissedCount = 0;
  for (const event of events) {
    if (event.kind !== 'smart_pick_user_feedback') continue;
    const action = event.metadata?.action;
    if (action === 'saved') savedCount += 1;
    if (action === 'dismissed') dismissedCount += 1;
  }
  const totalCount = savedCount + dismissedCount;
  return {
    savedCount,
    dismissedCount,
    totalCount,
    saveRate: totalCount > 0 ? savedCount / totalCount : 0,
  };
}

function recommendedActionsForAlerts(
  alerts: SmartPicksMonitoringReport['alerts'],
): SmartPickMonitoringRecommendedAction[] {
  const actions: SmartPickMonitoringRecommendedAction[] = [];
  if (alerts.aiFailures) actions.push('investigate_ai_provider');
  if (alerts.unsafeOutputBlocked) actions.push('review_safety_guardrails');
  if (alerts.noPickSpike) actions.push('review_no_pick_cases');
  if (alerts.qualityDrift) actions.push('review_quality_drift');
  if (alerts.degradedGeneration) actions.push('review_degraded_generation');
  if (alerts.lowPositiveFeedback) actions.push('review_low_save_feedback');
  return actions;
}

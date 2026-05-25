import { buildEnvironmentAdaptationPolicy } from '../../environment-intelligence/environment-adaptation-policy';
import { SuggestionContextSummary } from '../suggestion-context.types';

export function buildEnvironmentSignals(
  environmentPolicy: ReturnType<typeof buildEnvironmentAdaptationPolicy>,
): NonNullable<SuggestionContextSummary['environmentSignals']> {
  return {
    signalKinds: environmentPolicy.signals.map((signal) => signal.kind),
    alerts: environmentPolicy.alerts.map((alert) => ({
      kind: alert.kind,
      title: alert.title,
      message: alert.message,
    })),
    safetyConstraints: environmentPolicy.safetyConstraints,
    gapCategories: environmentPolicy.gapRecommendations.map(
      (gap) => gap.ingredientOrCategory,
    ),
  };
}

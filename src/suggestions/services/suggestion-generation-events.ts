import { Logger } from '@nestjs/common';
import { NotificationsService } from '../../notifications/notifications.service';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import { SuggestionRequestSource } from '../suggestions.constants';
import { SuggestionGenerationOutput } from './suggestion-ai-generator';
import { SuggestionObservabilityService } from './suggestion-observability.service';

export async function dispatchSuggestionReadyNotification(params: {
  notifications: NotificationsService;
  observability: SuggestionObservabilityService;
  logger: Logger;
  userId: string;
  slotId: string | null;
  targetDate: string;
  suggestionInstanceId: string;
  jobId: string;
}): Promise<void> {
  try {
    await params.notifications.dispatch({
      userId: params.userId,
      kind: 'suggestion_ready',
      titleKey: 'notificationsPage.kinds.suggestion_ready.title',
      bodyKey: 'notificationsPage.kinds.suggestion_ready.body',
      deepLink: '/todays-suggestion',
      payload: {
        slotId: params.slotId,
        targetDate: params.targetDate,
        requestSource: params.slotId
          ? SuggestionRequestSource.Scheduled
          : SuggestionRequestSource.OnDemand,
      },
      dedupeKey: params.slotId
        ? `suggestion_ready:${params.targetDate}:${params.slotId}`
        : `suggestion_ready:on_demand:${params.suggestionInstanceId}`,
    });
  } catch (error) {
    await params.observability.record({
      kind: 'notification_failed',
      severity: 'warning',
      userId: params.userId,
      suggestionInstanceId: params.suggestionInstanceId,
      jobId: params.jobId,
      metadata: {
        notificationKind: 'suggestion_ready',
        message: error instanceof Error ? error.message : 'unknown error',
      },
    });
    params.logger.warn(
      `Failed to dispatch suggestion_ready notification: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }
}

export async function recordSuggestionGenerationOutcome(params: {
  observability: SuggestionObservabilityService;
  userId: string;
  jobId: string;
  instance: SuggestionInstance;
  output: SuggestionGenerationOutput;
}): Promise<void> {
  const fallback =
    params.output.metadata.provider === 'deterministic_baseline' ||
    params.output.metadata.model.startsWith('deterministic-baseline') ||
    params.output.metadata.model.startsWith('fallback:');
  await params.observability.record({
    kind: fallback ? 'generation_fallback' : 'generation_completed',
    severity: fallback ? 'warning' : 'info',
    userId: params.userId,
    suggestionInstanceId: params.instance.id,
    jobId: params.jobId,
    metadata: {
      model: params.output.metadata.model,
      promptVersion: params.output.metadata.promptVersion,
      durationMs: params.output.metadata.durationMs,
      estimatedCostUsd: params.output.metadata.estimatedCostUsd,
      fallbackReason: params.output.metadata.fallbackReason ?? null,
      requestSource:
        params.instance.request_source ?? SuggestionRequestSource.Scheduled,
    },
  });
}

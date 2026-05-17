import { Logger } from '@nestjs/common';
import { NotificationsService } from '../../notifications/notifications.service';
import { SuggestionInstance } from '../entities/suggestion-instance.entity';
import {
  SuggestionDaypart,
  SuggestionRequestSource,
} from '../suggestions.constants';
import {
  MAX_STEPS_PER_SLOT,
  type StepLabel,
} from '../../schedule/dto/schedule.constants';
import {
  SuggestionGenerationOutput,
  SuggestionGenerationStepOutput,
} from './suggestion-ai-generator';
import { SuggestionObservabilityService } from './suggestion-observability.service';

const MINUTES_PER_STEP_BASE = 2;
const SUGGESTION_READY_EMAIL_TEXT_MAX_LENGTH = 160;

type SuggestionReadyEmailStep = {
  title: string;
  brand: string;
};

function stripSecondsFromTime(value: string): string {
  return value.length >= 5 ? value.slice(0, 5) : value;
}

function titleFromStep(step: SuggestionGenerationStepOutput): string {
  const productName = normalizeEmailTemplateText(step.productName);
  if (productName) return productName;
  const customLabel = normalizeEmailTemplateText(step.customLabel);
  if (customLabel) return customLabel;
  return formatStepLabel(step.stepLabel);
}

function formatStepLabel(stepLabel: StepLabel): string {
  return normalizeEmailTemplateText(String(stepLabel).replace(/[-_]/g, ' '));
}

function buildEmailSteps(
  steps: SuggestionGenerationStepOutput[],
): SuggestionReadyEmailStep[] {
  return [...steps]
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .slice(0, MAX_STEPS_PER_SLOT)
    .map((step) => ({
      title: titleFromStep(step),
      brand: normalizeEmailTemplateText(step.productBrand),
    }));
}

export function estimateRoutineMinutes(
  steps: SuggestionGenerationStepOutput[],
): number {
  const waitMinutes = steps.reduce(
    (total, step) => total + safeWaitAfterMinutes(step.waitAfterMinutes),
    0,
  );
  return Math.max(1, steps.length * MINUTES_PER_STEP_BASE + waitMinutes);
}

function safeWaitAfterMinutes(value: number | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
}

function normalizeEmailTemplateText(value: string | null | undefined): string {
  const valueWithoutControlChars = [...(value ?? '')]
    .map((char) => {
      const codePoint = char.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127 ? ' ' : char;
    })
    .join('');
  const normalized = valueWithoutControlChars.replace(/\s+/g, ' ').trim();
  return normalized.slice(0, SUGGESTION_READY_EMAIL_TEXT_MAX_LENGTH);
}

export async function dispatchSuggestionReadyNotification(params: {
  notifications: NotificationsService;
  observability: SuggestionObservabilityService;
  logger: Logger;
  userId: string;
  slotId: string | null;
  targetDate: string;
  targetTime: string;
  daypart: SuggestionDaypart;
  steps: SuggestionGenerationStepOutput[];
  suggestionInstanceId: string;
  jobId: string;
}): Promise<void> {
  try {
    const stepCount = params.steps.length;
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
        daypart: params.daypart,
        slotTime: stripSecondsFromTime(params.targetTime),
        stepCount,
        minutes: estimateRoutineMinutes(params.steps),
        steps: buildEmailSteps(params.steps),
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

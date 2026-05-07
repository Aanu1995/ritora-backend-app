import { CreateOnDemandSuggestionDto } from '../dto/on-demand-suggestion.dto';
import { SuggestionRequestContextJson } from '../suggestions.constants';

export function normalizeRequestId(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

export function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code === '23505'
    : false;
}

export function buildRequestContext(
  payload: CreateOnDemandSuggestionDto,
  now: Date,
): SuggestionRequestContextJson {
  const note = payload.note?.trim() ?? '';
  return {
    intent: payload.intent,
    intensity: payload.intensity ?? 'standard',
    note: note.length > 0 ? note : null,
    activityAt: payload.activityAt ?? null,
    requestedAt: now.toISOString(),
  };
}

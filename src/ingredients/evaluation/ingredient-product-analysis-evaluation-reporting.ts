import { ConfigService } from '@nestjs/config';

const SAFE_QUEUE_NAME_MARKERS = ['test', 'dev', 'eval', 'staging', 'sandbox'];

export type IngredientProductAnalysisEvaluationGate = {
  passed: boolean;
  blockers: string[];
};

export function isSafeIngredientAnalysisEvaluationQueueUrl(
  queueUrl: string,
): boolean {
  const name = queueName(queueUrl)?.toLowerCase() ?? '';
  if (!name || name.includes('prod') || name.includes('production')) {
    return false;
  }
  return SAFE_QUEUE_NAME_MARKERS.some((marker) => name.includes(marker));
}

export function buildIngredientProductAnalysisEvaluationGate(input: {
  failedCases: number;
  sqsExercised: boolean;
  cleanupCompleted: boolean;
}): IngredientProductAnalysisEvaluationGate {
  const blockers: string[] = [];
  if (input.failedCases > 0) {
    blockers.push('One or more ingredient analysis evaluation cases failed.');
  }
  if (!input.sqsExercised) {
    blockers.push('Live SQS worker path was not exercised.');
  }
  if (!input.cleanupCompleted) {
    blockers.push('Evaluation SQS message cleanup did not complete.');
  }
  return { passed: blockers.length === 0, blockers };
}

export function readIngredientAnalysisEvaluationModel(
  configService: ConfigService,
): string {
  return (
    configService.get<string>('INGREDIENT_ANALYSIS_AI_MODEL')?.trim() ||
    configService.get<string>('INGREDIENT_EXPLANATION_AI_MODEL')?.trim() ||
    configService.get<string>('OPENAI_MODEL')?.trim() ||
    'unknown'
  );
}

export function queueName(queueUrl: string): string | null {
  const trimmed = queueUrl.trim();
  if (!trimmed) return null;
  return trimmed.split('/').filter(Boolean).at(-1) ?? null;
}

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function sanitizeForReport<T>(value: T): T {
  if (typeof value === 'string') {
    return value
      .replace(/sk-[A-Za-z0-9_-]{10,}/g, '[redacted-openai-key]')
      .replace(/\bAKIA[0-9A-Z]{12,}\b/g, '[redacted-aws-access-key]') as T;
  }
  if (Array.isArray(value)) {
    return (value as unknown[]).map((item) => sanitizeForReport(item)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        sanitizeForReport(entry),
      ]),
    ) as T;
  }
  return value;
}

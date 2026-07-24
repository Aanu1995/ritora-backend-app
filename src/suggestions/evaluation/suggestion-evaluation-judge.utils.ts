import {
  describeOpenAiPayloadIssue,
  extractOutputText,
  OpenAiResponsePayload,
  parseStructuredOutputJson,
} from '../services/suggestion-ai-contract';

const JUDGE_RETRY_BASE_DELAY_MS = 2_000;
const JUDGE_RETRY_MAX_DELAY_MS = 30_000;
const JUDGE_ERROR_DETAIL_MAX_CHARS = 240;

export class OpenAiJudgeHttpError extends Error {
  constructor(
    readonly label: string,
    readonly status: number,
    readonly retryAfterMs: number | null,
    detail?: string | null,
  ) {
    super(`${label} failed (${status})${detail ? `: ${detail}` : ''}.`);
  }
}

export async function throwJudgeHttpError(
  label: string,
  response: {
    status: number;
    headers?: { get: (name: string) => string | null };
    text?: () => Promise<string>;
  },
): Promise<never> {
  throw new OpenAiJudgeHttpError(
    label,
    response.status,
    parseJudgeRetryAfterMs(response.headers?.get('retry-after') ?? null),
    await readJudgeErrorDetail(response),
  );
}

export async function requestJudgeRubricWithRetries<T>(input: {
  attempts: number;
  label: string;
  request: () => Promise<OpenAiResponsePayload>;
  normalize: (value: unknown) => T;
}): Promise<T> {
  let lastFailure: Error | null = null;
  for (let attempt = 1; attempt <= input.attempts; attempt += 1) {
    try {
      const payload = await input.request();
      const outputText = extractOutputText(payload);
      if (!outputText) {
        const payloadIssue = describeOpenAiPayloadIssue(payload);
        throw new Error(
          `${input.label} returned no structured output${
            payloadIssue ? ` (${payloadIssue})` : ''
          }.`,
        );
      }
      return input.normalize(parseStructuredOutputJson(outputText));
    } catch (error) {
      lastFailure =
        error instanceof Error ? error : new Error(`${input.label} failed.`);
      if (attempt >= input.attempts || !isRetryableJudgeFailure(error)) {
        throw lastFailure;
      }
      const retryDelayMs = judgeRetryDelayMs(error, attempt);
      if (retryDelayMs > 0) {
        await sleep(retryDelayMs);
      }
    }
  }
  throw lastFailure ?? new Error(`${input.label} failed.`);
}

export function isRetryableJudgeFailure(error: unknown): boolean {
  if (error instanceof OpenAiJudgeHttpError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return true;
}

export function judgeRetryDelayMs(error: unknown, attempt: number): number {
  if (!(error instanceof OpenAiJudgeHttpError)) return 0;
  if (error.retryAfterMs !== null) {
    return Math.min(error.retryAfterMs, JUDGE_RETRY_MAX_DELAY_MS);
  }
  return Math.min(
    JUDGE_RETRY_BASE_DELAY_MS * attempt,
    JUDGE_RETRY_MAX_DELAY_MS,
  );
}

async function readJudgeErrorDetail(response: {
  text?: () => Promise<string>;
}): Promise<string | null> {
  try {
    const body = await response.text?.();
    if (!body?.trim()) return null;
    let detail = body;
    try {
      const parsed = JSON.parse(body) as {
        error?: { message?: string; code?: string };
      };
      detail = parsed.error?.message ?? parsed.error?.code ?? body;
    } catch {
      // Keep the raw body when it is not JSON.
    }
    return detail.trim().slice(0, JUDGE_ERROR_DETAIL_MAX_CHARS);
  } catch {
    return null;
  }
}

function parseJudgeRetryAfterMs(value: string | null): number | null {
  if (!value?.trim()) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const retryAt = Date.parse(value);
  if (Number.isNaN(retryAt)) return null;
  return Math.max(0, retryAt - Date.now());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

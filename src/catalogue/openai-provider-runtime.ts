import { ConfigService } from '@nestjs/config';
import { TimedMemoryCache } from './catalogue-memory-cache';
import type { ExtractionResult } from './openai-extraction.utils';

export const PRIMARY_REASONING_EFFORT_ENV_KEY =
  'OPENAI_PRODUCT_DISCOVERY_REASONING_EFFORT';
export const WEB_REASONING_EFFORT_ENV_KEY =
  'OPENAI_PRODUCT_DISCOVERY_WEB_REASONING_EFFORT';
export const OPENAI_CACHE_TTL_MS = 30 * 60 * 1000;
export const OPENAI_CACHE_MAX_ENTRIES = 100;

type FailureLogOptions = {
  failureLabel: string;
  timeoutMs?: number;
  optionalFallbackMessage?: string;
};

export function readReasoningEffort(
  configService: ConfigService,
  envKey: string,
  fallback: string | undefined,
): string | undefined {
  const configured = configService.get<string>(envKey)?.trim();
  const effort = configured || fallback;
  if (!effort || ['none', 'off', 'disabled'].includes(effort.toLowerCase())) {
    return undefined;
  }

  return effort;
}

export function createOpenAiExtractionCache(): TimedMemoryCache<ExtractionResult | null> {
  return new TimedMemoryCache<ExtractionResult | null>({
    ttlMs: OPENAI_CACHE_TTL_MS,
    maxEntries: OPENAI_CACHE_MAX_ENTRIES,
    shouldCacheValue: (value) => Boolean(value),
  });
}

export function formatOpenAiFailure(
  options: FailureLogOptions,
  reason: string,
): string {
  return `${options.failureLabel} failed: ${reason}${fallbackSuffix(options)}`;
}

export function formatOpenAiTimeout(options: FailureLogOptions): string {
  return `${options.failureLabel} timed out after ${options.timeoutMs}ms${fallbackSuffix(options)}`;
}

export function isOpenAiTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' ||
      error.message.toLowerCase().includes('aborted due to timeout'))
  );
}

function fallbackSuffix(options: FailureLogOptions): string {
  return options.optionalFallbackMessage
    ? `; ${options.optionalFallbackMessage}`
    : '';
}

import { createHash } from 'crypto';

export function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function hashStableValue(scope: string, value: unknown): string {
  return createHash('sha256')
    .update(scope)
    .update('\0')
    .update(stableStringify(value))
    .digest('hex');
}

function stableStringify(value: unknown): string {
  return JSON.stringify(toStableValue(value));
}

function toStableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toStableValue);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return hashBuffer(value);
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, toStableValue(nestedValue)]),
  );
}

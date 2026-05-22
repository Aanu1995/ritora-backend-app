import type { IncomingHttpHeaders } from 'http';
import type { Request } from 'express';

const TIME_ZONE_HEADER_NAMES = ['x-time-zone', 'x-timezone'] as const;

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return typeof value === 'string' ? value : null;
}

function normalizeHeaderValue(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function readTimeZoneHeaderFromHeaders(
  headers: IncomingHttpHeaders,
): string | null {
  for (const name of TIME_ZONE_HEADER_NAMES) {
    const value = normalizeHeaderValue(firstHeaderValue(headers[name]));
    if (value) return value;
  }

  return null;
}

export function readTimeZoneHeaderFromRequest(
  request: Pick<Request, 'header'>,
): string | null {
  for (const name of TIME_ZONE_HEADER_NAMES) {
    const value = normalizeHeaderValue(request.header(name) ?? null);
    if (value) return value;
  }

  return null;
}

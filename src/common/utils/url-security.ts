import { BadRequestException } from '@nestjs/common';
import { isIP } from 'net';

const MEDIA_PATH_PREFIX = '/media/';

function isPrivateIpv4Address(hostname: string): boolean {
  const segments = hostname.split('.').map((segment) => Number(segment));

  if (
    segments.length !== 4 ||
    segments.some((segment) => Number.isNaN(segment))
  ) {
    return false;
  }

  const [first, second] = segments;

  if (first === 10 || first === 127 || first === 0) {
    return true;
  }

  if (first === 169 && second === 254) {
    return true;
  }

  if (first === 172 && second >= 16 && second <= 31) {
    return true;
  }

  return first === 192 && second === 168;
}

function isPrivateIpv6Address(hostname: string): boolean {
  const normalized = hostname.toLowerCase();

  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  );
}

function hasPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  const ipVersion = isIP(normalized);

  if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
    return true;
  }

  if (normalized.endsWith('.local') || normalized.endsWith('.internal')) {
    return true;
  }

  if (ipVersion === 4) {
    return isPrivateIpv4Address(normalized);
  }

  if (ipVersion === 6) {
    return isPrivateIpv6Address(normalized);
  }

  return false;
}

export function isSafeExternalHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const protocol = url.protocol.toLowerCase();

    if (protocol !== 'http:' && protocol !== 'https:') {
      return false;
    }

    if (url.username || url.password) {
      return false;
    }

    return !hasPrivateHostname(url.hostname);
  } catch {
    return false;
  }
}

function getAllowedApiMediaOrigins(): Set<string> {
  const origins = new Set<string>();
  const apiPort = process.env.API_PORT?.trim() || '3001';

  origins.add(`http://localhost:${apiPort}`);
  origins.add(`http://127.0.0.1:${apiPort}`);
  origins.add(`https://localhost:${apiPort}`);
  origins.add(`https://127.0.0.1:${apiPort}`);

  return origins;
}

export function isSafeInventoryImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (
      url.pathname.startsWith(MEDIA_PATH_PREFIX) &&
      getAllowedApiMediaOrigins().has(url.origin)
    ) {
      return true;
    }
  } catch {
    return false;
  }

  return isSafeExternalHttpUrl(value);
}

export function assertSafeExternalHttpUrl(
  value: string | null | undefined,
  fieldName: string,
): void {
  if (!value) {
    return;
  }

  if (!isSafeExternalHttpUrl(value)) {
    throw new BadRequestException(
      `${fieldName} must be a safe external HTTP(S) URL`,
    );
  }
}

export function assertSafeInventoryImageUrl(
  value: string | null | undefined,
  fieldName: string,
): void {
  if (!value) {
    return;
  }

  if (!isSafeInventoryImageUrl(value)) {
    throw new BadRequestException(
      `${fieldName} must be a safe HTTP(S) product image URL`,
    );
  }
}

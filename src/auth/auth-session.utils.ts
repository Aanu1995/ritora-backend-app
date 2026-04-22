import { isIP } from 'node:net';

const SESSION_USER_AGENT_MAX_LENGTH = 500;

function stripControlCharacters(value: string): string {
  return Array.from(value)
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 32 && codePoint !== 127 ? character : ' ';
    })
    .join('');
}

export function sanitizeUserAgent(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const sanitized = stripControlCharacters(value).replace(/\s+/g, ' ').trim();

  if (!sanitized) {
    return null;
  }

  return sanitized.slice(0, SESSION_USER_AGENT_MAX_LENGTH);
}

export function sanitizeIpAddress(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.startsWith('::ffff:')) {
    const mappedIpv4 = trimmed.slice('::ffff:'.length);

    if (isIP(mappedIpv4) === 4) {
      return mappedIpv4;
    }
  }

  if (!trimmed || isIP(trimmed) === 0) {
    return null;
  }

  return trimmed;
}

export function maskIpAddress(value: string | null | undefined): string | null {
  const sanitized = sanitizeIpAddress(value);

  if (!sanitized) {
    return null;
  }

  if (isIP(sanitized) === 4) {
    const octets = sanitized.split('.');
    octets[3] = '0';
    return octets.join('.');
  }

  const visibleSegments = sanitized.split(':').filter(Boolean).slice(0, 3);

  if (visibleSegments.length === 0) {
    return '****';
  }

  return `${visibleSegments.join(':')}:****`;
}

import { BadRequestException } from '@nestjs/common';
import { canonicalizeTimeZone } from '../common/timezone/timezone.utils';

const TIME_ZONE_VALIDATION_MESSAGE = 'validation.timeZone.unsupported';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePreferredLanguage(preferredLanguage: string): string {
  return preferredLanguage.trim().toLowerCase();
}

export function normalizeProfileName(name: string): string {
  return name.trim();
}

export function normalizeTimeZoneOrThrow(timeZone: string): string {
  const canonicalTimeZone = canonicalizeTimeZone(timeZone);

  if (!canonicalTimeZone) {
    throw new BadRequestException(TIME_ZONE_VALIDATION_MESSAGE);
  }

  return canonicalTimeZone;
}

export function buildTimeZonePatch(timeZone: string): { time_zone: string } {
  return {
    time_zone: normalizeTimeZoneOrThrow(timeZone),
  };
}

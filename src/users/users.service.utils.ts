import { BadRequestException } from '@nestjs/common';
import { canonicalizeTimeZone } from '../common/timezone/timezone.utils';

const TIME_ZONE_VALIDATION_MESSAGE = 'validation.timeZone.unsupported';
const EMAIL_AT_SIGN = '@';
const EMAIL_PLUS_SIGN = '+';
const EMPTY_STRING = '';
const GMAIL_DOMAIN = 'gmail.com';
const GOOGLEMAIL_DOMAIN = 'googlemail.com';
const GMAIL_ALIAS_DOMAINS = new Set([GMAIL_DOMAIN, GOOGLEMAIL_DOMAIN]);

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function canonicalizeEmailForIdentity(email: string): string {
  const normalizedEmail = normalizeEmail(email);
  const atSignIndex = normalizedEmail.lastIndexOf(EMAIL_AT_SIGN);

  if (atSignIndex <= 0 || atSignIndex === normalizedEmail.length - 1) {
    return normalizedEmail;
  }

  const localPart = normalizedEmail.slice(0, atSignIndex);
  const domain = normalizedEmail.slice(atSignIndex + 1);
  const plusSignIndex = localPart.indexOf(EMAIL_PLUS_SIGN);
  const untaggedLocalPart =
    plusSignIndex === -1 ? localPart : localPart.slice(0, plusSignIndex);

  if (GMAIL_ALIAS_DOMAINS.has(domain)) {
    return `${untaggedLocalPart.replaceAll('.', EMPTY_STRING)}@${GMAIL_DOMAIN}`;
  }

  return `${untaggedLocalPart}@${domain}`;
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

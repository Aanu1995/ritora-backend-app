import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import type { AppLanguage } from './i18n';

export const LOCALE_COOKIE_NAME = 'NEXT_LOCALE';

const LOCALE_COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 365;

type LocaleCookieSameSite = 'lax' | 'strict' | 'none';

export function setLocaleCookie(
  res: Response,
  configService: ConfigService,
  language: AppLanguage,
): void {
  const cookieDomain = configService.get<string>('COOKIE_DOMAIN', '');
  const cookieSecure = configService.get<boolean>('COOKIE_SECURE', false);
  const cookieSameSite = configService.get<LocaleCookieSameSite>(
    'COOKIE_SAME_SITE',
    'lax',
  );

  const cookieOptions: {
    domain?: string;
    httpOnly: false;
    maxAge: number;
    path: string;
    sameSite: LocaleCookieSameSite;
    secure: boolean;
  } = {
    httpOnly: false,
    maxAge: LOCALE_COOKIE_MAX_AGE_MS,
    path: '/',
    sameSite: cookieSameSite,
    secure: cookieSecure,
  };

  if (cookieDomain) {
    cookieOptions.domain = cookieDomain;
  }

  res.cookie(LOCALE_COOKIE_NAME, language, cookieOptions);
}

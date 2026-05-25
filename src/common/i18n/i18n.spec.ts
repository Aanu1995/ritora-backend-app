import type { Request } from 'express';
import { normalizeLanguage, resolveRequestLanguage, translate } from './i18n';

describe('resolveRequestLanguage', () => {
  it('reads the authenticated user language when present on the request', () => {
    const request = {
      headers: {},
      body: {},
      query: {},
      user: { language: 'sv' },
    } as Request & { user: { language: string } };

    expect(resolveRequestLanguage(request)).toBe('sv');
  });

  it('reads the persisted preferred language from the authenticated user', () => {
    const request = {
      headers: {},
      body: {},
      query: {},
      user: { preferred_language: 'sv' },
    } as Request & { user: { preferred_language: string } };

    expect(resolveRequestLanguage(request)).toBe('sv');
  });

  it('reads Spanish from the Accept-Language header', () => {
    const request = {
      headers: { 'accept-language': 'es-ES,es;q=0.9,en;q=0.8' },
      body: {},
      query: {},
    } as Request;

    expect(resolveRequestLanguage(request)).toBe('es');
  });

  it('normalizes Spanish and translates supported backend messages', () => {
    expect(normalizeLanguage('es')).toBe('es');
    expect(translate('es', 'validation.language.unsupported')).toBe(
      'Elige inglés, sueco o español',
    );
  });
});

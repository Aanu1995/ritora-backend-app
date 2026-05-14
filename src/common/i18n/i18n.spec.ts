import type { Request } from 'express';
import { resolveRequestLanguage } from './i18n';

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
});

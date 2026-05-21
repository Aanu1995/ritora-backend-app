import {
  buildTotpUri,
  formatTotpSecret,
  generateRecoveryCodes,
  generateTotpCode,
  generateTotpSecret,
  normalizeRecoveryCode,
  verifyTotpCode,
} from './admin-totp';

describe('admin TOTP helpers', () => {
  it('generates app-compatible base32 TOTP secrets and otpauth URIs', () => {
    const secret = generateTotpSecret();

    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(formatTotpSecret('ABCDEFGHIJKLMNOP')).toBe('ABCD EFGH IJKL MNOP');
    expect(
      buildTotpUri({
        email: 'owner@ritora.app',
        secret: 'ABCDEFGHIJKLMNOP',
      }),
    ).toContain('otpauth://totp/Ritora%20Admin%3Aowner%40ritora.app?');
  });

  it('verifies a valid six-digit code within the current time window', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const now = new Date('2026-05-21T10:00:00.000Z');
    const code = generateTotpCode(
      secret,
      Math.floor(now.getTime() / 1000 / 30),
    );

    expect(verifyTotpCode(secret, code, now)).toEqual({
      code,
      timeStep: Math.floor(now.getTime() / 1000 / 30),
    });
    expect(verifyTotpCode(secret, '000000', now)).toBeNull();
  });

  it('generates high-entropy recovery codes with normalized comparisons', () => {
    const codes = generateRecoveryCodes();

    expect(codes).toHaveLength(10);
    expect(codes[0]).toMatch(
      /^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/,
    );
    expect(normalizeRecoveryCode('abcd-efgh ijkl-mnop')).toBe(
      'ABCDEFGHIJKLMNOP',
    );
  });
});

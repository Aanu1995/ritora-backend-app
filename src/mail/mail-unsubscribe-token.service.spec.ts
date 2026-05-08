import { ConfigService } from '@nestjs/config';
import { MailUnsubscribeTokenService } from './mail-unsubscribe-token.service';

function config(values: Record<string, string>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('MailUnsubscribeTokenService', () => {
  it('creates an opaque verifiable notification unsubscribe token', () => {
    const service = new MailUnsubscribeTokenService(
      config({ MAIL_UNSUBSCRIBE_SECRET: 's'.repeat(32) }),
    );

    const token = service.createToken(
      { userId: 'user-1', kind: 'photo_reminder' },
      new Date('2026-05-08T10:00:00.000Z'),
    );

    expect(token).not.toContain('test@example.com');
    expect(decodeFirstTokenPart(token)).not.toContain('user-1');
    expect(
      service.verifyToken(token, new Date('2026-05-08T10:01:00.000Z')),
    ).toEqual({
      userId: 'user-1',
      kind: 'photo_reminder',
    });
  });

  it('rejects tampered unsubscribe tokens', () => {
    const service = new MailUnsubscribeTokenService(
      config({ MAIL_UNSUBSCRIBE_SECRET: 's'.repeat(32) }),
    );
    const token = service.createToken(
      { userId: 'user-1', kind: 'photo_reminder' },
      new Date('2026-05-08T10:00:00.000Z'),
    );

    const tamperedToken = tamperCiphertext(token);

    expect(
      service.verifyToken(tamperedToken, new Date('2026-05-08T10:01:00.000Z')),
    ).toBeNull();
  });

  it('does not fall back to JWT_SECRET when the unsubscribe secret is missing', () => {
    const issuer = new MailUnsubscribeTokenService(
      config({ MAIL_UNSUBSCRIBE_SECRET: 's'.repeat(32) }),
    );
    const missingSecretVerifier = new MailUnsubscribeTokenService(
      config({
        JWT_SECRET: 's'.repeat(32),
        MAIL_UNSUBSCRIBE_SECRET: '',
      }),
    );
    const token = issuer.createToken(
      { userId: 'user-1', kind: 'photo_reminder' },
      new Date('2026-05-08T10:00:00.000Z'),
    );

    expect(
      missingSecretVerifier.verifyToken(
        token,
        new Date('2026-05-08T10:01:00.000Z'),
      ),
    ).toBeNull();
    expect(() =>
      missingSecretVerifier.createToken(
        { userId: 'user-1', kind: 'photo_reminder' },
        new Date('2026-05-08T10:00:00.000Z'),
      ),
    ).toThrow('MAIL_UNSUBSCRIBE_SECRET is not configured');
  });

  it('rejects expired unsubscribe tokens', () => {
    const service = new MailUnsubscribeTokenService(
      config({ MAIL_UNSUBSCRIBE_SECRET: 's'.repeat(32) }),
    );
    const token = service.createToken(
      { userId: 'user-1', kind: 'photo_reminder' },
      new Date('2026-05-08T10:00:00.000Z'),
    );

    expect(
      service.verifyToken(token, new Date('2026-06-08T10:00:01.000Z')),
    ).toBeNull();
  });
});

function decodeFirstTokenPart(token: string): string {
  const [firstPart = ''] = token.split('.');
  return Buffer.from(firstPart, 'base64url').toString('utf8');
}

function tamperCiphertext(token: string): string {
  const parts = token.split('.');
  const ciphertext = parts[2] ?? '';
  parts[2] = `${ciphertext.startsWith('A') ? 'B' : 'A'}${ciphertext.slice(1)}`;
  return parts.join('.');
}

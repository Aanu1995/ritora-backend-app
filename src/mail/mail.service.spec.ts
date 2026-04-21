import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { MailService } from './mail.service';

type SentEmailPayload = {
  from: string;
  to: string[];
  subject: string;
  html: string;
};

type SendEmailResult = {
  data: { id: string } | null;
  error: { message: string } | null;
};

function getSentEmailPayload(
  sendEmail: jest.Mock<Promise<SendEmailResult>, [SentEmailPayload]>,
  callIndex = 0,
): SentEmailPayload {
  const payload = sendEmail.mock.calls[callIndex]?.[0];

  if (!payload) {
    throw new Error(`Missing email payload for call ${callIndex}`);
  }

  return payload;
}

describe('MailService', () => {
  let resendClient: Resend;
  let sendEmail: jest.Mock<Promise<SendEmailResult>, [SentEmailPayload]>;
  let configService: ConfigService;

  beforeEach(() => {
    sendEmail = jest.fn<Promise<SendEmailResult>, [SentEmailPayload]>();
    sendEmail.mockResolvedValue({
      data: { id: 'email-123' },
      error: null,
    });

    resendClient = {
      emails: {
        send: sendEmail,
      },
    } as unknown as Resend;

    configService = {
      get: jest.fn((key: string, fallback?: string) => {
        switch (key) {
          case 'WEB_APP_URL':
            return 'http://localhost:3000';
          case 'MAIL_FROM':
            return 'onboarding@resend.dev';
          case 'RESEND_API_KEY':
            return 're_test_mock';
          default:
            return fallback;
        }
      }),
    } as unknown as ConfigService;
  });

  it('sends verification emails with rendered html and the expected url', async () => {
    const service = new MailService(resendClient, configService);

    await service.sendVerificationEmail(
      'test@example.com',
      'token-123',
      'Jane',
      'en',
    );

    const payload = getSentEmailPayload(sendEmail);

    expect(payload.from).toBe('"Ritora" <onboarding@resend.dev>');
    expect(payload.to).toEqual(['test@example.com']);
    expect(payload.subject).toBe('Verify your Ritora account');
    expect(payload.html).toContain(
      'http://localhost:3000/verify-email/token-123',
    );
    expect(payload.html).toContain('Jane');
  });

  it('sends password reset emails with rendered html and the expected url', async () => {
    const service = new MailService(resendClient, configService);

    await service.sendPasswordResetEmail(
      'test@example.com',
      'token-456',
      'Jane',
      'en',
    );

    const payload = getSentEmailPayload(sendEmail);

    expect(payload.from).toBe('"Ritora" <onboarding@resend.dev>');
    expect(payload.to).toEqual(['test@example.com']);
    expect(payload.subject).toBe('Reset your Ritora password');
    expect(payload.html).toContain(
      'http://localhost:3000/reset-password/token-456',
    );
    expect(payload.html).toContain('Jane');
  });

  it('throws when Resend reports an API error', async () => {
    sendEmail.mockResolvedValueOnce({
      data: null,
      error: { message: 'Rate limit exceeded' },
    });

    const service = new MailService(resendClient, configService);

    await expect(
      service.sendVerificationEmail(
        'test@example.com',
        'token-123',
        'Jane',
        'en',
      ),
    ).rejects.toThrow('Rate limit exceeded');
  });

  it('throws when RESEND_API_KEY is missing', async () => {
    configService = {
      get: jest.fn((key: string, fallback?: string) => {
        switch (key) {
          case 'WEB_APP_URL':
            return 'http://localhost:3000';
          case 'MAIL_FROM':
            return 'onboarding@resend.dev';
          case 'RESEND_API_KEY':
            return '';
          default:
            return fallback;
        }
      }),
    } as unknown as ConfigService;

    const service = new MailService(resendClient, configService);

    await expect(
      service.sendVerificationEmail(
        'test@example.com',
        'token-123',
        'Jane',
        'en',
      ),
    ).rejects.toThrow('RESEND_API_KEY is not configured');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sends localized Swedish verification emails', async () => {
    const service = new MailService(resendClient, configService);

    await service.sendVerificationEmail(
      'test@example.com',
      'token-123',
      'Jane',
      'sv',
    );

    const payload = getSentEmailPayload(sendEmail);

    expect(payload.subject).toBe('Verifiera ditt Ritora-konto');
    expect(payload.html).toContain('Verifiera e-post');
  });
});

import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { MailService } from './mail.service';

describe('MailService', () => {
  let resendClient: Resend;
  let sendEmail: jest.Mock;
  let configService: ConfigService;

  beforeEach(() => {
    sendEmail = jest.fn().mockResolvedValue({
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
          case 'FRONTEND_URL':
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
    );

    expect(sendEmail).toHaveBeenCalledWith({
      from: '"Ritora" <onboarding@resend.dev>',
      to: ['test@example.com'],
      subject: 'Verify your Ritora account',
      html: expect.stringContaining(
        'http://localhost:3000/verify-email#token=token-123',
      ),
    });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('Jane'),
      }),
    );
  });

  it('sends password reset emails with rendered html and the expected url', async () => {
    const service = new MailService(resendClient, configService);

    await service.sendPasswordResetEmail(
      'test@example.com',
      'token-456',
      'Jane',
    );

    expect(sendEmail).toHaveBeenCalledWith({
      from: '"Ritora" <onboarding@resend.dev>',
      to: ['test@example.com'],
      subject: 'Reset your Ritora password',
      html: expect.stringContaining(
        'http://localhost:3000/reset-password#token=token-456',
      ),
    });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('Jane'),
      }),
    );
  });

  it('throws when Resend reports an API error', async () => {
    sendEmail.mockResolvedValueOnce({
      data: null,
      error: { message: 'Rate limit exceeded' },
    });

    const service = new MailService(resendClient, configService);

    await expect(
      service.sendVerificationEmail('test@example.com', 'token-123', 'Jane'),
    ).rejects.toThrow('Rate limit exceeded');
  });

  it('throws when RESEND_API_KEY is missing', async () => {
    configService = {
      get: jest.fn((key: string, fallback?: string) => {
        switch (key) {
          case 'FRONTEND_URL':
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
      service.sendVerificationEmail('test@example.com', 'token-123', 'Jane'),
    ).rejects.toThrow('RESEND_API_KEY is not configured');
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

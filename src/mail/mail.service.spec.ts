import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';
import { MailService } from './mail.service';

describe('MailService', () => {
  const mailerService = {
    sendMail: jest.fn().mockResolvedValue(undefined),
  } as unknown as MailerService;

  const configService = {
    get: jest.fn((key: string, fallback?: string) =>
      key === 'FRONTEND_URL' ? 'http://localhost:3000' : fallback,
    ),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends verification emails with the expected template and url', async () => {
    const service = new MailService(mailerService, configService);

    await service.sendVerificationEmail(
      'test@example.com',
      'token-123',
      'Jane',
    );

    expect(mailerService.sendMail as jest.Mock).toHaveBeenCalledWith({
      to: 'test@example.com',
      subject: 'Verify your Ritora account',
      template: 'verification',
      context: {
        firstName: 'Jane',
        verificationUrl: 'http://localhost:3000/verify-email#token=token-123',
      },
    });
  });

  it('sends password reset emails with the expected template and url', async () => {
    const service = new MailService(mailerService, configService);

    await service.sendPasswordResetEmail(
      'test@example.com',
      'token-456',
      'Jane',
    );

    expect(mailerService.sendMail as jest.Mock).toHaveBeenCalledWith({
      to: 'test@example.com',
      subject: 'Reset your Ritora password',
      template: 'password-reset',
      context: {
        firstName: 'Jane',
        resetUrl: 'http://localhost:3000/reset-password#token=token-456',
      },
    });
  });
});

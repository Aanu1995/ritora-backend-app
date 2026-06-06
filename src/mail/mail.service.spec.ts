import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { MailUnsubscribeTokenService } from './mail-unsubscribe-token.service';
import { MailService } from './mail.service';

type SentEmailPayload = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  headers?: Record<string, string>;
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
  let unsubscribeTokens: MailUnsubscribeTokenService;

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

    const configValues: Record<string, string> = {
      ADMIN_WEB_APP_URL: 'http://localhost:3002',
      WEB_APP_URL: 'http://localhost:3000',
      API_PUBLIC_URL: 'http://localhost:3001/api/v1',
      MAIL_FROM: 'onboarding@resend.dev',
      NOTIFICATION_MAIL_FROM: 'notifications@resend.dev',
      SUPPORT_EMAIL: 'support@getritora.com',
      RESEND_API_KEY: 're_test_mock',
      MAIL_UNSUBSCRIBE_SECRET: 'u'.repeat(32),
    };

    configService = {
      get: jest.fn((key: string) => configValues[key]),
      getOrThrow: jest.fn((key: string) => {
        if (key in configValues) {
          return configValues[key];
        }
        throw new Error(`Missing config ${key}`);
      }),
    } as unknown as ConfigService;
    unsubscribeTokens = new MailUnsubscribeTokenService(configService);
  });

  it('sends verification emails with rendered html and the expected url', async () => {
    const service = new MailService(
      resendClient,
      configService,
      unsubscribeTokens,
    );

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
    expect(payload.html).toContain('support@getritora.com');
  });

  it('sends password reset emails with rendered html and the expected url', async () => {
    const service = new MailService(
      resendClient,
      configService,
      unsubscribeTokens,
    );

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

  it('sends admin invitation emails to the admin web app', async () => {
    const service = new MailService(
      resendClient,
      configService,
      unsubscribeTokens,
    );

    await service.sendAdminInvitationEmail(
      'ops@example.com',
      'token-admin-invite',
      'Root Admin',
      'en',
    );

    const payload = getSentEmailPayload(sendEmail);

    expect(payload.subject).toBe('You have been invited to Ritora Admin');
    expect(payload.html).toContain(
      'http://localhost:3002/reset-password/token-admin-invite',
    );
    expect(payload.html).toContain('Root Admin invited you');
  });

  it('sends admin password reset emails to the admin web app', async () => {
    const service = new MailService(
      resendClient,
      configService,
      unsubscribeTokens,
    );

    await service.sendAdminPasswordResetEmail(
      'ops@example.com',
      'token-admin-reset',
      'Ops Lead',
      'en',
    );

    const payload = getSentEmailPayload(sendEmail);

    expect(payload.subject).toBe('Reset your Ritora admin password');
    expect(payload.html).toContain(
      'http://localhost:3002/reset-password/token-admin-reset',
    );
    expect(payload.html).toContain('Ops Lead');
  });

  it('sends account deletion confirmation emails with a confirmation url', async () => {
    const service = new MailService(
      resendClient,
      configService,
      unsubscribeTokens,
    );

    await service.sendAccountDeletionConfirmationEmail(
      'test@example.com',
      'token-delete-confirm',
      'Jane',
      'en',
    );

    const payload = getSentEmailPayload(sendEmail);

    expect(payload.subject).toBe('Confirm deletion of your Ritora account');
    expect(payload.html).toContain(
      'http://localhost:3000/confirm-account-deletion/token-delete-confirm',
    );
    expect(payload.html).toContain('Jane');
  });

  it('sends scheduled deletion emails with a cancellation url', async () => {
    const service = new MailService(
      resendClient,
      configService,
      unsubscribeTokens,
    );

    await service.sendAccountDeletionScheduledEmail(
      'test@example.com',
      'token-cancel-delete',
      'Jane',
      'en',
      '2026-06-13T12:00:00.000Z',
    );

    const payload = getSentEmailPayload(sendEmail);

    expect(payload.subject).toBe(
      'Your Ritora account will be deleted on 13 June 2026',
    );
    expect(payload.html).toContain(
      'http://localhost:3000/cancel-account-deletion/token-cancel-delete',
    );
    expect(payload.html).toContain('13 June 2026');
  });

  it('sends account deletion cancellation emails', async () => {
    const service = new MailService(
      resendClient,
      configService,
      unsubscribeTokens,
    );

    await service.sendAccountDeletionCancelledEmail(
      'test@example.com',
      'Jane',
      'en',
    );

    const payload = getSentEmailPayload(sendEmail);

    expect(payload.subject).toBe('Good news, your Ritora account is staying');
    expect(payload.html).toContain('Your deletion request has been cancelled');
    expect(payload.html).toContain('http://localhost:3000/');
  });

  it('throws when Resend reports an API error', async () => {
    sendEmail.mockResolvedValueOnce({
      data: null,
      error: { message: 'Rate limit exceeded' },
    });

    const service = new MailService(
      resendClient,
      configService,
      unsubscribeTokens,
    );

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
    const configValues: Record<string, string> = {
      ADMIN_WEB_APP_URL: 'http://localhost:3002',
      WEB_APP_URL: 'http://localhost:3000',
      API_PUBLIC_URL: 'http://localhost:3001/api/v1',
      MAIL_FROM: 'onboarding@resend.dev',
      NOTIFICATION_MAIL_FROM: 'notifications@resend.dev',
      SUPPORT_EMAIL: 'support@getritora.com',
      RESEND_API_KEY: '',
      MAIL_UNSUBSCRIBE_SECRET: 'u'.repeat(32),
    };

    configService = {
      get: jest.fn((key: string) => configValues[key]),
      getOrThrow: jest.fn((key: string) => {
        if (key in configValues) {
          return configValues[key];
        }
        throw new Error(`Missing config ${key}`);
      }),
    } as unknown as ConfigService;

    unsubscribeTokens = new MailUnsubscribeTokenService(configService);
    const service = new MailService(
      resendClient,
      configService,
      unsubscribeTokens,
    );

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
    const service = new MailService(
      resendClient,
      configService,
      unsubscribeTokens,
    );

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

  it('sends localized Spanish verification emails', async () => {
    const service = new MailService(
      resendClient,
      configService,
      unsubscribeTokens,
    );

    await service.sendVerificationEmail(
      'test@example.com',
      'token-123',
      'Jane',
      'es',
    );

    const payload = getSentEmailPayload(sendEmail);

    expect(payload.subject).toBe('Verifica tu cuenta de Ritora');
    expect(payload.html).toContain('<html lang="es"');
    expect(payload.html).toContain('Confirmar correo electrónico');
  });

  it('escapes profile names in auth email templates', async () => {
    const service = new MailService(
      resendClient,
      configService,
      unsubscribeTokens,
    );

    await service.sendVerificationEmail(
      'test@example.com',
      'token-123',
      '<img src=x onerror=alert(1)>',
      'en',
    );

    const payload = getSentEmailPayload(sendEmail);
    expect(payload.html).not.toContain('<img src=x onerror=alert(1)>');
    expect(payload.html).toContain('&lt;img src');
    expect(payload.html).toContain('onerror&#x3D;alert(1)&gt;');
  });

  it('renders the photo_reminder template with translated subject and CTA', async () => {
    const service = new MailService(
      resendClient,
      configService,
      unsubscribeTokens,
    );

    await service.sendNotificationEmail({
      userId: 'user-1',
      email: 'test@example.com',
      language: 'en',
      kind: 'photo_reminder',
      firstName: 'Aanu',
      payload: { date: 'Today · 8 May', lastPhotoLabel: 'yesterday' },
      deepLink: '/journal/upload',
    });

    const payload = getSentEmailPayload(sendEmail);
    expect(payload.from).toBe('"Ritora" <notifications@resend.dev>');
    expect(payload.subject).toBe("Add today's skin photo");
    expect(payload.html).toContain("Time for today's photo, Aanu");
    expect(payload.html).toContain('http://localhost:3000/journal/upload');
    expect(payload.html).toContain(
      'http://localhost:3000/settings/notifications',
    );
    expect(payload.headers?.['List-Unsubscribe']).toContain(
      'http://localhost:3001/api/v1/notifications/email/unsubscribe?token=',
    );
    expect(payload.headers?.['List-Unsubscribe']).toContain(
      'mailto:support@getritora.com?subject=unsubscribe',
    );
    expect(payload.headers?.['List-Unsubscribe-Post']).toBe(
      'List-Unsubscribe=One-Click',
    );
  });

  it('uses the configured support email in notification copy and headers', async () => {
    const supportEmail = 'help@example.com';
    jest.spyOn(configService, 'get').mockImplementation((key: string) => {
      const values: Record<string, string> = {
        ADMIN_WEB_APP_URL: 'http://localhost:3002',
        WEB_APP_URL: 'http://localhost:3000',
        API_PUBLIC_URL: 'http://localhost:3001/api/v1',
        MAIL_FROM: 'onboarding@resend.dev',
        NOTIFICATION_MAIL_FROM: 'notifications@resend.dev',
        SUPPORT_EMAIL: supportEmail,
        RESEND_API_KEY: 're_test_mock',
        MAIL_UNSUBSCRIBE_SECRET: 'u'.repeat(32),
      };

      return values[key];
    });
    jest
      .spyOn(configService, 'getOrThrow')
      .mockImplementation((key: string) => {
        const value = configService.get<string>(key);
        if (value !== undefined) {
          return value;
        }
        throw new Error(`Missing config ${key}`);
      });
    unsubscribeTokens = new MailUnsubscribeTokenService(configService);
    const service = new MailService(
      resendClient,
      configService,
      unsubscribeTokens,
    );

    await service.sendNotificationEmail({
      userId: 'user-1',
      email: 'test@example.com',
      language: 'en',
      kind: 'photo_reminder',
      firstName: 'Aanu',
      payload: { date: 'Today', lastPhotoLabel: 'yesterday' },
      deepLink: '/journal/upload',
    });

    const payload = getSentEmailPayload(sendEmail);
    expect(payload.html).toContain(supportEmail);
    expect(payload.headers?.['List-Unsubscribe']).toContain(
      `mailto:${supportEmail}?subject=unsubscribe`,
    );
  });

  it('renders the suggestion_ready template with steps from payload', async () => {
    const service = new MailService(
      resendClient,
      configService,
      unsubscribeTokens,
    );

    await service.sendNotificationEmail({
      userId: 'user-1',
      email: 'test@example.com',
      language: 'en',
      kind: 'suggestion_ready',
      firstName: 'Aanu',
      payload: {
        slot: 'morning',
        slotTime: '6:30 AM',
        stepCount: 4,
        minutes: 6,
        steps: [
          { title: '1. Cleanser', brand: 'CeraVe' },
          { title: '2. Niacinamide', brand: 'The Ordinary' },
        ],
      },
      deepLink: '/today',
    });

    const payload = getSentEmailPayload(sendEmail);
    expect(payload.subject).toBe('Your morning routine is ready');
    expect(payload.html).toContain('1. Cleanser');
    expect(payload.html).toContain('CeraVe');
    expect(payload.html).toContain('The Ordinary');
  });

  it('derives the localized slot label from a daypart payload value', async () => {
    const service = new MailService(
      resendClient,
      configService,
      unsubscribeTokens,
    );

    await service.sendNotificationEmail({
      userId: 'user-1',
      email: 'test@example.com',
      language: 'sv',
      kind: 'suggestion_ready',
      firstName: 'Aanu',
      payload: {
        daypart: 'morning',
        slotTime: '06:30',
        stepCount: 4,
        minutes: 6,
        steps: [{ title: 'Rengöring', brand: 'CeraVe' }],
      },
      deepLink: '/today',
    });

    const payload = getSentEmailPayload(sendEmail);
    expect(payload.subject).toBe('Din morgonrutin är klar');
    expect(payload.html).toContain('morgon · 06:30');
    expect(payload.html).toContain('4 steg, ungefär 6 minuter');
    expect(payload.html).toContain('Rengöring');
    expect(payload.html).not.toContain('{{');
  });

  it('omits List-Unsubscribe headers for safety-critical reaction_detected', async () => {
    const service = new MailService(
      resendClient,
      configService,
      unsubscribeTokens,
    );

    await service.sendNotificationEmail({
      userId: 'user-1',
      email: 'test@example.com',
      language: 'en',
      kind: 'reaction_detected',
      firstName: 'Aanu',
      payload: {
        pausedItems: ['Retinol 0.3%', 'Vitamin C 15%'],
      },
      deepLink: '/today',
    });

    const payload = getSentEmailPayload(sendEmail);
    expect(payload.subject).toBe('Your routine has been paused');
    expect(payload.html).toContain('Retinol 0.3%');
    expect(payload.html).toContain('Vitamin C 15%');
    expect(payload.headers).toBeUndefined();
  });

  it('renders Swedish notification emails when language is sv', async () => {
    const service = new MailService(
      resendClient,
      configService,
      unsubscribeTokens,
    );

    await service.sendNotificationEmail({
      userId: 'user-1',
      email: 'test@example.com',
      language: 'sv',
      kind: 'photo_reminder',
      firstName: 'Aanu',
      payload: { date: 'Idag · 8 maj', lastPhotoLabel: 'igår' },
      deepLink: '/journal/upload',
    });

    const payload = getSentEmailPayload(sendEmail);
    expect(payload.subject).toBe('Lägg till dagens hudbild');
    expect(payload.html).toContain('Lägg till dagens bild');
  });

  it('renders Spanish notification emails when language is es', async () => {
    const service = new MailService(
      resendClient,
      configService,
      unsubscribeTokens,
    );

    await service.sendNotificationEmail({
      userId: 'user-1',
      email: 'test@example.com',
      language: 'es',
      kind: 'photo_reminder',
      firstName: 'Aanu',
      payload: { date: 'Hoy · 8 mayo', lastPhotoLabel: 'ayer' },
      deepLink: '/journal/upload',
    });

    const payload = getSentEmailPayload(sendEmail);
    expect(payload.subject).toBe('Añadir la foto de piel de hoy');
    expect(payload.html).toContain('<html lang="es"');
    expect(payload.html).toContain('Añade la foto de hoy');
  });

  it('escapes HTML in payload string values to prevent injection', async () => {
    const service = new MailService(
      resendClient,
      configService,
      unsubscribeTokens,
    );

    await service.sendNotificationEmail({
      userId: 'user-1',
      email: 'test@example.com',
      language: 'en',
      kind: 'photo_reminder',
      firstName: '<script>alert(1)</script>',
      payload: { date: 'Today', lastPhotoLabel: 'yesterday' },
      deepLink: '/journal/upload',
    });

    const payload = getSentEmailPayload(sendEmail);
    expect(payload.html).not.toContain('<script>alert(1)</script>');
    expect(payload.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('keeps notification action links on the configured app origin', async () => {
    const service = new MailService(
      resendClient,
      configService,
      unsubscribeTokens,
    );

    await service.sendNotificationEmail({
      userId: 'user-1',
      email: 'test@example.com',
      language: 'en',
      kind: 'photo_reminder',
      firstName: 'Aanu',
      payload: { date: 'Today', lastPhotoLabel: 'yesterday' },
      deepLink: 'https://evil.example/phish',
    });

    const payload = getSentEmailPayload(sendEmail);
    expect(payload.html).not.toContain('https://evil.example/phish');
    expect(payload.html).toContain('http://localhost:3000/');
  });

  it('escapes decorative notification glyphs from payloads', async () => {
    const service = new MailService(
      resendClient,
      configService,
      unsubscribeTokens,
    );

    await service.sendNotificationEmail({
      userId: 'user-1',
      email: 'test@example.com',
      language: 'en',
      kind: 'slot_start',
      firstName: 'Aanu',
      payload: {
        slot: 'morning',
        minutes: 5,
        stepCount: 3,
        stepFlow: 'Cleanse → SPF',
        slotGlyph: '<img src=x onerror=alert(1)>',
      },
      deepLink: '/todays-suggestion',
    });

    const payload = getSentEmailPayload(sendEmail);
    expect(payload.html).not.toContain('<img src=x onerror=alert(1)>');
    expect(payload.html).toContain('&lt;img src');
    expect(payload.html).toContain('onerror&#x3D;alert(1)&gt;');
  });
});

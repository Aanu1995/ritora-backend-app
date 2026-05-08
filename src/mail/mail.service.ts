import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Handlebars, {
  compile,
  escapeExpression,
  type TemplateDelegate,
} from 'handlebars';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { Resend } from 'resend';
import { type AppLanguage, translate } from '../common/i18n/i18n';
import {
  MailTemplateName,
  NOTIFICATION_KIND_TEMPLATE,
  NOTIFICATION_KINDS_WITHOUT_LIST_UNSUBSCRIBE,
  NOTIFICATION_PARTIALS,
  NOTIFICATION_SUPPORT_EMAIL,
  NotificationEmailKind,
  RESEND_CLIENT,
} from './mail.constants';
import { MailUnsubscribeTokenService } from './mail-unsubscribe-token.service';

type VerificationTemplateContext = {
  firstName: string;
  verificationUrl: string;
  logoUrl: string;
  previewText: string;
  title: string;
  intro: string;
  ctaLabel: string;
  expiryNote: string;
  fallbackIntro: string;
  ignoreNote: string;
  footerLineOne: string;
  footerLineTwo: string;
};

type PasswordResetTemplateContext = {
  firstName: string;
  resetUrl: string;
  logoUrl: string;
  previewText: string;
  title: string;
  intro: string;
  ctaLabel: string;
  expiryNote: string;
  fallbackIntro: string;
  unexpectedTitle: string;
  unexpectedBody: string;
  footerLine: string;
};

type NotificationBaseContext = {
  firstName: string;
  logoUrl: string;
  manageUrl: string;
  manageLabel: string;
  supportEmail: string;
  supportLine: string;
  unsubscribeUrl?: string;
  unsubscribeLabel?: string;
  footerWhy: string;
  previewText: string;
  title: string;
  intro: string;
  ctaUrl: string;
  ctaLabel: string;
};

type NotificationPhotoReminderContext = NotificationBaseContext & {
  payloadLabel: string;
  payloadTitle: string;
  payloadMeta: string;
  tipNote?: string;
};

type RoutineStep = { title: string; brand: string };

type NotificationSuggestionReadyContext = NotificationBaseContext & {
  slotLabel: string;
  stepSummary: string;
  steps: RoutineStep[];
  rationale?: string;
};

type NotificationSlotStartContext = NotificationBaseContext & {
  slotGlyph: string;
  payloadLabel: string;
  payloadTitle: string;
  payloadMeta: string;
};

type NotificationRecordingReminderContext = NotificationBaseContext & {
  slotLabel: string;
  statusLabel: string;
  stepsMeta: string;
  skipNote?: string;
};

type NotificationReactionDetectedContext = NotificationBaseContext & {
  reassurance?: string;
  pausedLabel: string;
  pausedTitle: string;
  pausedItems: string[];
  guidanceTitle: string;
  guidanceBody: string;
  disclaimer?: string;
};

type NotificationSimplificationStartedContext = NotificationBaseContext & {
  routineLabel: string;
  routineSummary: string;
  kept: string[];
  paused: string[];
  recoveryNote?: string;
};

type NotificationInsightReadyContext = NotificationBaseContext & {
  insightQuote: string;
  metric1Label: string;
  metric1Value: string;
  metric1Meta: string;
  metric2Label: string;
  metric2Value: string;
  metric2Meta: string;
  disclaimer?: string;
};

type NotificationDoctorReferralContext = NotificationBaseContext & {
  specialistLabel: string;
  specialistTitle: string;
  reasons: string[];
  prepTitle: string;
  prepBody: string;
  disclaimer?: string;
};

type NotificationWrappedReadyContext = NotificationBaseContext & {
  weekLabel: string;
  tile1Label: string;
  tile1Value: string;
  tile1Meta: string;
  tile2Label: string;
  tile2Value: string;
  tile2Meta: string;
  tile3Label: string;
  tile3Value: string;
  tile3Meta: string;
  winTitle?: string;
  winBody?: string;
  nextTitle?: string;
  nextBody?: string;
  footnote?: string;
};

type MailTemplateContextMap = {
  [MailTemplateName.Verification]: VerificationTemplateContext;
  [MailTemplateName.PasswordReset]: PasswordResetTemplateContext;
  [MailTemplateName.NotificationPhotoReminder]: NotificationPhotoReminderContext;
  [MailTemplateName.NotificationSuggestionReady]: NotificationSuggestionReadyContext;
  [MailTemplateName.NotificationSlotStart]: NotificationSlotStartContext;
  [MailTemplateName.NotificationRecordingReminder]: NotificationRecordingReminderContext;
  [MailTemplateName.NotificationReactionDetected]: NotificationReactionDetectedContext;
  [MailTemplateName.NotificationSimplificationStarted]: NotificationSimplificationStartedContext;
  [MailTemplateName.NotificationInsightReady]: NotificationInsightReadyContext;
  [MailTemplateName.NotificationDoctorReferral]: NotificationDoctorReferralContext;
  [MailTemplateName.NotificationWrappedReady]: NotificationWrappedReadyContext;
};

export type SendNotificationEmailInput = {
  userId: string;
  email: string;
  language: AppLanguage;
  kind: NotificationEmailKind;
  firstName?: string | null;
  payload?: Record<string, unknown>;
  deepLink?: string;
};

type EmailHeaders = Record<string, string>;

const EMAIL_TEXT_MAX_LENGTH = 1_000;
const EMAIL_NAME_MAX_LENGTH = 80;
const EMAIL_LIST_MAX_ITEMS = 12;

@Injectable()
export class MailService {
  private readonly webAppUrl: string;
  private readonly apiPublicUrl: string;
  private readonly authFrom: string;
  private readonly notificationFrom: string;
  private readonly apiKey: string;
  private readonly templateDir = join(__dirname, 'templates');
  private readonly templateCache = new Map<
    MailTemplateName,
    TemplateDelegate
  >();
  private partialsRegistered = false;
  private partialsRegistrationPromise: Promise<void> | null = null;

  constructor(
    @Inject(RESEND_CLIENT) private readonly resend: Resend,
    private readonly configService: ConfigService,
    private readonly unsubscribeTokens: MailUnsubscribeTokenService,
  ) {
    this.webAppUrl = this.configService.getOrThrow<string>('WEB_APP_URL');
    this.apiPublicUrl = this.resolveApiPublicUrl();
    this.apiKey = this.configService.getOrThrow<string>('RESEND_API_KEY');
    const authMailFrom = this.configService.getOrThrow<string>('MAIL_FROM');
    const notificationMailFrom =
      this.configService.get<string>('NOTIFICATION_MAIL_FROM')?.trim() ||
      authMailFrom;
    this.authFrom = formatMailFrom(authMailFrom);
    this.notificationFrom = formatMailFrom(notificationMailFrom);
  }

  async sendVerificationEmail(
    email: string,
    token: string,
    firstName: string,
    language: AppLanguage,
  ): Promise<void> {
    const safeFirstName = safeHtmlText(firstName);
    const verificationUrl = this.buildFrontendPathActionUrl(
      'verify-email',
      token,
    );
    const html = await this.renderTemplate(MailTemplateName.Verification, {
      firstName: safeFirstName,
      verificationUrl,
      logoUrl: this.buildBrandAssetUrl('ritora-logo.png'),
      previewText: translate(language, 'mail.verification.previewText'),
      title: translate(language, 'mail.verification.title', {
        firstName: safeFirstName,
      }),
      intro: translate(language, 'mail.verification.intro'),
      ctaLabel: translate(language, 'mail.verification.ctaLabel'),
      expiryNote: translate(language, 'mail.verification.expiry'),
      fallbackIntro: translate(language, 'mail.verification.fallbackIntro'),
      ignoreNote: translate(language, 'mail.verification.ignore'),
      footerLineOne: translate(language, 'mail.verification.footerLineOne'),
      footerLineTwo: translate(language, 'mail.verification.footerLineTwo'),
    });

    await this.sendEmail({
      from: this.authFrom,
      to: email,
      subject: translate(language, 'mail.subject.verification'),
      html,
    });
  }

  async sendPasswordResetEmail(
    email: string,
    token: string,
    firstName: string,
    language: AppLanguage,
  ): Promise<void> {
    const safeFirstName = safeHtmlText(firstName);
    const resetUrl = this.buildFrontendPathActionUrl('reset-password', token);
    const html = await this.renderTemplate(MailTemplateName.PasswordReset, {
      firstName: safeFirstName,
      resetUrl,
      logoUrl: this.buildBrandAssetUrl('ritora-logo.png'),
      previewText: translate(language, 'mail.passwordReset.previewText'),
      title: translate(language, 'mail.passwordReset.title'),
      intro: translate(language, 'mail.passwordReset.intro', {
        firstName: safeFirstName,
      }),
      ctaLabel: translate(language, 'mail.passwordReset.ctaLabel'),
      expiryNote: translate(language, 'mail.passwordReset.expiry'),
      fallbackIntro: translate(language, 'mail.passwordReset.fallbackIntro'),
      unexpectedTitle: translate(
        language,
        'mail.passwordReset.unexpectedTitle',
      ),
      unexpectedBody: translate(language, 'mail.passwordReset.unexpectedBody'),
      footerLine: translate(language, 'mail.passwordReset.footerLine'),
    });

    await this.sendEmail({
      from: this.authFrom,
      to: email,
      subject: translate(language, 'mail.subject.passwordReset'),
      html,
    });
  }

  async sendNotificationEmail(
    input: SendNotificationEmailInput,
  ): Promise<void> {
    const { email, language, kind, payload = {}, deepLink } = input;
    const safeFirstName = safeHtmlText(
      input.firstName,
      fallbackFirstName(language),
    );
    const stringPayload = extractStringValues(payload);
    const translateValues: Record<string, string | number> = {
      firstName: safeFirstName,
      ...stringPayload,
    };

    const subject = translate(
      language,
      `mail.subject.${kind}`,
      translateValues,
    );
    const ctaUrl = this.buildAppUrl(deepLink ?? '/');
    const safeCtaUrl = escapeExpression(ctaUrl);
    const manageUrl = this.buildAppUrl('/settings/notifications');
    const safeManageUrl = escapeExpression(manageUrl);
    const includeUnsubscribe =
      !NOTIFICATION_KINDS_WITHOUT_LIST_UNSUBSCRIBE.has(kind);
    const unsubscribeUrl = includeUnsubscribe
      ? this.buildAppUrl(`/settings/notifications?unsubscribe=${kind}`)
      : undefined;
    const oneClickUnsubscribeUrl = includeUnsubscribe
      ? this.buildEmailUnsubscribeUrl(input.userId, kind)
      : undefined;
    const safeUnsubscribeUrl = unsubscribeUrl
      ? escapeExpression(unsubscribeUrl)
      : undefined;

    const baseContext: NotificationBaseContext = {
      firstName: safeFirstName,
      logoUrl: this.buildBrandAssetUrl('ritora-logo.png'),
      manageUrl: safeManageUrl,
      manageLabel: translate(language, 'mail.notification.shared.manageLabel'),
      supportEmail: NOTIFICATION_SUPPORT_EMAIL,
      supportLine: translate(language, 'mail.notification.shared.supportLine'),
      unsubscribeUrl: safeUnsubscribeUrl,
      unsubscribeLabel: includeUnsubscribe
        ? translate(language, `mail.notification.${kind}.unsubscribeLabel`)
        : undefined,
      footerWhy: translate(language, `mail.notification.${kind}.footerWhy`),
      previewText: translate(
        language,
        `mail.notification.${kind}.previewText`,
        translateValues,
      ),
      title: translate(
        language,
        `mail.notification.${kind}.title`,
        translateValues,
      ),
      intro: translate(
        language,
        `mail.notification.${kind}.intro`,
        translateValues,
      ),
      ctaUrl: safeCtaUrl,
      ctaLabel: translate(
        language,
        `mail.notification.${kind}.ctaLabel`,
        translateValues,
      ),
    };

    const templateName = NOTIFICATION_KIND_TEMPLATE[kind];
    const html = await this.renderNotificationTemplate(
      kind,
      templateName,
      baseContext,
      translateValues,
      payload,
      language,
    );

    const headers: EmailHeaders | undefined = includeUnsubscribe
      ? this.buildListUnsubscribeHeaders(oneClickUnsubscribeUrl!)
      : undefined;

    await this.sendEmail({
      from: this.notificationFrom,
      to: email,
      subject,
      html,
      headers,
    });
  }

  private async renderNotificationTemplate(
    kind: NotificationEmailKind,
    templateName: MailTemplateName,
    base: NotificationBaseContext,
    values: Record<string, string | number>,
    payload: Record<string, unknown>,
    language: AppLanguage,
  ): Promise<string> {
    switch (kind) {
      case 'photo_reminder':
        return this.renderTemplate(MailTemplateName.NotificationPhotoReminder, {
          ...base,
          payloadLabel: translate(
            language,
            'mail.notification.photo_reminder.payloadLabel',
            values,
          ),
          payloadTitle: translate(
            language,
            'mail.notification.photo_reminder.payloadTitle',
            values,
          ),
          payloadMeta: translate(
            language,
            'mail.notification.photo_reminder.payloadMeta',
            values,
          ),
          tipNote: translate(
            language,
            'mail.notification.photo_reminder.tipNote',
            values,
          ),
        } satisfies NotificationPhotoReminderContext);

      case 'suggestion_ready':
        return this.renderTemplate(
          MailTemplateName.NotificationSuggestionReady,
          {
            ...base,
            slotLabel: translate(
              language,
              'mail.notification.suggestion_ready.slotLabel',
              values,
            ),
            stepSummary: translate(
              language,
              'mail.notification.suggestion_ready.stepSummary',
              values,
            ),
            steps: extractRoutineSteps(payload),
            rationale: translate(
              language,
              'mail.notification.suggestion_ready.rationale',
              values,
            ),
          } satisfies NotificationSuggestionReadyContext,
        );

      case 'slot_start':
        return this.renderTemplate(MailTemplateName.NotificationSlotStart, {
          ...base,
          slotGlyph: stringFromPayload(payload.slotGlyph) || '☀️',
          payloadLabel: translate(
            language,
            'mail.notification.slot_start.payloadLabel',
            values,
          ),
          payloadTitle: translate(
            language,
            'mail.notification.slot_start.payloadTitle',
            values,
          ),
          payloadMeta: translate(
            language,
            'mail.notification.slot_start.payloadMeta',
            values,
          ),
        } satisfies NotificationSlotStartContext);

      case 'recording_reminder':
        return this.renderTemplate(
          MailTemplateName.NotificationRecordingReminder,
          {
            ...base,
            slotLabel: translate(
              language,
              'mail.notification.recording_reminder.slotLabel',
              values,
            ),
            statusLabel: translate(
              language,
              'mail.notification.recording_reminder.statusLabel',
              values,
            ),
            stepsMeta: translate(
              language,
              'mail.notification.recording_reminder.stepsMeta',
              values,
            ),
            skipNote:
              typeof payload.skipUrl === 'string'
                ? translate(
                    language,
                    'mail.notification.recording_reminder.skipNote',
                    {
                      ...values,
                      skipUrl: escapeExpression(
                        this.buildAppUrl(payload.skipUrl, '/todays-suggestion'),
                      ),
                    },
                  )
                : undefined,
          } satisfies NotificationRecordingReminderContext,
        );

      case 'reaction_detected': {
        const items = extractStringList(payload.pausedItems);
        return this.renderTemplate(
          MailTemplateName.NotificationReactionDetected,
          {
            ...base,
            reassurance: translate(
              language,
              'mail.notification.reaction_detected.reassurance',
              values,
            ),
            pausedLabel: translate(
              language,
              'mail.notification.reaction_detected.pausedLabel',
              values,
            ),
            pausedTitle: translate(
              language,
              'mail.notification.reaction_detected.pausedTitle',
              { ...values, count: items.length },
            ),
            pausedItems: items,
            guidanceTitle: translate(
              language,
              'mail.notification.reaction_detected.guidanceTitle',
              values,
            ),
            guidanceBody: translate(
              language,
              'mail.notification.reaction_detected.guidanceBody',
              values,
            ),
            disclaimer: translate(
              language,
              'mail.notification.reaction_detected.disclaimer',
              values,
            ),
          } satisfies NotificationReactionDetectedContext,
        );
      }

      case 'simplification_started':
        return this.renderTemplate(
          MailTemplateName.NotificationSimplificationStarted,
          {
            ...base,
            routineLabel: translate(
              language,
              'mail.notification.simplification_started.routineLabel',
              values,
            ),
            routineSummary: translate(
              language,
              'mail.notification.simplification_started.routineSummary',
              values,
            ),
            kept: extractStringList(payload.kept),
            paused: extractStringList(payload.paused),
            recoveryNote: translate(
              language,
              'mail.notification.simplification_started.recoveryNote',
              values,
            ),
          } satisfies NotificationSimplificationStartedContext,
        );

      case 'insight_ready':
        return this.renderTemplate(MailTemplateName.NotificationInsightReady, {
          ...base,
          insightQuote: stringFromPayload(payload.insightQuote),
          metric1Label: stringFromPayload(payload.metric1Label),
          metric1Value: stringFromPayload(payload.metric1Value),
          metric1Meta: stringFromPayload(payload.metric1Meta),
          metric2Label: stringFromPayload(payload.metric2Label),
          metric2Value: stringFromPayload(payload.metric2Value),
          metric2Meta: stringFromPayload(payload.metric2Meta),
          disclaimer: translate(
            language,
            'mail.notification.insight_ready.disclaimer',
            values,
          ),
        } satisfies NotificationInsightReadyContext);

      case 'doctor_referral':
        return this.renderTemplate(
          MailTemplateName.NotificationDoctorReferral,
          {
            ...base,
            specialistLabel: translate(
              language,
              'mail.notification.doctor_referral.specialistLabel',
              values,
            ),
            specialistTitle: translate(
              language,
              'mail.notification.doctor_referral.specialistTitle',
              values,
            ),
            reasons: extractStringList(payload.reasons),
            prepTitle: translate(
              language,
              'mail.notification.doctor_referral.prepTitle',
              values,
            ),
            prepBody: translate(
              language,
              'mail.notification.doctor_referral.prepBody',
              values,
            ),
            disclaimer: translate(
              language,
              'mail.notification.doctor_referral.disclaimer',
              values,
            ),
          } satisfies NotificationDoctorReferralContext,
        );

      case 'wrapped_ready':
        return this.renderTemplate(MailTemplateName.NotificationWrappedReady, {
          ...base,
          weekLabel: translate(
            language,
            'mail.notification.wrapped_ready.weekLabel',
            values,
          ),
          tile1Label: stringFromPayload(payload.tile1Label),
          tile1Value: stringFromPayload(payload.tile1Value),
          tile1Meta: stringFromPayload(payload.tile1Meta),
          tile2Label: stringFromPayload(payload.tile2Label),
          tile2Value: stringFromPayload(payload.tile2Value),
          tile2Meta: stringFromPayload(payload.tile2Meta),
          tile3Label: stringFromPayload(payload.tile3Label),
          tile3Value: stringFromPayload(payload.tile3Value),
          tile3Meta: stringFromPayload(payload.tile3Meta),
          winTitle: optionalStringFromPayload(payload.winTitle),
          winBody: optionalStringFromPayload(payload.winBody),
          nextTitle: optionalStringFromPayload(payload.nextTitle),
          nextBody: optionalStringFromPayload(payload.nextBody),
          footnote: translate(
            language,
            'mail.notification.wrapped_ready.footnote',
            values,
          ),
        } satisfies NotificationWrappedReadyContext);

      default: {
        const _exhaustive: never = kind;
        throw new Error(
          `Unsupported notification kind for email template: ${String(_exhaustive)} (template ${templateName})`,
        );
      }
    }
  }

  private buildListUnsubscribeHeaders(unsubscribeUrl: string): EmailHeaders {
    return {
      'List-Unsubscribe': `<${unsubscribeUrl}>, <mailto:${NOTIFICATION_SUPPORT_EMAIL}?subject=unsubscribe>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }

  private async sendEmail(payload: {
    from: string;
    to: string;
    subject: string;
    html: string;
    headers?: EmailHeaders;
  }): Promise<void> {
    if (!this.apiKey) {
      throw new Error(
        'RESEND_API_KEY is not configured. Add it to your environment before sending email.',
      );
    }

    const { error } = await this.resend.emails.send({
      from: payload.from,
      to: [payload.to],
      subject: payload.subject,
      html: payload.html,
      headers: payload.headers,
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  private async renderTemplate<TTemplate extends MailTemplateName>(
    templateName: TTemplate,
    context: MailTemplateContextMap[TTemplate],
  ): Promise<string> {
    const compiledTemplate = await this.getTemplate(templateName);
    return compiledTemplate(context);
  }

  private async getTemplate(
    templateName: MailTemplateName,
  ): Promise<TemplateDelegate> {
    await this.ensurePartialsRegistered();

    const cachedTemplate = this.templateCache.get(templateName);
    if (cachedTemplate) {
      return cachedTemplate;
    }

    const templatePath = join(this.templateDir, `${templateName}.hbs`);
    const source = await readFile(templatePath, 'utf8');
    const compiledTemplate = compile(source, {
      strict: true,
      noEscape: true,
    });

    this.templateCache.set(templateName, compiledTemplate);
    return compiledTemplate;
  }

  private async ensurePartialsRegistered(): Promise<void> {
    if (this.partialsRegistered) {
      return;
    }

    if (this.partialsRegistrationPromise) {
      await this.partialsRegistrationPromise;
      return;
    }

    this.partialsRegistrationPromise = this.registerPartials();
    await this.partialsRegistrationPromise;
  }

  private async registerPartials(): Promise<void> {
    try {
      for (const partial of NOTIFICATION_PARTIALS) {
        const partialPath = join(
          this.templateDir,
          'partials',
          partial.fileName,
        );
        const source = await readFile(partialPath, 'utf8');
        Handlebars.registerPartial(partial.name, source);
      }

      this.partialsRegistered = true;
    } catch (error) {
      this.partialsRegistrationPromise = null;
      throw error;
    }
  }

  private buildFrontendPathActionUrl(path: string, token: string): string {
    const base = new URL(this.webAppUrl);
    const basePath = base.pathname.replace(/\/$/, '');
    base.pathname = `${basePath}/${path}/${encodeURIComponent(token)}`;
    base.search = '';
    base.hash = '';
    return base.toString();
  }

  private buildBrandAssetUrl(fileName: string): string {
    const base = new URL(this.webAppUrl);
    const basePath = base.pathname.replace(/\/$/, '');
    base.pathname = `${basePath}/brand/${fileName}`;
    base.search = '';
    base.hash = '';
    return base.toString();
  }

  private resolveApiPublicUrl(): string {
    const configuredApiPublicUrl = this.configService
      .get<string>('API_PUBLIC_URL')
      ?.trim();
    if (configuredApiPublicUrl) {
      return configuredApiPublicUrl;
    }

    const base = new URL(this.webAppUrl);
    const apiPort = String(
      this.configService.get<string | number>('API_PORT') ?? '3001',
    );
    base.port = apiPort;
    base.pathname = '/api/v1';
    base.search = '';
    base.hash = '';
    return base.toString();
  }

  private buildEmailUnsubscribeUrl(
    userId: string,
    kind: NotificationEmailKind,
  ): string {
    const base = new URL(this.apiPublicUrl);
    const basePath = base.pathname.replace(/\/$/, '');
    base.pathname = `${basePath}/notifications/email/unsubscribe`;
    base.search = '';
    base.searchParams.set(
      'token',
      this.unsubscribeTokens.createToken({ userId, kind }),
    );
    base.hash = '';
    return base.toString();
  }

  private buildAppUrl(pathOrUrl: string, fallbackPath = '/'): string {
    const fallbackUrl = this.buildInternalAppUrl(fallbackPath);
    const trimmedPathOrUrl = pathOrUrl.trim();

    if (/^https?:\/\//i.test(trimmedPathOrUrl)) {
      try {
        const appBase = new URL(this.webAppUrl);
        const appOrigin = appBase.origin;
        const appBasePath = appBase.pathname.replace(/\/$/, '');
        const candidate = new URL(trimmedPathOrUrl);
        const isOutsideConfiguredAppPath =
          appBasePath &&
          candidate.pathname !== appBasePath &&
          !candidate.pathname.startsWith(`${appBasePath}/`);
        if (candidate.origin !== appOrigin || isOutsideConfiguredAppPath) {
          return fallbackUrl;
        }
        candidate.hash = '';
        return candidate.toString();
      } catch {
        return fallbackUrl;
      }
    }

    try {
      return this.buildInternalAppUrl(trimmedPathOrUrl);
    } catch {
      return fallbackUrl;
    }
  }

  private buildInternalAppUrl(pathOrUrl: string): string {
    const base = new URL(this.webAppUrl);
    const basePath = base.pathname.replace(/\/$/, '');
    const hashlessPathOrUrl = pathOrUrl.split('#')[0] ?? '/';
    const queryStartIndex = hashlessPathOrUrl.indexOf('?');
    const pathPart =
      queryStartIndex >= 0
        ? hashlessPathOrUrl.slice(0, queryStartIndex)
        : hashlessPathOrUrl;
    const queryPart =
      queryStartIndex >= 0 ? hashlessPathOrUrl.slice(queryStartIndex + 1) : '';
    const normalizedPath = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
    base.pathname = `${basePath}${normalizedPath}`;
    base.search = queryPart ? `?${queryPart}` : '';
    base.hash = '';
    return base.toString();
  }
}

function fallbackFirstName(language: AppLanguage): string {
  return language === 'sv' ? 'du' : 'there';
}

function formatMailFrom(email: string): string {
  return `"Ritora" <${email.trim()}>`;
}

function safeHtmlText(value: string | null | undefined, fallback = ''): string {
  return escapeExpression(
    normalizeTemplateText(value, EMAIL_NAME_MAX_LENGTH) ||
      normalizeTemplateText(fallback, EMAIL_NAME_MAX_LENGTH),
  );
}

function extractStringValues(
  payload: Record<string, unknown>,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string') {
      out[key] = escapeExpression(normalizeTemplateText(value));
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    }
  }
  return out;
}

function extractStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === 'string')
    .slice(0, EMAIL_LIST_MAX_ITEMS)
    .map((item) => escapeExpression(normalizeTemplateText(item)));
}

function extractRoutineSteps(payload: Record<string, unknown>): RoutineStep[] {
  const value = payload.steps;
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(
      (item): item is { title: unknown; brand: unknown } =>
        typeof item === 'object' && item !== null,
    )
    .slice(0, EMAIL_LIST_MAX_ITEMS)
    .map((item) => ({
      title:
        typeof item.title === 'string'
          ? escapeExpression(normalizeTemplateText(item.title))
          : '',
      brand:
        typeof item.brand === 'string'
          ? escapeExpression(normalizeTemplateText(item.brand))
          : '',
    }));
}

function stringFromPayload(value: unknown): string {
  return typeof value === 'string'
    ? escapeExpression(normalizeTemplateText(value))
    : '';
}

function optionalStringFromPayload(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = normalizeTemplateText(value);
  return normalized ? escapeExpression(normalized) : undefined;
}

function normalizeTemplateText(
  value: string | null | undefined,
  maxLength = EMAIL_TEXT_MAX_LENGTH,
): string {
  const valueWithoutControlChars = [...(value ?? '')]
    .map((char) => {
      const codePoint = char.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127 ? ' ' : char;
    })
    .join('');
  const normalized = valueWithoutControlChars.replace(/\s+/g, ' ').trim();
  return normalized.slice(0, maxLength);
}

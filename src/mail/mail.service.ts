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
  EMAIL_LOGO_URL,
  MailTemplateName,
  NOTIFICATION_KIND_TEMPLATE,
  NOTIFICATION_KINDS_WITHOUT_LIST_UNSUBSCRIBE,
  NOTIFICATION_PARTIALS,
  NotificationEmailKind,
  RESEND_CLIENT,
} from './mail.constants';
import { MailUnsubscribeTokenService } from './mail-unsubscribe-token.service';

type VerificationTemplateContext = {
  htmlLang: AppLanguage;
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
  htmlLang: AppLanguage;
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

type AccountDeletionTimelineStep = {
  marker: string;
  title: string;
  body: string;
};

type AccountDeletionActionTemplateContext = {
  htmlLang: AppLanguage;
  firstName: string;
  actionUrl: string;
  logoUrl: string;
  previewText: string;
  badgeLabel: string;
  title: string;
  intro: string;
  ctaLabel: string;
  sectionTitle: string;
  sectionItems: AccountDeletionTimelineStep[];
  sectionStyle: 'timeline' | 'checklist';
  note: string;
  fallbackIntro: string;
  ignoreNote?: string;
  footerLine: string;
};

type NotificationBaseContext = {
  htmlLang: AppLanguage;
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
  [MailTemplateName.AccountDeletionConfirm]: AccountDeletionActionTemplateContext;
  [MailTemplateName.AccountDeletionScheduled]: AccountDeletionActionTemplateContext;
  [MailTemplateName.AccountDeletionCancelled]: AccountDeletionActionTemplateContext;
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
  private readonly adminWebAppUrl: string;
  private readonly apiPublicUrl: string;
  private readonly authFrom: string;
  private readonly notificationFrom: string;
  private readonly supportEmail: string;
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
    this.adminWebAppUrl =
      this.configService.get<string>('ADMIN_WEB_APP_URL')?.trim() ||
      this.webAppUrl;
    this.apiPublicUrl = this.resolveApiPublicUrl();
    this.apiKey = this.configService.getOrThrow<string>('RESEND_API_KEY');
    this.supportEmail = this.configService
      .getOrThrow<string>('SUPPORT_EMAIL')
      .trim();
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
    const translateValues = {
      firstName: safeFirstName,
      supportEmail: this.supportEmail,
    };
    const verificationUrl = this.buildFrontendPathActionUrl(
      'verify-email',
      token,
    );
    const html = await this.renderTemplate(MailTemplateName.Verification, {
      htmlLang: language,
      firstName: safeFirstName,
      verificationUrl,
      logoUrl: EMAIL_LOGO_URL,
      previewText: translate(
        language,
        'mail.verification.previewText',
        translateValues,
      ),
      title: translate(language, 'mail.verification.title', translateValues),
      intro: translate(language, 'mail.verification.intro', translateValues),
      ctaLabel: translate(
        language,
        'mail.verification.ctaLabel',
        translateValues,
      ),
      expiryNote: translate(
        language,
        'mail.verification.expiry',
        translateValues,
      ),
      fallbackIntro: translate(
        language,
        'mail.verification.fallbackIntro',
        translateValues,
      ),
      ignoreNote: translate(
        language,
        'mail.verification.ignore',
        translateValues,
      ),
      footerLineOne: translate(
        language,
        'mail.verification.footerLineOne',
        translateValues,
      ),
      footerLineTwo: translate(
        language,
        'mail.verification.footerLineTwo',
        translateValues,
      ),
    });

    await this.sendEmail({
      from: this.authFrom,
      to: email,
      subject: translate(
        language,
        'mail.subject.verification',
        translateValues,
      ),
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
    const translateValues = {
      firstName: safeFirstName,
      supportEmail: this.supportEmail,
    };
    const resetUrl = this.buildFrontendPathActionUrl('reset-password', token);
    const html = await this.renderTemplate(MailTemplateName.PasswordReset, {
      htmlLang: language,
      firstName: safeFirstName,
      resetUrl,
      logoUrl: EMAIL_LOGO_URL,
      previewText: translate(
        language,
        'mail.passwordReset.previewText',
        translateValues,
      ),
      title: translate(language, 'mail.passwordReset.title', translateValues),
      intro: translate(language, 'mail.passwordReset.intro', translateValues),
      ctaLabel: translate(
        language,
        'mail.passwordReset.ctaLabel',
        translateValues,
      ),
      expiryNote: translate(
        language,
        'mail.passwordReset.expiry',
        translateValues,
      ),
      fallbackIntro: translate(
        language,
        'mail.passwordReset.fallbackIntro',
        translateValues,
      ),
      unexpectedTitle: translate(
        language,
        'mail.passwordReset.unexpectedTitle',
        translateValues,
      ),
      unexpectedBody: translate(
        language,
        'mail.passwordReset.unexpectedBody',
        translateValues,
      ),
      footerLine: translate(
        language,
        'mail.passwordReset.footerLine',
        translateValues,
      ),
    });

    await this.sendEmail({
      from: this.authFrom,
      to: email,
      subject: translate(
        language,
        'mail.subject.passwordReset',
        translateValues,
      ),
      html,
    });
  }

  async sendAdminInvitationEmail(
    email: string,
    token: string,
    invitedByName: string,
    language: AppLanguage,
  ): Promise<void> {
    const safeInvitedByName = safeHtmlText(invitedByName, 'Ritora');
    const translateValues = {
      invitedByName: safeInvitedByName,
      supportEmail: this.supportEmail,
    };
    const inviteUrl = this.buildAdminPathActionUrl('reset-password', token);
    const html = await this.renderTemplate(MailTemplateName.PasswordReset, {
      htmlLang: language,
      firstName: safeInvitedByName,
      resetUrl: inviteUrl,
      logoUrl: EMAIL_LOGO_URL,
      previewText: translate(
        language,
        'mail.adminInvitation.previewText',
        translateValues,
      ),
      title: translate(language, 'mail.adminInvitation.title', translateValues),
      intro: translate(language, 'mail.adminInvitation.intro', translateValues),
      ctaLabel: translate(
        language,
        'mail.adminInvitation.ctaLabel',
        translateValues,
      ),
      expiryNote: translate(
        language,
        'mail.adminInvitation.expiry',
        translateValues,
      ),
      fallbackIntro: translate(
        language,
        'mail.passwordReset.fallbackIntro',
        translateValues,
      ),
      unexpectedTitle: translate(
        language,
        'mail.adminInvitation.unexpectedTitle',
        translateValues,
      ),
      unexpectedBody: translate(
        language,
        'mail.adminInvitation.unexpectedBody',
        translateValues,
      ),
      footerLine: translate(
        language,
        'mail.adminInvitation.footerLine',
        translateValues,
      ),
    });

    await this.sendEmail({
      from: this.authFrom,
      to: email,
      subject: translate(
        language,
        'mail.subject.adminInvitation',
        translateValues,
      ),
      html,
    });
  }

  async sendAdminPasswordResetEmail(
    email: string,
    token: string,
    name: string,
    language: AppLanguage,
  ): Promise<void> {
    const safeName = safeHtmlText(name);
    const translateValues = {
      firstName: safeName,
      supportEmail: this.supportEmail,
    };
    const resetUrl = this.buildAdminPathActionUrl('reset-password', token);
    const html = await this.renderTemplate(MailTemplateName.PasswordReset, {
      htmlLang: language,
      firstName: safeName,
      resetUrl,
      logoUrl: EMAIL_LOGO_URL,
      previewText: translate(
        language,
        'mail.adminPasswordReset.previewText',
        translateValues,
      ),
      title: translate(
        language,
        'mail.adminPasswordReset.title',
        translateValues,
      ),
      intro: translate(
        language,
        'mail.adminPasswordReset.intro',
        translateValues,
      ),
      ctaLabel: translate(
        language,
        'mail.adminPasswordReset.ctaLabel',
        translateValues,
      ),
      expiryNote: translate(
        language,
        'mail.passwordReset.expiry',
        translateValues,
      ),
      fallbackIntro: translate(
        language,
        'mail.passwordReset.fallbackIntro',
        translateValues,
      ),
      unexpectedTitle: translate(
        language,
        'mail.passwordReset.unexpectedTitle',
        translateValues,
      ),
      unexpectedBody: translate(
        language,
        'mail.passwordReset.unexpectedBody',
        translateValues,
      ),
      footerLine: translate(
        language,
        'mail.adminPasswordReset.footerLine',
        translateValues,
      ),
    });

    await this.sendEmail({
      from: this.authFrom,
      to: email,
      subject: translate(
        language,
        'mail.subject.adminPasswordReset',
        translateValues,
      ),
      html,
    });
  }

  buildAdminPasswordResetUrl(token: string): string {
    return this.buildAdminPathActionUrl('reset-password', token);
  }

  async sendAdminAccountMonitoringAlertEmail(input: {
    email: string;
    flagId: string;
    ownerName: string;
    reason: 'assigned' | 'created' | 'refreshed';
    severity: string;
    signalType: string;
    status: string;
    summary: string;
    userEmail: string;
  }): Promise<void> {
    const dashboardUrl = this.buildAdminUrl(
      `/account-monitoring?flagId=${encodeURIComponent(input.flagId)}`,
    );
    const reasonLabel =
      input.reason === 'assigned'
        ? 'assigned to you'
        : input.reason === 'refreshed'
          ? 'refreshed after severity escalation'
          : 'created';
    const safeOwnerName = safeHtmlText(input.ownerName, 'Admin');
    const safeSummary = safeHtmlText(input.summary, 'Account monitoring alert');
    const safeUserEmail = safeHtmlText(input.userEmail, 'user');
    const safeSignalType = safeHtmlText(input.signalType);
    const safeSeverity = safeHtmlText(input.severity);
    const safeStatus = safeHtmlText(input.status);
    const safeReason = safeHtmlText(reasonLabel);
    const safeDashboardUrl = escapeExpression(dashboardUrl);
    const html = `
      <div style="font-family:Inter,Arial,sans-serif;line-height:1.55;color:#1f2924;background:#f8f7f3;padding:24px">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #dde3dc;border-radius:16px;padding:28px">
          <img src="${EMAIL_LOGO_URL}" alt="Ritora" width="120" style="display:block;margin-bottom:24px" />
          <p style="margin:0 0 12px;color:#66736b">Hi ${safeOwnerName},</p>
          <h1 style="font-size:22px;margin:0 0 12px;color:#17211b">Account monitoring flag ${safeReason}</h1>
          <p style="margin:0 0 18px;color:#334139">${safeSummary}</p>
          <dl style="margin:0 0 22px">
            <dt style="font-size:12px;text-transform:uppercase;color:#66736b">User</dt>
            <dd style="margin:0 0 12px;color:#17211b">${safeUserEmail}</dd>
            <dt style="font-size:12px;text-transform:uppercase;color:#66736b">Signal</dt>
            <dd style="margin:0 0 12px;color:#17211b">${safeSignalType}</dd>
            <dt style="font-size:12px;text-transform:uppercase;color:#66736b">Severity</dt>
            <dd style="margin:0 0 12px;color:#17211b">${safeSeverity}</dd>
            <dt style="font-size:12px;text-transform:uppercase;color:#66736b">Status</dt>
            <dd style="margin:0;color:#17211b">${safeStatus}</dd>
          </dl>
          <a href="${safeDashboardUrl}" style="display:inline-block;background:#427a56;color:#fff;text-decoration:none;border-radius:10px;padding:12px 16px;font-weight:700">Open account monitoring</a>
          <p style="margin:22px 0 0;color:#66736b;font-size:13px">This internal alert includes only a privacy-safe summary. Review the admin dashboard before taking action.</p>
        </div>
      </div>
    `;

    await this.sendEmail({
      from: this.notificationFrom,
      to: input.email,
      subject: `Ritora admin alert: ${normalizeTemplateText(input.summary, 120)}`,
      html,
    });
  }

  async sendAccountDeletionConfirmationEmail(
    email: string,
    token: string,
    firstName: string,
    language: AppLanguage,
  ): Promise<void> {
    const safeFirstName = safeHtmlText(firstName);
    const actionUrl = this.buildFrontendPathActionUrl(
      'confirm-account-deletion',
      token,
    );
    const values = { firstName: safeFirstName };

    await this.sendAccountDeletionEmail({
      email,
      language,
      templateName: MailTemplateName.AccountDeletionConfirm,
      subjectKey: 'mail.subject.accountDeletionConfirm',
      actionUrl,
      firstName: safeFirstName,
      values,
      translationBase: 'mail.accountDeletion.confirm',
      sectionStyle: 'timeline',
      sectionTitleKey: 'mail.accountDeletion.confirm.timelineTitle',
      sectionItemKeys: [
        [
          'mail.accountDeletion.confirm.timeline1Title',
          'mail.accountDeletion.confirm.timeline1Body',
        ],
        [
          'mail.accountDeletion.confirm.timeline2Title',
          'mail.accountDeletion.confirm.timeline2Body',
        ],
        [
          'mail.accountDeletion.confirm.timeline3Title',
          'mail.accountDeletion.confirm.timeline3Body',
        ],
      ],
      ignoreNoteKey: 'mail.accountDeletion.confirm.ignoreNote',
    });
  }

  async sendAccountDeletionScheduledEmail(
    email: string,
    token: string,
    firstName: string,
    language: AppLanguage,
    scheduledFor: string,
  ): Promise<void> {
    const safeFirstName = safeHtmlText(firstName);
    const actionUrl = this.buildFrontendPathActionUrl(
      'cancel-account-deletion',
      token,
    );
    const values = {
      firstName: safeFirstName,
      scheduledFor: formatEmailDate(scheduledFor, language),
    };

    await this.sendAccountDeletionEmail({
      email,
      language,
      templateName: MailTemplateName.AccountDeletionScheduled,
      subjectKey: 'mail.subject.accountDeletionScheduled',
      actionUrl,
      firstName: safeFirstName,
      values,
      translationBase: 'mail.accountDeletion.scheduled',
      sectionStyle: 'timeline',
      sectionTitleKey: 'mail.accountDeletion.scheduled.timelineTitle',
      sectionItemKeys: [
        [
          'mail.accountDeletion.scheduled.timeline1Title',
          'mail.accountDeletion.scheduled.timeline1Body',
        ],
        [
          'mail.accountDeletion.scheduled.timeline2Title',
          'mail.accountDeletion.scheduled.timeline2Body',
        ],
        [
          'mail.accountDeletion.scheduled.timeline3Title',
          'mail.accountDeletion.scheduled.timeline3Body',
        ],
      ],
    });
  }

  async sendAccountDeletionCancelledEmail(
    email: string,
    firstName: string,
    language: AppLanguage,
  ): Promise<void> {
    const safeFirstName = safeHtmlText(firstName);
    const actionUrl = this.buildAppUrl('/');
    const values = { firstName: safeFirstName };

    await this.sendAccountDeletionEmail({
      email,
      language,
      templateName: MailTemplateName.AccountDeletionCancelled,
      subjectKey: 'mail.subject.accountDeletionCancelled',
      actionUrl,
      firstName: safeFirstName,
      values,
      translationBase: 'mail.accountDeletion.cancelled',
      sectionStyle: 'checklist',
      sectionTitleKey: 'mail.accountDeletion.cancelled.recapTitle',
      sectionItemKeys: [
        ['mail.accountDeletion.cancelled.recapItem1', null],
        ['mail.accountDeletion.cancelled.recapItem2', null],
        ['mail.accountDeletion.cancelled.recapItem3', null],
      ],
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
      supportEmail: this.supportEmail,
      ...stringPayload,
    };
    const daypartSlot = resolveDaypartSlot(payload, language);
    if (daypartSlot) {
      translateValues.slot = daypartSlot;
    }

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
      htmlLang: language,
      firstName: safeFirstName,
      logoUrl: EMAIL_LOGO_URL,
      manageUrl: safeManageUrl,
      manageLabel: translate(language, 'mail.notification.shared.manageLabel'),
      supportEmail: this.supportEmail,
      supportLine: translate(
        language,
        'mail.notification.shared.supportLine',
        translateValues,
      ),
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
      'List-Unsubscribe': `<${unsubscribeUrl}>, <mailto:${this.supportEmail}?subject=unsubscribe>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }

  private async sendAccountDeletionEmail(input: {
    email: string;
    language: AppLanguage;
    templateName:
      | MailTemplateName.AccountDeletionConfirm
      | MailTemplateName.AccountDeletionScheduled
      | MailTemplateName.AccountDeletionCancelled;
    subjectKey:
      | 'mail.subject.accountDeletionConfirm'
      | 'mail.subject.accountDeletionScheduled'
      | 'mail.subject.accountDeletionCancelled';
    actionUrl: string;
    firstName: string;
    values: Record<string, string | number>;
    translationBase:
      | 'mail.accountDeletion.confirm'
      | 'mail.accountDeletion.scheduled'
      | 'mail.accountDeletion.cancelled';
    sectionStyle: 'timeline' | 'checklist';
    sectionTitleKey: string;
    sectionItemKeys: Array<[string, string | null]>;
    ignoreNoteKey?: string;
  }): Promise<void> {
    const values = {
      ...input.values,
      supportEmail: this.supportEmail,
    };
    const sectionItems: AccountDeletionTimelineStep[] =
      input.sectionItemKeys.map(([titleKey, bodyKey], index) => ({
        marker:
          input.sectionStyle === 'timeline' ? String(index + 1) : '&#10003;',
        title: translate(input.language, titleKey, values),
        body: bodyKey ? translate(input.language, bodyKey, values) : '',
      }));

    const html = await this.renderTemplate(input.templateName, {
      htmlLang: input.language,
      firstName: input.firstName,
      actionUrl: escapeExpression(input.actionUrl),
      logoUrl: EMAIL_LOGO_URL,
      previewText: translate(
        input.language,
        `${input.translationBase}.previewText`,
        values,
      ),
      badgeLabel: translate(
        input.language,
        `${input.translationBase}.badgeLabel`,
        values,
      ),
      title: translate(
        input.language,
        `${input.translationBase}.title`,
        values,
      ),
      intro: translate(
        input.language,
        `${input.translationBase}.intro`,
        values,
      ),
      ctaLabel: translate(
        input.language,
        `${input.translationBase}.ctaLabel`,
        values,
      ),
      sectionTitle: translate(input.language, input.sectionTitleKey, values),
      sectionItems,
      sectionStyle: input.sectionStyle,
      note: translate(input.language, `${input.translationBase}.note`, values),
      fallbackIntro: translate(
        input.language,
        `${input.translationBase}.fallbackIntro`,
        values,
      ),
      ignoreNote: input.ignoreNoteKey
        ? translate(input.language, input.ignoreNoteKey, values)
        : undefined,
      footerLine: translate(
        input.language,
        `${input.translationBase}.footerLine`,
        values,
      ),
    });

    await this.sendEmail({
      from: this.authFrom,
      to: input.email,
      subject: translate(input.language, input.subjectKey, values),
      html,
    });
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
    return this.buildAppPathActionUrl(this.webAppUrl, path, token);
  }

  private buildAdminPathActionUrl(path: string, token: string): string {
    return this.buildAppPathActionUrl(this.adminWebAppUrl, path, token);
  }

  private buildAdminUrl(pathOrUrl: string): string {
    const base = new URL(this.adminWebAppUrl);
    const basePath = base.pathname.replace(/\/$/, '');
    const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
    const target = new URL(path, `${base.origin}${basePath}/`);
    if (basePath && !target.pathname.startsWith(`${basePath}/`)) {
      target.pathname = `${basePath}${target.pathname}`;
    }
    target.hash = '';
    return target.toString();
  }

  private buildAppPathActionUrl(
    baseUrl: string,
    path: string,
    token: string,
  ): string {
    const base = new URL(baseUrl);
    const basePath = base.pathname.replace(/\/$/, '');
    base.pathname = `${basePath}/${path}/${encodeURIComponent(token)}`;
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
  if (language === 'es') {
    return 'ahí';
  }

  return language === 'sv' ? 'du' : 'there';
}

const EMAIL_DATE_LOCALE: Record<AppLanguage, string> = {
  en: 'en-GB',
  sv: 'sv-SE',
  es: 'es-ES',
};

/**
 * Formats a date for display in an email body.
 *
 * Emails must never show raw ISO timestamps (e.g. 2026-06-14T20:34:32.000Z).
 * We render an unambiguous, localized long date in UTC — the same timezone
 * the deletion scheduler operates in — so the date the user sees always
 * matches when the action actually happens. The format ("14 June 2026" /
 * "14 juni 2026") avoids the MM/DD vs DD/MM ambiguity of numeric formats.
 */
function formatEmailDate(value: string | Date, language: AppLanguage): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return typeof value === 'string' ? value : '';
  }

  return new Intl.DateTimeFormat(EMAIL_DATE_LOCALE[language], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
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

const DAYPART_SLOT_TRANSLATION_KEYS: ReadonlyMap<string, string> = new Map([
  ['morning', 'mail.daypart.morning'],
  ['noon', 'mail.daypart.noon'],
  ['evening', 'mail.daypart.evening'],
] as const);

function resolveDaypartSlot(
  payload: Record<string, unknown>,
  language: AppLanguage,
): string | null {
  const daypart = payload.daypart;
  const translationKey =
    typeof daypart === 'string'
      ? DAYPART_SLOT_TRANSLATION_KEYS.get(daypart)
      : undefined;
  if (!translationKey) {
    return null;
  }
  return translate(language, translationKey);
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

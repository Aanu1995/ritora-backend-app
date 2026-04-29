import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { compile, escapeExpression, type TemplateDelegate } from 'handlebars';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { Resend } from 'resend';
import { type AppLanguage, translate } from '../common/i18n/i18n';
import {
  DEFAULT_MAIL_FROM,
  MailTemplateName,
  RESEND_CLIENT,
} from './mail.constants';

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

type MailTemplateContextMap = {
  [MailTemplateName.Verification]: VerificationTemplateContext;
  [MailTemplateName.PasswordReset]: PasswordResetTemplateContext;
};

@Injectable()
export class MailService {
  private readonly webAppUrl: string;
  private readonly from: string;
  private readonly apiKey: string;
  private readonly templateDir = join(__dirname, 'templates');
  private readonly templateCache = new Map<
    MailTemplateName,
    TemplateDelegate
  >();

  constructor(
    @Inject(RESEND_CLIENT) private readonly resend: Resend,
    private readonly configService: ConfigService,
  ) {
    this.webAppUrl = this.configService.get<string>(
      'WEB_APP_URL',
      'http://localhost:3000',
    );
    this.apiKey = this.configService.get<string>('RESEND_API_KEY', '');
    this.from = `"Ritora" <${this.configService.get<string>('MAIL_FROM', DEFAULT_MAIL_FROM)}>`;
  }

  async sendVerificationEmail(
    email: string,
    token: string,
    firstName: string,
    language: AppLanguage,
  ): Promise<void> {
    const verificationUrl = this.buildFrontendPathActionUrl(
      'verify-email',
      token,
    );
    const html = await this.renderTemplate(MailTemplateName.Verification, {
      firstName,
      verificationUrl,
      logoUrl: this.buildBrandAssetUrl('ritora-logo.png'),
      previewText: translate(language, 'mail.verification.previewText'),
      title: translate(language, 'mail.verification.title', { firstName }),
      intro: translate(language, 'mail.verification.intro'),
      ctaLabel: translate(language, 'mail.verification.ctaLabel'),
      expiryNote: translate(language, 'mail.verification.expiry'),
      fallbackIntro: translate(language, 'mail.verification.fallbackIntro'),
      ignoreNote: translate(language, 'mail.verification.ignore'),
      footerLineOne: translate(language, 'mail.verification.footerLineOne'),
      footerLineTwo: translate(language, 'mail.verification.footerLineTwo'),
    });

    await this.sendEmail({
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
    const resetUrl = this.buildFrontendPathActionUrl('reset-password', token);
    const html = await this.renderTemplate(MailTemplateName.PasswordReset, {
      firstName,
      resetUrl,
      logoUrl: this.buildBrandAssetUrl('ritora-logo.png'),
      previewText: translate(language, 'mail.passwordReset.previewText'),
      title: translate(language, 'mail.passwordReset.title'),
      intro: translate(language, 'mail.passwordReset.intro', { firstName }),
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
      to: email,
      subject: translate(language, 'mail.subject.passwordReset'),
      html,
    });
  }

  async sendNotificationEmail(
    email: string,
    subject: string,
    body: string,
  ): Promise<void> {
    const escapedSubject = escapeExpression(subject);
    const escapedBody = escapeExpression(body);
    await this.sendEmail({
      to: email,
      subject,
      html: `<p>${escapedSubject}</p><p>${escapedBody}</p>`,
    });
  }

  private async sendEmail(payload: {
    to: string;
    subject: string;
    html: string;
  }): Promise<void> {
    if (!this.apiKey) {
      throw new Error(
        'RESEND_API_KEY is not configured. Add it to your environment before sending email.',
      );
    }

    const { error } = await this.resend.emails.send({
      from: this.from,
      to: [payload.to],
      subject: payload.subject,
      html: payload.html,
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

  private buildFrontendActionUrl(path: string, token: string): string {
    const url = new URL(path, `${this.webAppUrl}/`);
    url.searchParams.set('token', token);
    return url.toString();
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
}

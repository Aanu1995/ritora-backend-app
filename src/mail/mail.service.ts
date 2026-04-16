import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Handlebars from 'handlebars';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { Resend } from 'resend';
import {
  DEFAULT_MAIL_FROM,
  MAIL_SUBJECTS,
  MailTemplateName,
  RESEND_CLIENT,
} from './mail.constants';

type VerificationTemplateContext = {
  firstName: string;
  verificationUrl: string;
};

type PasswordResetTemplateContext = {
  firstName: string;
  resetUrl: string;
};

type MailTemplateContextMap = {
  [MailTemplateName.Verification]: VerificationTemplateContext;
  [MailTemplateName.PasswordReset]: PasswordResetTemplateContext;
};

@Injectable()
export class MailService {
  private readonly frontendUrl: string;
  private readonly from: string;
  private readonly apiKey: string;
  private readonly templateDir = join(__dirname, 'templates');
  private readonly templateCache = new Map<
    MailTemplateName,
    Handlebars.TemplateDelegate
  >();

  constructor(
    @Inject(RESEND_CLIENT) private readonly resend: Resend,
    private readonly configService: ConfigService,
  ) {
    this.frontendUrl = this.configService.get<string>(
      'FRONTEND_URL',
      'http://localhost:3000',
    );
    this.apiKey = this.configService.get<string>('RESEND_API_KEY', '');
    this.from = `"Ritora" <${this.configService.get<string>('MAIL_FROM', DEFAULT_MAIL_FROM)}>`;
  }

  async sendVerificationEmail(
    email: string,
    token: string,
    firstName: string,
  ): Promise<void> {
    const verificationUrl = `${this.frontendUrl}/verify-email#token=${token}`;
    const html = await this.renderTemplate(MailTemplateName.Verification, {
      firstName,
      verificationUrl,
    });

    await this.sendEmail({
      to: email,
      subject: MAIL_SUBJECTS[MailTemplateName.Verification],
      html,
    });
  }

  async sendPasswordResetEmail(
    email: string,
    token: string,
    firstName: string,
  ): Promise<void> {
    const resetUrl = `${this.frontendUrl}/reset-password#token=${token}`;
    const html = await this.renderTemplate(MailTemplateName.PasswordReset, {
      firstName,
      resetUrl,
    });

    await this.sendEmail({
      to: email,
      subject: MAIL_SUBJECTS[MailTemplateName.PasswordReset],
      html,
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
  ): Promise<Handlebars.TemplateDelegate> {
    const cachedTemplate = this.templateCache.get(templateName);
    if (cachedTemplate) {
      return cachedTemplate;
    }

    const templatePath = join(this.templateDir, `${templateName}.hbs`);
    const source = await readFile(templatePath, 'utf8');
    const compiledTemplate = Handlebars.compile(source, {
      strict: true,
      noEscape: true,
    });

    this.templateCache.set(templateName, compiledTemplate);
    return compiledTemplate;
  }
}

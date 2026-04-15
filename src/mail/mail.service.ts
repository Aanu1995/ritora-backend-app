import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class MailService {
  private readonly frontendUrl: string;

  constructor(
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
  ) {
    this.frontendUrl = this.configService.get<string>(
      'FRONTEND_URL',
      'http://localhost:3000',
    );
  }

  async sendVerificationEmail(
    email: string,
    token: string,
    firstName: string,
  ): Promise<void> {
    const verificationUrl = `${this.frontendUrl}/verify-email#token=${token}`;

    await this.mailerService.sendMail({
      to: email,
      subject: 'Verify your Ritora account',
      template: 'verification',
      context: {
        firstName,
        verificationUrl,
      },
    });
  }

  async sendPasswordResetEmail(
    email: string,
    token: string,
    firstName: string,
  ): Promise<void> {
    const resetUrl = `${this.frontendUrl}/reset-password#token=${token}`;

    await this.mailerService.sendMail({
      to: email,
      subject: 'Reset your Ritora password',
      template: 'password-reset',
      context: {
        firstName,
        resetUrl,
      },
    });
  }
}

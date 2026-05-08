import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { RESEND_CLIENT } from './mail.constants';
import { MailUnsubscribeTokenService } from './mail-unsubscribe-token.service';
import { MailService } from './mail.service';

@Module({
  providers: [
    {
      provide: RESEND_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        new Resend(configService.getOrThrow<string>('RESEND_API_KEY')),
    },
    MailUnsubscribeTokenService,
    MailService,
  ],
  exports: [MailService, MailUnsubscribeTokenService],
})
export class MailModule {}

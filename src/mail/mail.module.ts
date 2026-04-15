import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter';
import { join } from 'path';
import { MailService } from './mail.service';

@Module({
  imports: [
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        transport: {
          host: configService.get<string>('MAIL_HOST', 'localhost'),
          port: configService.get<number>('MAIL_PORT', 1025),
          auth:
            configService.get<string>('MAIL_USER') &&
            configService.get<string>('MAIL_PASS')
              ? {
                  user: configService.get<string>('MAIL_USER'),
                  pass: configService.get<string>('MAIL_PASS'),
                }
              : undefined,
        },
        defaults: {
          from: `"Ritora" <${configService.get<string>('MAIL_FROM', 'noreply@ritora.com')}>`,
        },
        template: {
          dir: join(__dirname, 'templates'),
          adapter: new HandlebarsAdapter(),
          options: { strict: true },
        },
      }),
    }),
  ],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}

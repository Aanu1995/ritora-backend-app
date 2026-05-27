import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OriginCheckGuard } from '../common/guards/origin-check.guard';
import { MailModule } from '../mail/mail.module';
import { SupportModule } from '../support/support.module';
import { SkinJournalAnalysisFeedback } from '../skin-journal/entities/skin-journal-analysis-feedback.entity';
import { AccountMonitoringEvent } from '../users/entities/account-monitoring-event.entity';
import { UserConsent } from '../users/entities/user-consent.entity';
import { UserDataAccessLog } from '../users/entities/user-data-access-log.entity';
import { User } from '../users/entities/user.entity';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminAccountMonitoringQueueService } from './admin-account-monitoring-queue.service';
import { AdminController } from './admin.controller';
import { AdminJwtAuthGuard } from './admin-jwt-auth.guard';
import { AdminRootGuard } from './admin-root.guard';
import { AdminService } from './admin.service';
import { AdminAccount } from './entities/admin-account.entity';
import { AdminAccountMonitoringFlag } from './entities/admin-account-monitoring-flag.entity';
import { AdminAccountMonitoringSettings } from './entities/admin-account-monitoring-settings.entity';
import { AdminAuditLog } from './entities/admin-audit-log.entity';
import { AdminNotification } from './entities/admin-notification.entity';
import { AdminOperationalIncident } from './entities/admin-operational-incident.entity';
import { AdminSession } from './entities/admin-session.entity';
import { AdminUserNote } from './entities/admin-user-note.entity';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          audience: configService.getOrThrow<string>('JWT_AUDIENCE'),
          issuer: configService.getOrThrow<string>('JWT_ISSUER'),
        },
      }),
    }),
    TypeOrmModule.forFeature([
      AdminAccount,
      AdminAccountMonitoringFlag,
      AdminAccountMonitoringSettings,
      AdminAuditLog,
      AdminNotification,
      AdminOperationalIncident,
      AdminSession,
      AdminUserNote,
      AccountMonitoringEvent,
      SkinJournalAnalysisFeedback,
      User,
      UserConsent,
      UserDataAccessLog,
    ]),
    MailModule,
    SupportModule,
  ],
  controllers: [AdminAuthController, AdminController],
  providers: [
    AdminAuthService,
    AdminAccountMonitoringQueueService,
    AdminJwtAuthGuard,
    AdminRootGuard,
    AdminService,
    OriginCheckGuard,
  ],
  exports: [AdminAuthService, AdminAccountMonitoringQueueService, AdminService],
})
export class AdminModule {}

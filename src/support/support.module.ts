import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OriginCheckGuard } from '../common/guards/origin-check.guard';
import { PlatformGlobalRestrictionsModule } from '../platform-controls/platform-global-restrictions.module';
import { AdminAccount } from '../admin/entities/admin-account.entity';
import { AdminAuditLog } from '../admin/entities/admin-audit-log.entity';
import { AdminNotification } from '../admin/entities/admin-notification.entity';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { SupportFeedbackItem } from './entities/support-feedback-item.entity';
import { SupportFeedbackNote } from './entities/support-feedback-note.entity';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  imports: [
    PlatformGlobalRestrictionsModule,
    TypeOrmModule.forFeature([
      AdminAccount,
      AdminAuditLog,
      AdminNotification,
      SupportFeedbackItem,
      SupportFeedbackNote,
      User,
    ]),
    UsersModule,
  ],
  controllers: [SupportController],
  providers: [OriginCheckGuard, SupportService],
  exports: [SupportService],
})
export class SupportModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailModule } from '../mail/mail.module';
import { SkinJournalEntry } from '../skin-journal/entities/skin-journal-entry.entity';
import { User } from '../users/entities/user.entity';
import { InAppNotification } from './entities/in-app-notification.entity';
import { ScheduledNotification } from './entities/scheduled-notification.entity';
import { UserNotificationPreference } from './entities/user-notification-preference.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    MailModule,
    TypeOrmModule.forFeature([
      InAppNotification,
      ScheduledNotification,
      UserNotificationPreference,
      User,
      SkinJournalEntry,
    ]),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}

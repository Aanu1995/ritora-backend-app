import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApplicationLog } from '../application-tracking/entities/application-log.entity';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { MailModule } from '../mail/mail.module';
import { PlatformGlobalRestrictionsModule } from '../platform-controls/platform-global-restrictions.module';
import { SkinJournalEntry } from '../skin-journal/entities/skin-journal-entry.entity';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { InAppNotification } from './entities/in-app-notification.entity';
import { PushNotificationDelivery } from './entities/push-notification-delivery.entity';
import { PushNotificationSubscription } from './entities/push-notification-subscription.entity';
import { ScheduledNotification } from './entities/scheduled-notification.entity';
import { UserNotificationPreference } from './entities/user-notification-preference.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushNotificationsService } from './push-notifications.service';

@Module({
  imports: [
    MailModule,
    PlatformGlobalRestrictionsModule,
    UsersModule,
    TypeOrmModule.forFeature([
      InAppNotification,
      PushNotificationDelivery,
      PushNotificationSubscription,
      ScheduledNotification,
      UserNotificationPreference,
      User,
      SkinJournalEntry,
      ApplicationLog,
      InventoryProduct,
    ]),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, PushNotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}

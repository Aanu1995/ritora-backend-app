import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InAppNotification } from '../notifications/entities/in-app-notification.entity';
import { RoutineSimplificationEvent } from '../skin-journal/entities/routine-simplification-event.entity';
import { SkinJournalEvent } from '../skin-journal/entities/skin-journal-event.entity';
import { UsersModule } from '../users/users.module';
import { AppBadgesController } from './app-badges.controller';
import { AppBadgesService } from './app-badges.service';

@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([
      InAppNotification,
      SkinJournalEvent,
      RoutineSimplificationEvent,
    ]),
  ],
  controllers: [AppBadgesController],
  providers: [AppBadgesService],
})
export class AppBadgesModule {}

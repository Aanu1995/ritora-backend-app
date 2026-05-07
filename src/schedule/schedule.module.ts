import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApplicationLog } from '../application-tracking/entities/application-log.entity';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { UserNotificationPreference } from '../notifications/entities/user-notification-preference.entity';
import { SuggestionGenerationJob } from '../suggestions/entities/suggestion-generation-job.entity';
import { SuggestionInstance } from '../suggestions/entities/suggestion-instance.entity';
import { User } from '../users/entities/user.entity';
import { RoutineStep } from './entities/routine-step.entity';
import { ScheduleSlot } from './entities/schedule-slot.entity';
import { ScheduleController } from './schedule.controller';
import { ScheduleSuggestionCoordinator } from './schedule-suggestion-coordinator.service';
import { ScheduleService } from './schedule.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ScheduleSlot,
      RoutineStep,
      InventoryProduct,
      SuggestionInstance,
      SuggestionGenerationJob,
      User,
      UserNotificationPreference,
      ApplicationLog,
    ]),
  ],
  controllers: [ScheduleController],
  providers: [ScheduleService, ScheduleSuggestionCoordinator],
  exports: [ScheduleService],
})
export class ScheduleModule {}

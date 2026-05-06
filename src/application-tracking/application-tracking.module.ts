import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { ScheduledNotification } from '../notifications/entities/scheduled-notification.entity';
import { UserNotificationPreference } from '../notifications/entities/user-notification-preference.entity';
import { ScheduleSlot } from '../schedule/entities/schedule-slot.entity';
import { RoutineBreak } from '../suggestions/entities/routine-break.entity';
import { SuggestionGenerationJob } from '../suggestions/entities/suggestion-generation-job.entity';
import { SuggestionInstance } from '../suggestions/entities/suggestion-instance.entity';
import { SuggestionStep } from '../suggestions/entities/suggestion-step.entity';
import { RoutineBreakService } from '../suggestions/services/routine-break.service';
import { ApplicationLog } from './entities/application-log.entity';
import { ApplicationLogItem } from './entities/application-log-item.entity';
import { ApplicationLogVersion } from './entities/application-log-version.entity';
import { ApplicationLogsController } from './application-tracking.controller';
import { ApplicationReactiveRegenerationService } from './application-reactive-regeneration.service';
import { ApplicationTrackingService } from './application-tracking.service';
import { ApplicationTrackingValidationService } from './application-tracking-validation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ApplicationLog,
      ApplicationLogItem,
      ApplicationLogVersion,
      SuggestionGenerationJob,
      SuggestionInstance,
      SuggestionStep,
      InventoryProduct,
      ScheduleSlot,
      UserNotificationPreference,
      ScheduledNotification,
      RoutineBreak,
    ]),
  ],
  providers: [
    ApplicationTrackingService,
    ApplicationTrackingValidationService,
    ApplicationReactiveRegenerationService,
    RoutineBreakService,
  ],
  controllers: [ApplicationLogsController],
  exports: [ApplicationTrackingService, TypeOrmModule],
})
export class ApplicationTrackingModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { UserNotificationPreference } from '../notifications/entities/user-notification-preference.entity';
import { ScheduleSlot } from '../schedule/entities/schedule-slot.entity';
import { SuggestionGenerationJob } from '../suggestions/entities/suggestion-generation-job.entity';
import { SuggestionInstance } from '../suggestions/entities/suggestion-instance.entity';
import { SuggestionStep } from '../suggestions/entities/suggestion-step.entity';
import { ApplicationLog } from './entities/application-log.entity';
import { ApplicationLogItem } from './entities/application-log-item.entity';
import { ApplicationLogVersion } from './entities/application-log-version.entity';
import { ApplicationLogsController } from './application-tracking.controller';
import { ApplicationReactiveRegenerationService } from './application-reactive-regeneration.service';
import { ApplicationTrackingService } from './application-tracking.service';
import { ApplicationTrackingValidationService } from './application-tracking-validation.service';

/**
 * Routine application records: per-slot logs of what the user actually
 * applied, with full version history. Imported lazily into the
 * suggestions module to avoid a circular dependency on Suggestion
 * entities.
 */
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
    ]),
  ],
  providers: [
    ApplicationTrackingService,
    ApplicationTrackingValidationService,
    ApplicationReactiveRegenerationService,
  ],
  controllers: [ApplicationLogsController],
  exports: [ApplicationTrackingService, TypeOrmModule],
})
export class ApplicationTrackingModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApplicationLog } from '../application-tracking/entities/application-log.entity';
import { ApplicationLogItem } from '../application-tracking/entities/application-log-item.entity';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { ScheduleSlot } from '../schedule/entities/schedule-slot.entity';
import { RoutineStep } from '../schedule/entities/routine-step.entity';
import { RoutineSimplificationEvent } from '../skin-journal/entities/routine-simplification-event.entity';
import { SkinJournalEntry } from '../skin-journal/entities/skin-journal-entry.entity';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { UserNotificationPreference } from '../notifications/entities/user-notification-preference.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { User } from '../users/entities/user.entity';
import { UserConsent } from '../users/entities/user-consent.entity';
import { UsersModule } from '../users/users.module';
import { SuggestionInstance } from './entities/suggestion-instance.entity';
import { SuggestionStep } from './entities/suggestion-step.entity';
import { SuggestionGenerationJob } from './entities/suggestion-generation-job.entity';
import { SuggestionContextCache } from './entities/suggestion-context-cache.entity';
import { SuggestionObservabilityEvent } from './entities/suggestion-observability-event.entity';
import { SuggestionGapAction } from './entities/suggestion-gap-action.entity';
import { SuggestionRecordingReminderSnooze } from './entities/suggestion-recording-reminder-snooze.entity';
import { SuggestionReactionOverride } from './entities/suggestion-reaction-override.entity';
import { SuggestionAiUsageGuard } from './services/suggestion-ai-usage-guard.service';
import { SuggestionAiGenerator } from './services/suggestion-ai-generator';
import { SuggestionConsentService } from './services/suggestion-consent.service';
import { SuggestionContextBuilder } from './services/suggestion-context-builder.service';
import { SuggestionGenerationContextService } from './services/suggestion-generation-context.service';
import { SuggestionGenerationService } from './services/suggestion-generation.service';
import { SuggestionGenerationWorker } from './services/suggestion-generation-worker.service';
import { SuggestionHistoryExportService } from './services/suggestion-history-export.service';
import { SuggestionHistoryReader } from './services/suggestion-history-reader.service';
import { SuggestionObservabilityService } from './services/suggestion-observability.service';
import { SuggestionRetentionService } from './services/suggestion-retention.service';
import { SuggestionScheduler } from './services/suggestion-scheduler.service';
import { SuggestionReminderWorker } from './services/suggestion-reminder-worker.service';
import { SuggestionTodayActionService } from './services/suggestion-today-action.service';
import { SuggestionsService } from './services/suggestions.service';
import { TodaysSuggestionReactionService } from './services/todays-suggestion-reaction.service';
import { SuggestionsController } from './suggestions.controller';

/**
 * Owns the AI-powered suggestion engine. The TypeOrmModule.forFeature
 * includes both this module's entities and the cross-module reads
 * (schedule, inventory, application tracking, journal, profile) so the
 * services can issue queries without going through other modules'
 * services.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SuggestionInstance,
      SuggestionStep,
      SuggestionGenerationJob,
      SuggestionContextCache,
      SuggestionObservabilityEvent,
      SuggestionGapAction,
      SuggestionRecordingReminderSnooze,
      SuggestionReactionOverride,
      ScheduleSlot,
      RoutineStep,
      InventoryProduct,
      ApplicationLog,
      ApplicationLogItem,
      SkinJournalEntry,
      RoutineSimplificationEvent,
      SkinProfile,
      UserNotificationPreference,
      User,
      UserConsent,
    ]),
    NotificationsModule,
    UsersModule,
  ],
  providers: [
    SuggestionsService,
    SuggestionHistoryReader,
    SuggestionHistoryExportService,
    SuggestionAiGenerator,
    SuggestionAiUsageGuard,
    SuggestionConsentService,
    SuggestionContextBuilder,
    SuggestionGenerationContextService,
    SuggestionGenerationService,
    SuggestionGenerationWorker,
    SuggestionScheduler,
    SuggestionReminderWorker,
    SuggestionObservabilityService,
    SuggestionRetentionService,
    SuggestionTodayActionService,
    TodaysSuggestionReactionService,
  ],
  controllers: [SuggestionsController],
  exports: [SuggestionsService, TypeOrmModule],
})
export class SuggestionsModule {}

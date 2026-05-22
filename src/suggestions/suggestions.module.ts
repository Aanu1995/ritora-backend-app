import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApplicationLog } from '../application-tracking/entities/application-log.entity';
import { ApplicationLogItem } from '../application-tracking/entities/application-log-item.entity';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { IngredientsModule } from '../ingredients/ingredients.module';
import { EnvironmentIntelligenceModule } from '../environment-intelligence/environment-intelligence.module';
import { EnvironmentLocationCache } from '../environment-intelligence/entities/environment-location-cache.entity';
import { EnvironmentSnapshot } from '../environment-intelligence/entities/environment-snapshot.entity';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { ScheduleSlot } from '../schedule/entities/schedule-slot.entity';
import { RoutineStep } from '../schedule/entities/routine-step.entity';
import { RoutineSimplificationEvent } from '../skin-journal/entities/routine-simplification-event.entity';
import { SkinJournalEntry } from '../skin-journal/entities/skin-journal-entry.entity';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { UserNotificationPreference } from '../notifications/entities/user-notification-preference.entity';
import { ScheduledNotification } from '../notifications/entities/scheduled-notification.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlatformGlobalRestrictionsModule } from '../platform-controls/platform-global-restrictions.module';
import { User } from '../users/entities/user.entity';
import { UserConsent } from '../users/entities/user-consent.entity';
import { UsersModule } from '../users/users.module';
import { RoutineBreak } from './entities/routine-break.entity';
import { SmartPickSnapshot } from '../smart-picks/entities/smart-pick-snapshot.entity';
import { SmartPickProductSuggestion } from '../smart-picks/entities/smart-pick-product-suggestion.entity';
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
import { SuggestionGenerationPersistenceService } from './services/suggestion-generation-persistence.service';
import { SuggestionGenerationService } from './services/suggestion-generation.service';
import { SuggestionGenerationWorker } from './services/suggestion-generation-worker.service';
import { SuggestionHistoryExportService } from './services/suggestion-history-export.service';
import { SuggestionHistoryReader } from './services/suggestion-history-reader.service';
import { SuggestionObservabilityService } from './services/suggestion-observability.service';
import { SuggestionOnDemandService } from './services/suggestion-on-demand.service';
import { SuggestionRegenerationService } from './services/suggestion-regeneration.service';
import { SuggestionRetentionService } from './services/suggestion-retention.service';
import { RoutineBreakService } from './services/routine-break.service';
import { SuggestionScheduler } from './services/suggestion-scheduler.service';
import { SuggestionReminderWorker } from './services/suggestion-reminder-worker.service';
import { SuggestionTodayActionService } from './services/suggestion-today-action.service';
import { SuggestionsService } from './services/suggestions.service';
import { TodaysSuggestionReactionService } from './services/todays-suggestion-reaction.service';
import { SuggestionsController } from './suggestions.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SuggestionInstance,
      SuggestionStep,
      SuggestionGenerationJob,
      SuggestionContextCache,
      SuggestionObservabilityEvent,
      SuggestionGapAction,
      SmartPickProductSuggestion,
      SuggestionRecordingReminderSnooze,
      SuggestionReactionOverride,
      EnvironmentLocationCache,
      EnvironmentSnapshot,
      RoutineBreak,
      SmartPickSnapshot,
      ScheduleSlot,
      RoutineStep,
      InventoryProduct,
      ApplicationLog,
      ApplicationLogItem,
      SkinJournalEntry,
      RoutineSimplificationEvent,
      SkinProfile,
      UserNotificationPreference,
      ScheduledNotification,
      User,
      UserConsent,
    ]),
    CatalogueModule,
    IngredientsModule,
    EnvironmentIntelligenceModule,
    NotificationsModule,
    PlatformGlobalRestrictionsModule,
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
    SuggestionGenerationPersistenceService,
    SuggestionGenerationService,
    SuggestionGenerationWorker,
    SuggestionScheduler,
    SuggestionReminderWorker,
    SuggestionObservabilityService,
    SuggestionOnDemandService,
    SuggestionRegenerationService,
    SuggestionRetentionService,
    RoutineBreakService,
    SuggestionTodayActionService,
    TodaysSuggestionReactionService,
  ],
  controllers: [SuggestionsController],
  exports: [SuggestionsService, TypeOrmModule],
})
export class SuggestionsModule {}

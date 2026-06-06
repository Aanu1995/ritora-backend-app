import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SkinJournalEntry } from './entities/skin-journal-entry.entity';
import { SkinJournalEntryPhoto } from './entities/skin-journal-entry-photo.entity';
import { SkinJournalEvent } from './entities/skin-journal-event.entity';
import { SkinJournalInsight } from './entities/skin-journal-insight.entity';
import { SkinJournalInsightInteraction } from './entities/skin-journal-insight-interaction.entity';
import { SkinJournalAnalysisFeedback } from './entities/skin-journal-analysis-feedback.entity';
import { SkinJournalInsightGenerationRun } from './entities/skin-journal-insight-generation-run.entity';
import { SkinJournalInsightJob } from './entities/skin-journal-insight-job.entity';
import { SkinJournalInsightState } from './entities/skin-journal-insight-state.entity';
import { SkinJournalWrapped } from './entities/skin-journal-wrapped.entity';
import { SkinJournalAnalysisJob } from './entities/skin-journal-analysis-job.entity';
import { SkinJournalMediaDeletionJob } from './entities/skin-journal-media-deletion-job.entity';
import { RoutineSimplificationEvent } from './entities/routine-simplification-event.entity';
import { UserConsent } from '../users/entities/user-consent.entity';
import { AccountMonitoringEvent } from '../users/entities/account-monitoring-event.entity';
import { User } from '../users/entities/user.entity';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { ApplicationLog } from '../application-tracking/entities/application-log.entity';
import { RoutineStep } from '../schedule/entities/routine-step.entity';
import { InventoryProduct } from '../inventory/entities/inventory-product.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlatformGlobalRestrictionsModule } from '../platform-controls/platform-global-restrictions.module';
import { SmartPicksModule } from '../smart-picks/smart-picks.module';
import { UsersModule } from '../users/users.module';
import { SkinJournalController } from './skin-journal.controller';
import { SkinJournalPhotoUploadRestrictionGuard } from './skin-journal-photo-upload-restriction.guard';
import { SkinJournalService } from './skin-journal.service';
import { SkinJournalPhotoStorageService } from './services/skin-journal-photo-storage.service';
import { SkinJournalAnalysisService } from './services/skin-journal-analysis.service';
import { SkinJournalPhotoInterpretationService } from './services/skin-journal-photo-interpretation.service';
import { SkinJournalAnalysisQueueService } from './services/skin-journal-analysis-queue.service';
import { SkinJournalInsightQueueService } from './services/skin-journal-insight-queue.service';
import { SkinJournalInsightSchedulerService } from './services/skin-journal-insight-scheduler.service';
import { SkinJournalMediaRetentionService } from './services/skin-journal-media-retention.service';
import { InsightPolishService } from './insights/insight-polish.service';
import { KnowledgeBaseService } from './insights/knowledge-base/knowledge-base.service';

@Module({
  imports: [
    NotificationsModule,
    PlatformGlobalRestrictionsModule,
    SmartPicksModule,
    UsersModule,
    TypeOrmModule.forFeature([
      SkinJournalEntry,
      SkinJournalEntryPhoto,
      SkinJournalEvent,
      SkinJournalInsight,
      SkinJournalInsightInteraction,
      SkinJournalAnalysisFeedback,
      SkinJournalInsightGenerationRun,
      SkinJournalInsightJob,
      SkinJournalInsightState,
      SkinJournalWrapped,
      SkinJournalAnalysisJob,
      SkinJournalMediaDeletionJob,
      RoutineSimplificationEvent,
      AccountMonitoringEvent,
      UserConsent,
      User,
      SkinProfile,
      ApplicationLog,
      InventoryProduct,
      RoutineStep,
    ]),
  ],
  controllers: [SkinJournalController],
  providers: [
    SkinJournalService,
    SkinJournalPhotoUploadRestrictionGuard,
    SkinJournalPhotoStorageService,
    SkinJournalAnalysisService,
    SkinJournalPhotoInterpretationService,
    SkinJournalAnalysisQueueService,
    SkinJournalInsightQueueService,
    SkinJournalInsightSchedulerService,
    SkinJournalMediaRetentionService,
    InsightPolishService,
    KnowledgeBaseService,
  ],
  exports: [
    SkinJournalService,
    SkinJournalAnalysisQueueService,
    SkinJournalInsightQueueService,
  ],
})
export class SkinJournalModule {}

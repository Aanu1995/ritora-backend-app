import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SkinJournalEntry } from './entities/skin-journal-entry.entity';
import { SkinJournalEvent } from './entities/skin-journal-event.entity';
import { SkinJournalInsight } from './entities/skin-journal-insight.entity';
import { SkinJournalWrapped } from './entities/skin-journal-wrapped.entity';
import { RoutineSimplificationEvent } from './entities/routine-simplification-event.entity';
import { SkinJournalExportJob } from './entities/skin-journal-export-job.entity';
import { UserConsent } from '../users/entities/user-consent.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { SkinJournalController } from './skin-journal.controller';
import { SkinJournalService } from './skin-journal.service';
import { SkinJournalPhotoStorageService } from './services/skin-journal-photo-storage.service';
import { SkinJournalAnalysisService } from './services/skin-journal-analysis.service';

@Module({
  imports: [
    NotificationsModule,
    UsersModule,
    TypeOrmModule.forFeature([
      SkinJournalEntry,
      SkinJournalEvent,
      SkinJournalInsight,
      SkinJournalWrapped,
      RoutineSimplificationEvent,
      SkinJournalExportJob,
      UserConsent,
    ]),
  ],
  controllers: [SkinJournalController],
  providers: [
    SkinJournalService,
    SkinJournalPhotoStorageService,
    SkinJournalAnalysisService,
  ],
  exports: [SkinJournalService],
})
export class SkinJournalModule {}

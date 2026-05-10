import { Module } from '@nestjs/common';
import { AppConfigModule } from '../../config/app-config.module';
import { SkinJournalPhotoStorageService } from '../services/skin-journal-photo-storage.service';
import { SkinJournalAnalysisService } from '../services/skin-journal-analysis.service';

@Module({
  imports: [AppConfigModule],
  providers: [SkinJournalAnalysisService, SkinJournalPhotoStorageService],
})
export class SkinJournalAnalysisEvaluationModule {}

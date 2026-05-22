import { Module } from '@nestjs/common';
import { AppConfigModule } from '../../config/app-config.module';
import { SkinJournalPhotoStorageService } from '../services/skin-journal-photo-storage.service';
import { SkinJournalAnalysisService } from '../services/skin-journal-analysis.service';

const evaluationPhotoStorage: Pick<
  SkinJournalPhotoStorageService,
  'readPhotoBuffer'
> = {
  readPhotoBuffer(): Promise<Buffer> {
    return Promise.reject(
      new Error('Evaluation fixtures are passed directly to the analyzer.'),
    );
  },
};

@Module({
  imports: [AppConfigModule],
  providers: [
    SkinJournalAnalysisService,
    {
      provide: SkinJournalPhotoStorageService,
      useValue: evaluationPhotoStorage,
    },
  ],
})
export class SkinJournalAnalysisEvaluationModule {}

import { MODULE_METADATA } from '@nestjs/common/constants';
import { AppConfigModule } from '../../config/app-config.module';
import { SkinJournalPhotoStorageService } from '../services/skin-journal-photo-storage.service';
import { SkinJournalAnalysisService } from '../services/skin-journal-analysis.service';
import {
  SkinJournalAnalysisEvaluationModule,
  SkinJournalAnalysisEvaluationPhotoStorage,
} from './skin-journal-analysis-evaluation.module';

describe('SkinJournalAnalysisEvaluationModule', () => {
  it('uses a narrow runtime instead of booting the full API app', () => {
    expect(
      Reflect.getMetadata(
        MODULE_METADATA.IMPORTS,
        SkinJournalAnalysisEvaluationModule,
      ),
    ).toEqual([AppConfigModule]);
    expect(
      Reflect.getMetadata(
        MODULE_METADATA.PROVIDERS,
        SkinJournalAnalysisEvaluationModule,
      ),
    ).toEqual([
      SkinJournalAnalysisService,
      SkinJournalAnalysisEvaluationPhotoStorage,
      expect.objectContaining({
        provide: SkinJournalPhotoStorageService,
        useExisting: SkinJournalAnalysisEvaluationPhotoStorage,
      }),
    ]);
  });
});

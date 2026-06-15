import { Injectable, Module } from '@nestjs/common';
import { AppConfigModule } from '../../config/app-config.module';
import { SkinJournalPhotoStorageService } from '../services/skin-journal-photo-storage.service';
import { SkinJournalAnalysisService } from '../services/skin-journal-analysis.service';

@Injectable()
export class SkinJournalAnalysisEvaluationPhotoStorage {
  private readonly buffersByObjectKey = new Map<string, Buffer>();

  setPhotoBuffer(objectKey: string, buffer: Buffer): void {
    this.buffersByObjectKey.set(objectKey, buffer);
  }

  clear(): void {
    this.buffersByObjectKey.clear();
  }

  readPhotoBuffer(objectKey: string): Promise<Buffer> {
    const buffer = this.buffersByObjectKey.get(objectKey);
    if (!buffer) {
      return Promise.reject(
        new Error(`Evaluation photo fixture is not registered: ${objectKey}`),
      );
    }
    return Promise.resolve(buffer);
  }
}

@Module({
  imports: [AppConfigModule],
  providers: [
    SkinJournalAnalysisService,
    SkinJournalAnalysisEvaluationPhotoStorage,
    {
      provide: SkinJournalPhotoStorageService,
      useExisting: SkinJournalAnalysisEvaluationPhotoStorage,
    },
  ],
})
export class SkinJournalAnalysisEvaluationModule {}

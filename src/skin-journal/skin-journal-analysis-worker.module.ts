import { Module } from '@nestjs/common';
import { SkinJournalModule } from './skin-journal.module';
import { SkinJournalWorkerRuntimeModule } from './skin-journal-worker-runtime.module';
import { SkinJournalAnalysisWorkerService } from './services/skin-journal-analysis-worker.service';

@Module({
  imports: [SkinJournalWorkerRuntimeModule, SkinJournalModule],
  providers: [SkinJournalAnalysisWorkerService],
})
export class SkinJournalAnalysisWorkerModule {}

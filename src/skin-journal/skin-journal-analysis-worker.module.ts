import { Module } from '@nestjs/common';
import { SkinJournalModule } from './skin-journal.module';
import { SkinJournalAnalysisWorkerService } from './services/skin-journal-analysis-worker.service';

@Module({
  imports: [SkinJournalModule],
  providers: [SkinJournalAnalysisWorkerService],
})
export class SkinJournalAnalysisWorkerModule {}

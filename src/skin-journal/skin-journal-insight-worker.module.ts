import { Module } from '@nestjs/common';
import { SkinJournalModule } from './skin-journal.module';
import { SkinJournalWorkerRuntimeModule } from './skin-journal-worker-runtime.module';
import { SkinJournalInsightWorkerService } from './services/skin-journal-insight-worker.service';

@Module({
  imports: [SkinJournalWorkerRuntimeModule, SkinJournalModule],
  providers: [SkinJournalInsightWorkerService],
})
export class SkinJournalInsightWorkerModule {}

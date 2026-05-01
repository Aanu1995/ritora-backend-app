import { Module } from '@nestjs/common';
import { SkinJournalModule } from './skin-journal.module';
import { SkinJournalInsightWorkerService } from './services/skin-journal-insight-worker.service';

@Module({
  imports: [SkinJournalModule],
  providers: [SkinJournalInsightWorkerService],
})
export class SkinJournalInsightWorkerModule {}

import type { Type } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { AppConfigModule } from '../config/app-config.module';
import { SkinJournalAnalysisWorkerModule } from './skin-journal-analysis-worker.module';
import { SkinJournalInsightWorkerModule } from './skin-journal-insight-worker.module';
import { SkinJournalModule } from './skin-journal.module';
import { SkinJournalWorkerRuntimeModule } from './skin-journal-worker-runtime.module';

function moduleImports(moduleClass: Type<unknown>): unknown[] {
  return Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleClass) ?? [];
}

describe('SkinJournal worker modules', () => {
  it('registers shared config and database runtime for standalone workers', () => {
    expect(moduleImports(SkinJournalWorkerRuntimeModule)).toContain(
      AppConfigModule,
    );
    expect(moduleImports(SkinJournalAnalysisWorkerModule)).toEqual(
      expect.arrayContaining([
        SkinJournalWorkerRuntimeModule,
        SkinJournalModule,
      ]),
    );
    expect(moduleImports(SkinJournalInsightWorkerModule)).toEqual(
      expect.arrayContaining([
        SkinJournalWorkerRuntimeModule,
        SkinJournalModule,
      ]),
    );
  });
});

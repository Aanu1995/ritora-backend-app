import { QueryRunner } from 'typeorm';
import { CreateSkinJournalTables1714200000000 } from '../1714200000000-CreateSkinJournalTables';
import { CreateApplicationTrackingTables1715000000000 } from '../1715000000000-CreateApplicationTrackingTables';
import { EnhanceSuggestionContextAndTracking1715400000000 } from '../1715400000000-EnhanceSuggestionContextAndTracking';
import { OptimizeSuggestionContextHistoryIndexes1722600000000 } from '../1722600000000-OptimizeSuggestionContextHistoryIndexes';

describe('OptimizeSuggestionContextHistoryIndexes1722600000000', () => {
  it('adds targeted indexes for 30-day Today suggestion context history reads', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    } as unknown as QueryRunner;

    await new OptimizeSuggestionContextHistoryIndexes1722600000000().up(
      queryRunner,
    );

    const sql = queries.join('\n');
    expect(sql).toContain('idx_suggestion_instances_context_history_ready');
    expect(sql).toContain(
      'ON "suggestion_instances" ("user_id", "generation_status", "target_date" DESC, "target_time" DESC, "created_at" DESC)',
    );
    expect(sql).toContain('idx_routine_breaks_context_history');
    expect(sql).toContain('ON "routine_breaks" ("user_id", "starts_at" DESC)');
  });

  it('keeps the earlier journal, application, and suggestion history indexes required by Today context reads', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    } as unknown as QueryRunner;

    await new CreateSkinJournalTables1714200000000().up(queryRunner);
    await new CreateApplicationTrackingTables1715000000000().up(queryRunner);
    await new EnhanceSuggestionContextAndTracking1715400000000().up(
      queryRunner,
    );

    const sql = queries.join('\n');
    expect(sql).toContain('IDX_skin_journal_entries_user_date_desc');
    expect(sql).toContain(
      'ON "skin_journal_entries" ("user_id", "entry_date" DESC)',
    );
    expect(sql).toContain('IDX_application_logs_user_target_date');
    expect(sql).toContain('ON "application_logs" ("user_id", "target_date")');
    expect(sql).toContain('IDX_application_logs_user_slot_date');
    expect(sql).toContain(
      'ON "application_logs" ("user_id", "slot_id", "target_date")',
    );
    expect(sql).toContain('IDX_suggestion_instances_user_slot_date');
    expect(sql).toContain(
      'ON "suggestion_instances" ("user_id", "slot_id", "target_date")',
    );
  });
});

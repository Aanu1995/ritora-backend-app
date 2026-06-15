import { QueryRunner } from 'typeorm';
import { ScopeScheduledSuggestionActiveIndexByTargetTime1724500000000 } from '../1724500000000-ScopeScheduledSuggestionActiveIndexByTargetTime';

describe('ScopeScheduledSuggestionActiveIndexByTargetTime1724500000000', () => {
  it('allows active scheduled suggestions for the same slot/date when target times differ', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    } as unknown as QueryRunner;

    await new ScopeScheduledSuggestionActiveIndexByTargetTime1724500000000().up(
      queryRunner,
    );

    const sql = queries.join('\n');
    expect(sql).toContain(
      'DROP INDEX IF EXISTS "UQ_suggestion_instances_user_slot_date_active"',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_suggestion_instances_user_slot_date_time_active"',
    );
    expect(sql).toContain(
      'ON "suggestion_instances" ("user_id", "slot_id", "target_date", "target_time")',
    );
    expect(sql).toContain(`WHERE "generation_status" <> 'superseded'`);
  });
});

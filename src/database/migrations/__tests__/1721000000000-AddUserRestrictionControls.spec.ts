import { QueryRunner } from 'typeorm';
import { AddUserRestrictionControls1721000000000 } from '../1721000000000-AddUserRestrictionControls';

describe('AddUserRestrictionControls1721000000000', () => {
  it('adds granular restriction columns and indexes without rewriting existing rows', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    } as unknown as QueryRunner;

    await new AddUserRestrictionControls1721000000000().up(queryRunner);

    const sql = queries.join('\n');
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS "account_restriction_capabilities"',
    );
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS "account_restriction_expires_at"',
    );
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS "account_restriction_internal_note"',
    );
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS "account_restriction_user_message"',
    );
    expect(sql).toContain('idx_users_active_restriction_lookup');
    expect(sql).toContain('WHERE "account_restricted_at" IS NOT NULL');
  });

  it('drops granular restriction controls on rollback', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (query: string) => {
        queries.push(query);
      }),
    } as unknown as QueryRunner;

    await new AddUserRestrictionControls1721000000000().down(queryRunner);

    const sql = queries.join('\n');
    expect(sql).toContain(
      'DROP INDEX IF EXISTS "idx_users_active_restriction_lookup"',
    );
    expect(sql).toContain(
      'DROP COLUMN IF EXISTS "account_restriction_capabilities"',
    );
  });
});

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { closeTestApp, createTestApp, MockMailService } from './test-setup';

const ORIGIN = 'http://localhost:3000';
const TEST_USER = {
  email: 'suggestions-performance@example.com',
  password: 'TestPass1',
  firstName: 'Suggestions',
  lastName: 'Performance',
  preferredLanguage: 'en',
  termsAccepted: true,
  privacyPolicyAccepted: true,
};

type ExplainPlanNode = Record<string, unknown>;

describe('Suggestions context history database performance (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const mockMail = new MockMailService();
    app = await createTestApp(mockMail);
    dataSource = app.get(DataSource);

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('Origin', ORIGIN)
      .send(TEST_USER)
      .expect(201);

    const token = mockMail.getVerificationToken(TEST_USER.email);
    expect(token).toBeDefined();
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .set('Origin', ORIGIN)
      .send({ token })
      .expect(200);
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('uses intended indexes for large 30-day Today suggestion context reads', async () => {
    const userId = await loadCurrentUserId(dataSource);
    const targetDate = '2026-05-25';
    await cleanupPerformanceRows(dataSource);
    await seedPerformanceRows(dataSource, userId, targetDate);

    try {
      await analyzeContextTables(dataSource);

      await expectIndexedPlan({
        dataSource,
        expectedIndexNames: [
          'IDX_skin_journal_entries_user_date_desc',
          'IDX_skin_journal_entries_user_reaction_date',
        ],
        parameters: [userId, targetDate],
        sql: `
          SELECT id
          FROM skin_journal_entries
          WHERE user_id = $1
            AND entry_date BETWEEN ($2::date - INTERVAL '29 days') AND $2::date
          ORDER BY entry_date DESC, updated_at DESC
        `,
      });
      await expectIndexedPlan({
        dataSource,
        expectedIndexNames: ['IDX_application_logs_user_target_date'],
        parameters: [userId, targetDate],
        sql: `
          SELECT id
          FROM application_logs
          WHERE user_id = $1
            AND target_date BETWEEN ($2::date - INTERVAL '29 days') AND $2::date
          ORDER BY target_date DESC, created_at DESC
        `,
      });
      await expectIndexedPlan({
        dataSource,
        expectedIndexNames: ['idx_suggestion_instances_context_history_ready'],
        parameters: [userId, targetDate],
        sql: `
          SELECT id
          FROM suggestion_instances
          WHERE user_id = $1
            AND generation_status = 'ready'
            AND target_date BETWEEN ($2::date - INTERVAL '29 days') AND $2::date
          ORDER BY target_date DESC, target_time DESC, created_at DESC
        `,
      });
      await expectIndexedPlan({
        dataSource,
        expectedIndexNames: ['idx_routine_breaks_context_history'],
        parameters: [
          userId,
          '2026-04-26T00:00:00.000Z',
          '2026-05-26T00:00:00.000Z',
        ],
        sql: `
          SELECT id
          FROM routine_breaks
          WHERE user_id = $1
            AND starts_at >= $2::timestamptz
            AND starts_at < $3::timestamptz
          ORDER BY starts_at DESC
        `,
      });
    } finally {
      await cleanupPerformanceRows(dataSource);
    }
  });
});

async function expectIndexedPlan(input: {
  dataSource: DataSource;
  expectedIndexNames: readonly string[];
  parameters: readonly unknown[];
  sql: string;
}): Promise<void> {
  const plan = await explainAnalyze(input.dataSource, input.sql, [
    ...input.parameters,
  ]);
  const indexNames = collectIndexNames(plan);
  expect(
    input.expectedIndexNames.some((indexName) =>
      indexNames.includes(indexName),
    ),
  ).toBe(true);
  expect(readPlanNumber(plan, 'Actual Total Time')).toBeLessThan(1_000);
}

async function explainAnalyze(
  dataSource: DataSource,
  sql: string,
  parameters: readonly unknown[],
): Promise<ExplainPlanNode> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();
  try {
    await queryRunner.query('SET LOCAL enable_seqscan = off');
    const rows = (await queryRunner.query(
      `EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`,
      [...parameters],
    )) as unknown as Array<Record<string, unknown>>;
    await queryRunner.rollbackTransaction();
    return readExplainPlan(rows);
  } catch (error) {
    if (queryRunner.isTransactionActive) {
      await queryRunner.rollbackTransaction();
    }
    throw error;
  } finally {
    await queryRunner.release();
  }
}

function readExplainPlan(
  rows: readonly Record<string, unknown>[],
): ExplainPlanNode {
  const payload = rows[0]?.['QUERY PLAN'];
  if (
    !Array.isArray(payload) ||
    !isRecord(payload[0]) ||
    !isRecord(payload[0].Plan)
  ) {
    throw new Error('EXPLAIN ANALYZE did not return a JSON plan.');
  }
  return payload[0].Plan;
}

function collectIndexNames(plan: ExplainPlanNode): string[] {
  const current =
    typeof plan['Index Name'] === 'string' ? [plan['Index Name']] : [];
  const children = Array.isArray(plan.Plans)
    ? plan.Plans.filter(isRecord).flatMap((child) => collectIndexNames(child))
    : [];
  return [...current, ...children];
}

function readPlanNumber(plan: ExplainPlanNode, key: string): number {
  const value = plan[key];
  if (typeof value !== 'number') {
    throw new Error(`Expected EXPLAIN plan field ${key} to be numeric.`);
  }
  return value;
}

async function loadCurrentUserId(dataSource: DataSource): Promise<string> {
  const rows = await dataSource.query(
    'SELECT id FROM users WHERE email = $1 LIMIT 1',
    [TEST_USER.email],
  );
  const id = rows[0]?.id;
  if (typeof id !== 'string') {
    throw new Error('Could not resolve performance e2e user id.');
  }
  return id;
}

async function seedPerformanceRows(
  dataSource: DataSource,
  userId: string,
  targetDate: string,
): Promise<void> {
  await dataSource.transaction(async (manager) => {
    await manager.query(
      `
        INSERT INTO skin_journal_entries (
          id, user_id, entry_date, time_zone, analysis_status,
          analysis_concern_keys, has_reaction_signal, created_at, updated_at
        )
        SELECT
          'perf-j-' || lpad(gs::text, 5, '0'),
          $1,
          ($2::date - (gs * INTERVAL '1 day'))::date,
          'Europe/Stockholm',
          'completed',
          ARRAY['barrier']::text[],
          false,
          ($2::date - (gs * INTERVAL '1 day')) + TIME '06:00',
          ($2::date - (gs * INTERVAL '1 day')) + TIME '06:10'
        FROM generate_series(0, 119) AS gs
      `,
      [userId, targetDate],
    );
    await manager.query(
      `
        INSERT INTO application_logs (
          id, user_id, target_date, target_time, daypart,
          applied_at, has_been_edited, created_at, updated_at
        )
        SELECT
          'perf-l-' || lpad(gs::text, 5, '0'),
          $1,
          ($2::date - ((gs % 90) * INTERVAL '1 day'))::date,
          '08:00',
          'morning',
          ($2::date - ((gs % 90) * INTERVAL '1 day')) + TIME '08:05',
          false,
          ($2::date - ((gs % 90) * INTERVAL '1 day')) + TIME '08:00',
          ($2::date - ((gs % 90) * INTERVAL '1 day')) + TIME '08:10'
        FROM generate_series(1, 10000) AS gs
      `,
      [userId, targetDate],
    );
    await manager.query(
      `
        INSERT INTO suggestion_instances (
          id, user_id, slot_id, request_source, target_date, target_time,
          daypart, mode, generation_status, visible_at, generated_at,
          has_reaction_signal, simplified_for_reaction, ai_retry_count,
          created_at, updated_at
        )
        SELECT
          'perf-s-' || lpad(gs::text, 5, '0'),
          $1,
          null,
          'on_demand',
          ($2::date - ((gs % 90) * INTERVAL '1 day'))::date,
          '08:00',
          'morning',
          'ai',
          'ready',
          ($2::date - ((gs % 90) * INTERVAL '1 day')) + TIME '07:50',
          ($2::date - ((gs % 90) * INTERVAL '1 day')) + TIME '07:55',
          false,
          false,
          0,
          ($2::date - ((gs % 90) * INTERVAL '1 day')) + TIME '07:45',
          ($2::date - ((gs % 90) * INTERVAL '1 day')) + TIME '07:55'
        FROM generate_series(1, 10000) AS gs
      `,
      [userId, targetDate],
    );
    await manager.query(
      `
        INSERT INTO routine_breaks (
          id, user_id, starts_at, ends_at, reason, status, resumed_at,
          created_at, updated_at
        )
        SELECT
          'perf-b-' || lpad(gs::text, 5, '0'),
          $1,
          ($2::date - ((gs % 90) * INTERVAL '1 day')) + TIME '04:00',
          ($2::date - ((gs % 90) * INTERVAL '1 day')) + TIME '05:00',
          null,
          'resumed',
          ($2::date - ((gs % 90) * INTERVAL '1 day')) + TIME '05:00',
          ($2::date - ((gs % 90) * INTERVAL '1 day')) + TIME '04:00',
          ($2::date - ((gs % 90) * INTERVAL '1 day')) + TIME '05:00'
        FROM generate_series(1, 10000) AS gs
      `,
      [userId, targetDate],
    );
  });
}

async function analyzeContextTables(dataSource: DataSource): Promise<void> {
  await dataSource.query('ANALYZE skin_journal_entries');
  await dataSource.query('ANALYZE application_logs');
  await dataSource.query('ANALYZE suggestion_instances');
  await dataSource.query('ANALYZE routine_breaks');
}

async function cleanupPerformanceRows(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    "DELETE FROM application_logs WHERE id LIKE 'perf-l-%'",
  );
  await dataSource.query(
    "DELETE FROM suggestion_instances WHERE id LIKE 'perf-s-%'",
  );
  await dataSource.query("DELETE FROM routine_breaks WHERE id LIKE 'perf-b-%'");
  await dataSource.query(
    "DELETE FROM skin_journal_entries WHERE id LIKE 'perf-j-%'",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

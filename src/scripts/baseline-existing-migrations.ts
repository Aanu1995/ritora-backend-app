import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import dataSource from '../database/data-source';

type MigrationRecord = {
  name: string;
  timestamp: number;
};

const MIGRATION_FILE_PATTERN = /^(\d{13})-.+\.ts$/;
const MIGRATION_CLASS_PATTERN =
  /export\s+class\s+([A-Za-z0-9_]+)\s+implements\s+MigrationInterface/;

function readThroughTimestamp(): number {
  const argValue = process.argv
    .find((argument) => argument.startsWith('--through='))
    ?.slice('--through='.length);
  const raw = argValue ?? process.env.RITORA_BASELINE_MIGRATIONS_THROUGH;
  const through = Number(raw);

  if (!Number.isSafeInteger(through)) {
    throw new Error(
      'Provide a safe migration timestamp with --through=<timestamp>.',
    );
  }

  return through;
}

function shouldWrite(): boolean {
  return (
    process.argv.includes('--write') &&
    process.env.RITORA_ALLOW_MIGRATION_BASELINE === 'true'
  );
}

async function loadSourceMigrations(): Promise<MigrationRecord[]> {
  const migrationsDirectory = join(__dirname, '../database/migrations');
  const entries = await readdir(migrationsDirectory);
  const migrations: MigrationRecord[] = [];

  for (const entry of entries) {
    const timestampMatch = MIGRATION_FILE_PATTERN.exec(entry);
    if (!timestampMatch) continue;

    const source = await readFile(join(migrationsDirectory, entry), 'utf8');
    const classMatch = MIGRATION_CLASS_PATTERN.exec(source);
    if (!classMatch) {
      throw new Error(`Could not find migration class in ${entry}.`);
    }

    migrations.push({
      name: classMatch[1],
      timestamp: Number(timestampMatch[1]),
    });
  }

  return migrations.sort((left, right) => left.timestamp - right.timestamp);
}

async function assertTableExists(tableName: string): Promise<void> {
  const rows = await dataSource.query<Array<{ exists: boolean }>>(
    `SELECT to_regclass($1) IS NOT NULL AS "exists"`,
    [`public.${tableName}`],
  );
  if (!rows[0]?.exists) {
    throw new Error(`Required table "${tableName}" does not exist.`);
  }
}

async function countMigrationRows(): Promise<number> {
  const rows = await dataSource.query<Array<{ count: string | number }>>(
    'SELECT COUNT(*) AS "count" FROM "migrations"',
  );
  return Number(rows[0]?.count ?? 0);
}

async function insertBaselineRows(migrations: MigrationRecord[]) {
  await dataSource.transaction(async (manager) => {
    for (const migration of migrations) {
      await manager.query(
        `
          INSERT INTO "migrations" ("timestamp", "name")
          SELECT $1::bigint, $2::varchar
          WHERE NOT EXISTS (
            SELECT 1 FROM "migrations"
            WHERE "timestamp" = $1::bigint AND "name" = $2::varchar
          )
        `,
        [migration.timestamp, migration.name],
      );
    }
  });
}

async function main() {
  const throughTimestamp = readThroughTimestamp();
  const writeEnabled = shouldWrite();
  const migrations = await loadSourceMigrations();
  const baselineMigrations = migrations.filter(
    (migration) => migration.timestamp <= throughTimestamp,
  );
  const pendingMigrations = migrations.filter(
    (migration) => migration.timestamp > throughTimestamp,
  );

  if (
    baselineMigrations.length === 0 ||
    baselineMigrations.at(-1)?.timestamp !== throughTimestamp
  ) {
    throw new Error(
      `No source migration exactly matches timestamp ${throughTimestamp}.`,
    );
  }

  await dataSource.initialize();
  try {
    await assertTableExists('migrations');
    await assertTableExists('users');

    const [{ database }] = await dataSource.query<Array<{ database: string }>>(
      'SELECT current_database() AS "database"',
    );
    const existingRows = await countMigrationRows();
    if (existingRows > 0) {
      throw new Error(
        `Refusing to baseline because "migrations" already has ${existingRows} rows.`,
      );
    }

    const summary = {
      database,
      mode: writeEnabled ? 'write' : 'dry-run',
      baselineCount: baselineMigrations.length,
      firstBaseline: baselineMigrations[0],
      lastBaseline: baselineMigrations.at(-1),
      pendingCount: pendingMigrations.length,
      nextPending: pendingMigrations[0] ?? null,
    };
    console.log(JSON.stringify(summary, null, 2));

    if (!writeEnabled) {
      console.log(
        'Dry run only. Re-run with --write and RITORA_ALLOW_MIGRATION_BASELINE=true to insert migration history rows.',
      );
      return;
    }

    await insertBaselineRows(baselineMigrations);
    console.log(
      `Inserted ${baselineMigrations.length} migration baseline rows.`,
    );
  } finally {
    await dataSource.destroy();
  }
}

void main().catch(async (error: unknown) => {
  if (dataSource.isInitialized) {
    await dataSource.destroy();
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error(`Migration baseline failed: ${message}`);
  process.exitCode = 1;
});

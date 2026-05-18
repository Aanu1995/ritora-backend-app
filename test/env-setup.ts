import { config, parse } from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const rootDir = resolve(__dirname, '..');
const shellProvidedKeys = new Set(Object.keys(process.env));

config({
  path: resolve(rootDir, '.env'),
  quiet: true,
});

applyTestEnv(resolve(rootDir, '.env.test'), shellProvidedKeys);
applyE2eSafeDrivers();

function applyTestEnv(
  envPath: string,
  protectedKeys: ReadonlySet<string>,
): void {
  if (!existsSync(envPath)) {
    return;
  }

  const values = parse(readFileSync(envPath));

  for (const [key, value] of Object.entries(values)) {
    if (protectedKeys.has(key)) {
      continue;
    }

    if (
      key === 'DATABASE_PASSWORD' &&
      value === '' &&
      process.env.DATABASE_PASSWORD
    ) {
      continue;
    }

    process.env[key] = value;
  }
}

function applyE2eSafeDrivers(): void {
  process.env.ACCOUNT_DELETION_FINALIZATION_DRIVER = 'database';
  process.env.SMART_PICKS_QUEUE_DRIVER = 'database';
  process.env.SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER = 'database';
  process.env.SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER = 'database';
}

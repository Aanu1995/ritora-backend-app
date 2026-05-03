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

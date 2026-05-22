import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ENV_EXAMPLE_PATH = join(process.cwd(), '.env.example');
const SOURCE_ROOTS = ['src'];
const SYSTEM_ENV_KEYS = new Set(['CI']);

function walkSourceFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  if (statSync(directory).isFile()) {
    return /\.[tj]s$/.test(directory) ? [directory] : [];
  }

  return readdirSync(directory).flatMap((entry) => {
    const fullPath = join(directory, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      return ['node_modules', 'dist', 'coverage'].includes(entry)
        ? []
        : walkSourceFiles(fullPath);
    }

    return /\.[tj]s$/.test(entry) && !/\.spec\.ts$/.test(entry)
      ? [fullPath]
      : [];
  });
}

function readEnvExampleKeys(): Set<string> {
  const source = readFileSync(ENV_EXAMPLE_PATH, 'utf8');
  return new Set(
    [...source.matchAll(/^([A-Z0-9_]+)=/gm)].map((match) => match[1]),
  );
}

function readUsedEnvKeys(): Set<string> {
  const keys = new Set<string>();
  for (const file of SOURCE_ROOTS.flatMap(walkSourceFiles)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      keys.add(match[1]);
    }
    for (const match of source.matchAll(
      /\.get(?:OrThrow)?(?:<[^>]+>)?\(\s*['"]([A-Z0-9_]+)['"]/g,
    )) {
      keys.add(match[1]);
    }
    for (const match of source.matchAll(
      /(?:export\s+)?const\s+[A-Z0-9_]+_ENV_KEY\s*=\s*['"]([A-Z0-9_]+)['"]/g,
    )) {
      keys.add(match[1]);
    }
  }
  return keys;
}

describe('environment variable exposure', () => {
  it('documents every backend-owned environment variable used by source code', () => {
    const exampleKeys = readEnvExampleKeys();
    const missing = [...readUsedEnvKeys()]
      .filter((key) => !SYSTEM_ENV_KEYS.has(key))
      .filter((key) => !exampleKeys.has(key))
      .sort();

    expect(missing).toEqual([]);
  });
});

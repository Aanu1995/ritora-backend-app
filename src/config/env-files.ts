import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from 'dotenv';

export const EXTERNAL_TEST_SERVICES_ENV = 'RITORA_E2E_ALLOW_EXTERNAL_SERVICES';

const DEFAULT_ENV_FILE = '.env';
const LOCAL_ENV_FILE = '.env.local';
const TEST_ENV_FILE = '.env.test';
const TEST_LOCAL_ENV_FILE = '.env.test.local';
const DATABASE_PASSWORD_KEY = 'DATABASE_PASSWORD';

export function appEnvFilePaths(nodeEnv = process.env.NODE_ENV): string[] {
  if (nodeEnv === 'test') {
    return [TEST_ENV_FILE, LOCAL_ENV_FILE, DEFAULT_ENV_FILE];
  }

  return [LOCAL_ENV_FILE, DEFAULT_ENV_FILE];
}

export function evaluationEnvFilePaths(
  explicitEnvFile?: string | null,
): string[] {
  const envFile = explicitEnvFile?.trim();
  if (envFile) {
    return [envFile];
  }

  return [TEST_LOCAL_ENV_FILE, TEST_ENV_FILE, LOCAL_ENV_FILE, DEFAULT_ENV_FILE];
}

export function loadEnvFiles(
  envFilePaths: readonly string[],
  options: {
    protectedKeys?: ReadonlySet<string>;
    rootDir?: string;
  } = {},
): string[] {
  const rootDir = options.rootDir ?? process.cwd();
  const protectedKeys =
    options.protectedKeys ?? new Set(Object.keys(process.env));
  const loadedKeys = new Set<string>();
  const loadedFiles: string[] = [];

  for (const envFilePath of envFilePaths) {
    const resolvedPath = resolve(rootDir, envFilePath);
    if (!existsSync(resolvedPath)) {
      continue;
    }

    loadedFiles.push(resolvedPath);
    const values = parse(readFileSync(resolvedPath));

    for (const [key, value] of Object.entries(values)) {
      if (protectedKeys.has(key) || loadedKeys.has(key)) {
        continue;
      }

      if (key === DATABASE_PASSWORD_KEY && value === '') {
        continue;
      }

      process.env[key] = value;
      loadedKeys.add(key);
    }
  }

  return loadedFiles;
}

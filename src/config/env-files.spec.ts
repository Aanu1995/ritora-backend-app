import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  appEnvFilePaths,
  evaluationEnvFilePaths,
  loadEnvFiles,
} from './env-files';

describe('env file resolution', () => {
  const originalEnv = { ...process.env };
  let tempDir: string;

  beforeEach(() => {
    process.env = { ...originalEnv };
    tempDir = mkdtempSync(join(tmpdir(), 'ritora-env-files-'));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(tempDir, { force: true, recursive: true });
  });

  it('keeps app test env deterministic while live evaluation can use local overrides', () => {
    expect(appEnvFilePaths('test')).toEqual([
      '.env.test',
      '.env.local',
      '.env',
    ]);
    expect(appEnvFilePaths('development')).toEqual(['.env.local', '.env']);
    expect(evaluationEnvFilePaths()).toEqual([
      '.env.test.local',
      '.env.test',
      '.env.local',
      '.env',
    ]);
  });

  it('loads the first available value while preserving shell-provided values', () => {
    process.env.SHELL_SECRET = 'from-shell';
    writeFileSync(
      join(tempDir, '.env.test.local'),
      'OPENAI_API_KEY=from-local\nSHELL_SECRET=from-local\n',
    );
    writeFileSync(
      join(tempDir, '.env.test'),
      'OPENAI_API_KEY=from-test\nDATABASE_PASSWORD=\n',
    );
    writeFileSync(
      join(tempDir, '.env'),
      'OPENAI_API_KEY=from-env\nDATABASE_PASSWORD=from-env\n',
    );

    const loaded = loadEnvFiles(evaluationEnvFilePaths(), {
      protectedKeys: new Set(['SHELL_SECRET']),
      rootDir: tempDir,
    });

    expect(loaded).toHaveLength(3);
    expect(process.env.OPENAI_API_KEY).toBe('from-local');
    expect(process.env.SHELL_SECRET).toBe('from-shell');
    expect(process.env.DATABASE_PASSWORD).toBe('from-env');
  });

  it('lets app test env use the local database password when the test password is blank', () => {
    writeFileSync(
      join(tempDir, '.env.test'),
      'DATABASE_NAME=ritora_test\nDATABASE_PASSWORD=\n',
    );
    writeFileSync(
      join(tempDir, '.env'),
      'DATABASE_NAME=ritora\nDATABASE_PASSWORD=from-env\n',
    );

    loadEnvFiles(appEnvFilePaths('test'), {
      protectedKeys: new Set(),
      rootDir: tempDir,
    });

    expect(process.env.DATABASE_NAME).toBe('ritora_test');
    expect(process.env.DATABASE_PASSWORD).toBe('from-env');
  });

  it('allows a single explicit evaluation env file', () => {
    expect(evaluationEnvFilePaths('/tmp/ritora-evaluation.env')).toEqual([
      '/tmp/ritora-evaluation.env',
    ]);
  });
});

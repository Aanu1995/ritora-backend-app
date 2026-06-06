import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

type PackageJson = {
  jest?: {
    coverageThreshold?: {
      global?: Record<string, number>;
    };
  };
};

const REPO_ROOT = join(__dirname, '..');
const SOURCE_ROOTS = ['src', 'test']
  .map((root) => join(REPO_ROOT, root))
  .filter((root) => existsSync(root));
const IGNORED_DIRECTORIES = new Set([
  '.git',
  'coverage',
  'dist',
  'node_modules',
]);
const THIS_FILE = normalizePath(relative(REPO_ROOT, __filename));

function normalizePath(path: string): string {
  return path.split(sep).join('/');
}

function listFiles(root: string): string[] {
  const entries = readdirSync(root);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(root, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry)) {
        files.push(...listFiles(fullPath));
      }
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function sourceFiles(): string[] {
  return SOURCE_ROOTS.flatMap(listFiles)
    .filter((file) => /\.(?:ts|tsx|jsx)$/u.test(file))
    .filter((file) => normalizePath(relative(REPO_ROOT, file)) !== THIS_FILE);
}

function productionSourceFiles(): string[] {
  return sourceFiles().filter((file) => {
    const normalized = normalizePath(relative(REPO_ROOT, file));

    return (
      normalized.startsWith('src/') &&
      !normalized.endsWith('.spec.ts') &&
      !normalized.startsWith('src/scripts/') &&
      !normalized.startsWith('src/database/') &&
      !normalized.includes('/seed/')
    );
  });
}

function matchingLines(files: string[], pattern: RegExp): string[] {
  const matches: string[] = [];

  for (const file of files) {
    const relativeFile = normalizePath(relative(REPO_ROOT, file));
    const lines = readFileSync(file, 'utf8').split(/\r?\n/u);

    lines.forEach((line, index) => {
      if (pattern.test(line)) {
        matches.push(`${relativeFile}:${index + 1}: ${line.trim()}`);
      }
    });
  }

  return matches;
}

function lineCount(file: string): number {
  return readFileSync(file, 'utf8').split(/\r?\n/u).length;
}

describe('architecture rules', () => {
  it('keeps coverage thresholds at the required minimum', () => {
    const packageJson = JSON.parse(
      readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'),
    ) as PackageJson;
    const thresholds = packageJson.jest?.coverageThreshold?.global ?? {};

    expect(thresholds.statements).toBeGreaterThanOrEqual(80);
    expect(thresholds.functions).toBeGreaterThanOrEqual(80);
    expect(thresholds.lines).toBeGreaterThanOrEqual(80);
  });

  it('requires linting to reject explicit TypeScript any', () => {
    const eslintConfig = readFileSync(
      join(REPO_ROOT, 'eslint.config.mjs'),
      'utf8',
    );

    expect(eslintConfig).toContain(
      "'@typescript-eslint/no-explicit-any': 'error'",
    );
    expect(eslintConfig).not.toMatch(
      /'@typescript-eslint\/no-explicit-any'\s*:\s*['"]off['"]/u,
    );
  });

  it('does not use explicit TypeScript any escape hatches', () => {
    const explicitAnyPattern = new RegExp(
      [
        '\\b(?:as|:)\\s+any\\b',
        '<' + 'any' + '>',
        'Array<' + 'any' + '>',
        'Record<[^>]+,\\s*' + 'any' + '>',
        'Promise<' + 'any' + '>',
        '\\b' + 'any' + '\\[\\]',
      ].join('|'),
      'u',
    );

    expect(matchingLines(sourceFiles(), explicitAnyPattern)).toEqual([]);
  });

  it('does not use namespace imports', () => {
    expect(matchingLines(sourceFiles(), /import\s+\*\s+as/u)).toEqual([]);
  });

  it('keeps frontend-only patterns out of the backend project', () => {
    const frontendFiles = sourceFiles().filter((file) =>
      /\.(?:tsx|jsx)$/u.test(file),
    );
    const oversizedComponents = frontendFiles
      .filter((file) => lineCount(file) > 400)
      .map((file) => normalizePath(relative(REPO_ROOT, file)));

    expect(frontendFiles).toEqual([]);
    expect(oversizedComponents).toEqual([]);
    expect(matchingLines(sourceFiles(), /\buseEffect\s*\(/u)).toEqual([]);
  });

  it('does not log from application source with console APIs', () => {
    expect(
      matchingLines(
        productionSourceFiles(),
        /\bconsole\.(?:log|debug|info|warn|error)\b/u,
      ),
    ).toEqual([]);
  });

  it('does not hardcode AI reasoning effort in feature code', () => {
    expect(
      matchingLines(
        productionSourceFiles(),
        /\b(?:reasoningEffort|effort)\s*:\s*['"](?:low|medium|high|xhigh)['"]/u,
      ),
    ).toEqual([]);
  });
});

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const SOURCE_ROOTS = [
  'src/skin-journal',
  'src/notifications',
  'src/database/migrations',
];

const REMOVED_REEL_NAMING_PATTERN =
  /(^|[^A-Za-z])(reel|reels|Reel|Reels)([^A-Za-z]|$)/;

function walkSourceFiles(path: string): string[] {
  if (!existsSync(path)) {
    return [];
  }

  if (statSync(path).isFile()) {
    return /\.(ts)$/.test(path) && !path.endsWith('.spec.ts') ? [path] : [];
  }

  return readdirSync(path).flatMap((entry) => {
    const fullPath = join(path, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      return walkSourceFiles(fullPath);
    }

    return /\.ts$/.test(entry) && !entry.endsWith('.spec.ts') ? [fullPath] : [];
  });
}

describe('Skin Journal Wrapped naming', () => {
  it('does not expose removed reel naming in backend source', () => {
    const violations = SOURCE_ROOTS.flatMap(walkSourceFiles)
      .map((file) => {
        const source = readFileSync(file, 'utf8');
        const match = source.match(REMOVED_REEL_NAMING_PATTERN);

        return match
          ? `${relative(process.cwd(), file)}: ${match[0].trim()}`
          : null;
      })
      .filter((value): value is string => value !== null);

    expect(violations).toEqual([]);
  });

  it('does not expose the removed backfill write API', () => {
    const controller = readFileSync(
      join(process.cwd(), 'src/skin-journal/skin-journal.controller.ts'),
      'utf8',
    );

    expect(controller).not.toContain("@Post('days/:date')");
  });
});

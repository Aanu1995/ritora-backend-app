import 'dotenv/config';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { ConfigService } from '@nestjs/config';
import {
  evaluateProductCompareRealLifeCases,
  type ProductCompareRealLifeEvaluationReport,
} from '../ingredients/evaluation/product-compare-real-life-evaluation.runner';

type EvaluationCliOptions = {
  out: string;
};

async function main(): Promise<number> {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error(
      'OPENAI_API_KEY is required for real-life Product Compare evaluation.',
    );
  }

  const options = parseArgs(process.argv.slice(2));
  const report = await evaluateProductCompareRealLifeCases({
    configService: new ConfigService(),
  });

  await mkdir(resolve(options.out, '..'), { recursive: true });
  await writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(
    `Product Compare real-life evaluation saved to ${options.out}: ${report.passedCases}/${report.totalCases} passed, ${report.failedCases} failed.`,
  );
  console.log(
    'Database safety: used in-memory mocked repositories only; no TypeORM connection, migration, seed, truncate, delete, or cleanup was run.',
  );

  if (report.failedCases > 0) {
    console.error(formatFailures(report));
    return 1;
  }

  return 0;
}

function parseArgs(args: readonly string[]): EvaluationCliOptions {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    out: resolve(
      readFlag(args, '--out') ??
        join(
          process.cwd(),
          'src/ingredients/evaluation/reports',
          `product-compare-real-life-evaluation-${timestamp}.json`,
        ),
    ),
  };
}

function readFlag(args: readonly string[], flag: string): string | null {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : null;
}

function formatFailures(
  report: ProductCompareRealLifeEvaluationReport,
): string {
  const lines = report.cases
    .filter((result) => result.status === 'failed')
    .map((result) => {
      const failedChecks = result.checks
        .filter((check) => !check.passed)
        .map((check) => check.id)
        .join(', ');
      return `- ${result.id}: ${failedChecks}`;
    });

  return `Failed cases:\n${lines.join('\n')}`;
}

void main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'unknown error');
    process.exitCode = 1;
  });

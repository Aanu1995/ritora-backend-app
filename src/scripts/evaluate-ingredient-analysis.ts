import { config as loadEnv } from 'dotenv';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { ConfigService } from '@nestjs/config';
import {
  evaluateIngredientProductAnalysisLaunch,
  type IngredientProductAnalysisEvaluationReport,
} from '../ingredients/evaluation/ingredient-product-analysis-evaluation.runner';

type EvaluationCliOptions = {
  envFile: string | null;
  out: string;
  allowSharedSqs: boolean;
};

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  if (options.envFile) {
    loadEnv({ path: options.envFile, override: true });
  } else {
    loadEnv();
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error(
      'OPENAI_API_KEY is required for real-life Ingredient Analysis evaluation.',
    );
  }

  const report = await evaluateIngredientProductAnalysisLaunch({
    configService: new ConfigService(),
    allowSharedSqs: options.allowSharedSqs,
  });

  await mkdir(resolve(options.out, '..'), { recursive: true });
  await writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(
    `Ingredient Analysis evaluation saved to ${options.out}: ${report.passedCases}/${report.totalCases} passed, ${report.failedCases} failed.`,
  );
  console.log(
    'Database safety: used in-memory mocked repositories only; no TypeORM connection, migration, seed, truncate, delete, or cleanup was run.',
  );

  if (!report.gate.passed) {
    console.error(formatFailures(report));
    return 1;
  }

  return 0;
}

function parseArgs(args: readonly string[]): EvaluationCliOptions {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    envFile: readFlag(args, '--env-file'),
    out: resolve(
      readFlag(args, '--out') ??
        join(
          process.cwd(),
          'src/ingredients/evaluation/reports',
          `ingredient-analysis-launch-evaluation-${timestamp}.json`,
        ),
    ),
    allowSharedSqs: args.includes('--allow-shared-sqs'),
  };
}

function readFlag(args: readonly string[], flag: string): string | null {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : null;
}

function formatFailures(
  report: IngredientProductAnalysisEvaluationReport,
): string {
  const failedCases = report.cases
    .filter((result) => result.status === 'failed')
    .map((result) => {
      const failedChecks = result.checks
        .filter((check) => !check.passed)
        .map((check) => check.id)
        .join(', ');
      return `- ${result.id}: ${failedChecks}`;
    });

  return [
    'Ingredient Analysis evaluation gate failed.',
    ...report.gate.blockers.map((blocker) => `Blocker: ${blocker}`),
    ...failedCases,
  ].join('\n');
}

void main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'unknown error');
    process.exitCode = 1;
  });

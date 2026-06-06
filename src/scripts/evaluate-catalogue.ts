import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { evaluationEnvFilePaths, loadEnvFiles } from '../config/env-files';
import {
  buildCataloguePhotoEvaluationReport,
  type CataloguePhotoEvaluationReport,
} from '../catalogue/evaluation/catalogue-photo-evaluation.runner';

type CatalogueEvaluationCliOptions = {
  envFile: string | null;
  out: string;
};

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  loadEnvFiles(evaluationEnvFilePaths(options.envFile));

  const report = await buildCataloguePhotoEvaluationReport();
  await mkdir(resolve(options.out, '..'), { recursive: true });
  await writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(
    `Catalogue photo evaluation saved to ${options.out}: ${report.passedCases}/${report.totalCases} passed, ${report.failedCases} failed.`,
  );

  if (!report.gate.passed) {
    console.error(formatCatalogueEvaluationFailures(report));
    return 1;
  }

  return 0;
}

function parseArgs(args: readonly string[]): CatalogueEvaluationCliOptions {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    envFile: readFlag(args, '--env-file'),
    out: resolve(
      readFlag(args, '--out') ??
        join(
          process.cwd(),
          'src/catalogue/evaluation/reports',
          `catalogue-photo-evaluation-${timestamp}.json`,
        ),
    ),
  };
}

function readFlag(args: readonly string[], flag: string): string | null {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : null;
}

function formatCatalogueEvaluationFailures(
  report: CataloguePhotoEvaluationReport,
): string {
  const failedCases = report.cases
    .filter((result) => result.status === 'failed')
    .map(
      (result) => `- ${result.caseId}: ${result.hardCheckFailures.join(', ')}`,
    );

  return [
    'Catalogue photo evaluation gate failed.',
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

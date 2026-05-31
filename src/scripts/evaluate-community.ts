import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { evaluationEnvFilePaths, loadEnvFiles } from '../config/env-files';
import {
  buildCommunityEvaluationReport,
  type CommunityEvaluationReport,
} from '../community/evaluation/community-evaluation.runner';

type CommunityEvaluationCliOptions = {
  envFile: string | null;
  out: string;
  requireLiveAi: boolean;
  includeDatabaseWorkflow: boolean;
};

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  loadEnvFiles(evaluationEnvFilePaths(options.envFile));

  const report = await buildCommunityEvaluationReport({
    requireLiveAi: options.requireLiveAi,
    includeDatabaseWorkflow: options.includeDatabaseWorkflow,
  });

  await mkdir(resolve(options.out, '..'), { recursive: true });
  await writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(
    `Community evaluation saved to ${options.out}: ${report.passedCases}/${report.totalCases} passed, ${report.failedCases} failed.`,
  );

  if (!report.gate.passed) {
    console.error(formatCommunityEvaluationFailures(report));
    return 1;
  }

  return 0;
}

function parseArgs(args: readonly string[]): CommunityEvaluationCliOptions {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    envFile: readFlag(args, '--env-file'),
    out: resolve(
      readFlag(args, '--out') ??
        join(
          process.cwd(),
          'src/community/evaluation/reports',
          `community-launch-evaluation-${timestamp}.json`,
        ),
    ),
    requireLiveAi: !args.includes('--allow-ai-fallback-only'),
    includeDatabaseWorkflow:
      args.includes('--include-db-workflow') &&
      !args.includes('--skip-db-workflow'),
  };
}

function readFlag(args: readonly string[], flag: string): string | null {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : null;
}

function formatCommunityEvaluationFailures(
  report: CommunityEvaluationReport,
): string {
  const failedModerationCases = report.moderationCases
    .filter((result) => result.status === 'failed')
    .map(
      (result) => `- ${result.caseId}: ${result.hardCheckFailures.join(', ')}`,
    );
  const failedSimulations = report.guardrailSimulations
    .filter((result) => result.status === 'failed')
    .map(
      (result) =>
        `- ${result.id}: ${result.checks
          .filter((check) => !check.passed)
          .map((check) => check.code)
          .join(', ')}`,
    );
  const failedWorkflowChecks = report.workflow.checks
    .filter((check) => !check.passed)
    .map((check) => `- workflow/${check.code}`);

  return [
    'Community evaluation gate failed.',
    ...report.gate.blockers.map((blocker) => `Blocker: ${blocker}`),
    ...failedModerationCases,
    ...failedSimulations,
    ...failedWorkflowChecks,
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

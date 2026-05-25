import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { buildSkinJournalInsightEvaluationReport } from '../skin-journal/insights/evaluation/skin-journal-insight-evaluation.runner';

interface EvaluationCliOptions {
  out: string;
  requireBroadLaunchClinicalReview: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = buildSkinJournalInsightEvaluationReport({
    requireBroadLaunchClinicalReview: options.requireBroadLaunchClinicalReview,
  });
  await mkdir(resolve(options.out, '..'), { recursive: true });
  await writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(
    `Skin Journal insight evaluation saved to ${options.out}: ${report.passed_cases}/${report.total_cases} passed.`,
  );
  if (!report.gate.passed) {
    console.error(
      `Skin Journal insight evaluation gate failed: pass_rate=${report.gate.pass_rate}, min_pass_rate=${report.gate.min_pass_rate}, missing_required_cases=${report.gate.missing_required_cases.join(',') || 'none'}, copy_review_passed=${report.copy_review.passed}, broad_launch_ready=${report.launch_readiness.broad_public_launch_ready}.`,
    );
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): EvaluationCliOptions {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    out: resolve(
      readFlag(args, '--out') ??
        join(
          process.cwd(),
          'src/skin-journal/insights/evaluation/reports',
          `skin-journal-insight-evaluation-${timestamp}.json`,
        ),
    ),
    requireBroadLaunchClinicalReview: args.includes(
      '--require-broad-launch-clinical-review',
    ),
  };
}

function readFlag(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : null;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

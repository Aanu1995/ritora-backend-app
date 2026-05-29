import 'dotenv/config';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { ConfigService } from '@nestjs/config';
import { QUICK_SUGGESTION_GOLDEN_CASES } from '../suggestions/evaluation/quick-suggestion-golden-cases';
import {
  createLiveQuickSuggestionEvaluationRunner,
  evaluateQuickSuggestionGoldenCases,
  type QuickSuggestionEvaluationReport,
} from '../suggestions/evaluation/quick-suggestion-evaluation.runner';

interface QuickSuggestionEvaluationCliOptions {
  out: string;
  caseIds: string[];
  repeatabilityRuns: number;
}

export async function runQuickSuggestionEvaluationCli(
  args = process.argv.slice(2),
): Promise<number> {
  const options = parseQuickSuggestionEvaluationArgs(args);
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error(
      'OPENAI_API_KEY is required to run Quick Suggestion live AI evaluation.',
    );
  }
  if (!process.env.SUGGESTION_AI_MODEL?.trim()) {
    throw new Error(
      'SUGGESTION_AI_MODEL is required to run Quick Suggestion live AI evaluation.',
    );
  }

  const cases = options.caseIds.length
    ? QUICK_SUGGESTION_GOLDEN_CASES.filter((evaluationCase) =>
        options.caseIds.includes(evaluationCase.id),
      )
    : QUICK_SUGGESTION_GOLDEN_CASES;
  if (cases.length === 0) {
    throw new Error('No Quick Suggestion evaluation cases matched the filter.');
  }

  const config = new ConfigService();
  const runner = createLiveQuickSuggestionEvaluationRunner(config);
  const report = await evaluateQuickSuggestionGoldenCases({
    ...runner,
    cases,
    repeatabilityRuns: options.repeatabilityRuns,
  });

  await mkdir(resolve(options.out, '..'), { recursive: true });
  await writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const failedCaseIds = report.cases
    .filter((result) => result.status === 'failed')
    .map((result) => result.caseId);
  console.log(
    `Quick Suggestion evaluation saved to ${options.out}: ${report.passedCases}/${report.totalCases} passed, ${report.failedCases} failed across ${report.repeatabilityRuns} run(s).`,
  );
  const exitCode = exitCodeForQuickSuggestionReport(report);
  if (exitCode !== 0) {
    console.error(`Failed cases: ${failedCaseIds.join(', ')}`);
  }
  return exitCode;
}

export function exitCodeForQuickSuggestionReport(
  report: Pick<QuickSuggestionEvaluationReport, 'failedCases'>,
): number {
  return report.failedCases > 0 ? 1 : 0;
}

export function parseQuickSuggestionEvaluationArgs(
  args: readonly string[],
): QuickSuggestionEvaluationCliOptions {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    out: resolve(
      readFlag(args, '--out') ??
        join(
          process.cwd(),
          'src/suggestions/evaluation/reports',
          `quick-suggestion-evaluation-${timestamp}.json`,
        ),
    ),
    caseIds: readRepeatedFlag(args, '--case'),
    repeatabilityRuns: readPositiveIntegerFlag(args, '--repeat') ?? 1,
  };
}

function readFlag(args: readonly string[], flag: string): string | null {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : null;
}

function readRepeatedFlag(args: readonly string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== flag) continue;
    const value = args[index + 1];
    if (value && !value.startsWith('--')) values.push(value);
  }
  return values;
}

function readPositiveIntegerFlag(
  args: readonly string[],
  flag: string,
): number | null {
  const value = readFlag(args, flag);
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

if (require.main === module) {
  void runQuickSuggestionEvaluationCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : 'unknown error');
      process.exitCode = 1;
    });
}

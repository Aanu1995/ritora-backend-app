import { readFile } from 'fs/promises';
import { join, resolve } from 'path';

export interface TodaysSuggestionEvaluationGateCase {
  caseId: string;
  status: string;
}

export interface TodaysSuggestionEvaluationGateReport {
  totalCases: number;
  passedCases: number;
  failedCases: number;
  repeatabilityFailures: number;
  cases: readonly TodaysSuggestionEvaluationGateCase[];
}

export interface TodaysSuggestionEvaluationGateThresholds {
  maxFailedCases: number;
  maxRepeatabilityFailures: number;
  minPassRate: number;
  requiredCaseIds: readonly string[];
}

export interface TodaysSuggestionEvaluationGateResult {
  pass: boolean;
  passRate: number;
  reasons: string[];
}

export interface TodaysSuggestionEvaluationGateCliOptions extends TodaysSuggestionEvaluationGateThresholds {
  reportPaths: string[];
}

const DEFAULT_REPORT_PATHS = [
  join(
    process.cwd(),
    'src/suggestions/evaluation/reports/todays-suggestion-evaluation-live-current.json',
  ),
  join(
    process.cwd(),
    'src/suggestions/evaluation/reports/todays-suggestion-evaluation-live-repeatability-current.json',
  ),
];

export async function runTodaysSuggestionEvaluationGateCli(
  args = process.argv.slice(2),
): Promise<number> {
  const options = parseTodaysSuggestionEvaluationGateArgs(args);
  const reports = await Promise.all(
    options.reportPaths.map(async (reportPath) => ({
      reportPath,
      report: await readEvaluationReport(reportPath),
    })),
  );
  const failures: string[] = [];

  for (const { report, reportPath } of reports) {
    const result = evaluateTodaysSuggestionEvaluationGate(report, options);
    if (result.pass) {
      console.log(
        `Today's Suggestion evaluation gate passed for ${reportPath}: passRate=${result.passRate.toFixed(
          3,
        )}, failed=${report.failedCases}, repeatabilityFailures=${report.repeatabilityFailures}.`,
      );
      continue;
    }
    failures.push(`${reportPath}: ${result.reasons.join(' ')}`);
  }

  if (failures.length === 0) {
    return 0;
  }

  for (const failure of failures) {
    console.error(failure);
  }
  return 1;
}

export function evaluateTodaysSuggestionEvaluationGate(
  report: TodaysSuggestionEvaluationGateReport,
  thresholds: TodaysSuggestionEvaluationGateThresholds,
): TodaysSuggestionEvaluationGateResult {
  const passRate =
    report.totalCases > 0 ? report.passedCases / report.totalCases : 0;
  const reasons: string[] = [];
  if (report.totalCases <= 0) {
    reasons.push('Report contains no evaluated cases.');
  }
  if (passRate < thresholds.minPassRate) {
    reasons.push(
      `Pass rate ${passRate.toFixed(3)} is below required ${thresholds.minPassRate.toFixed(
        3,
      )}.`,
    );
  }
  if (report.failedCases > thresholds.maxFailedCases) {
    reasons.push(
      `Failed cases ${report.failedCases} exceeds allowed ${thresholds.maxFailedCases}.`,
    );
  }
  if (report.repeatabilityFailures > thresholds.maxRepeatabilityFailures) {
    reasons.push(
      `Repeatability failures ${report.repeatabilityFailures} exceeds allowed ${thresholds.maxRepeatabilityFailures}.`,
    );
  }

  const reportedCaseIds = new Set(report.cases.map((result) => result.caseId));
  const missingCaseIds = thresholds.requiredCaseIds.filter(
    (caseId) => !reportedCaseIds.has(caseId),
  );
  if (missingCaseIds.length > 0) {
    reasons.push(`Missing required case ids: ${missingCaseIds.join(', ')}.`);
  }

  return {
    pass: reasons.length === 0,
    passRate,
    reasons,
  };
}

export function parseTodaysSuggestionEvaluationGateArgs(
  args: readonly string[],
): TodaysSuggestionEvaluationGateCliOptions {
  const reportPaths = readRepeatedFlag(args, '--report');
  return {
    reportPaths:
      reportPaths.length > 0
        ? reportPaths.map((reportPath) => resolve(reportPath))
        : DEFAULT_REPORT_PATHS,
    minPassRate: readNumberFlag(args, '--min-pass-rate') ?? 1,
    maxFailedCases: readIntegerFlag(args, '--max-failed') ?? 0,
    maxRepeatabilityFailures:
      readIntegerFlag(args, '--max-repeatability-failures') ?? 0,
    requiredCaseIds: readRepeatedFlag(args, '--required-case'),
  };
}

async function readEvaluationReport(
  reportPath: string,
): Promise<TodaysSuggestionEvaluationGateReport> {
  const parsed = JSON.parse(await readFile(reportPath, 'utf8')) as unknown;
  if (!isReport(parsed)) {
    throw new Error(
      `Invalid Today's Suggestion evaluation report: ${reportPath}`,
    );
  }
  return parsed;
}

function isReport(
  value: unknown,
): value is TodaysSuggestionEvaluationGateReport {
  if (!isRecord(value) || !Array.isArray(value.cases)) {
    return false;
  }
  return (
    Number.isInteger(value.totalCases) &&
    Number.isInteger(value.passedCases) &&
    Number.isInteger(value.failedCases) &&
    Number.isInteger(value.repeatabilityFailures) &&
    value.cases.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.caseId === 'string' &&
        typeof entry.status === 'string',
    )
  );
}

function readRepeatedFlag(args: readonly string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== flag) continue;
    const value = args[index + 1];
    if (value && !value.startsWith('--')) {
      values.push(value);
    }
  }
  return values;
}

function readNumberFlag(args: readonly string[], flag: string): number | null {
  const value = readFlag(args, flag);
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${flag} must be a number from 0 to 1.`);
  }
  return parsed;
}

function readIntegerFlag(args: readonly string[], flag: string): number | null {
  const value = readFlag(args, flag);
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer.`);
  }
  return parsed;
}

function readFlag(args: readonly string[], flag: string): string | null {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

if (require.main === module) {
  void runTodaysSuggestionEvaluationGateCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : 'unknown error');
      process.exitCode = 1;
    });
}

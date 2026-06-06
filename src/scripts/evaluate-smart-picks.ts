import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { ConfigService } from '@nestjs/config';
import { evaluationEnvFilePaths, loadEnvFiles } from '../config/env-files';
import { readFeatureOpenAiModel } from '../common/utils/openai-config';
import {
  SMART_PICKS_AI_MODEL_ENV_KEY,
  SmartPicksAiGenerator,
} from '../smart-picks/services/smart-picks-ai-generator';
import { SMART_PICKS_GOLDEN_PERSONAS } from '../smart-picks/evaluation/smart-picks-golden-personas';
import {
  evaluateSmartPicksGoldenPersonas,
  type SmartPicksEvaluationReport,
} from '../smart-picks/evaluation/smart-picks-evaluation.runner';

interface EvaluationCliOptions {
  envFile: string | null;
  out: string;
  personaIds: string[];
  includeProductPicks: boolean;
}

const SMART_PICKS_EVALUATION_PROMPT_VERSION =
  'smart-picks-ai-first-v2-journal-summary';
const SMART_PICKS_EVALUATION_DEFAULT_MODEL = 'gpt-4.1-mini';

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  loadEnvFiles(evaluationEnvFilePaths(options.envFile));

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is required to run Smart Picks evaluation.',
    );
  }
  const personas = options.personaIds.length
    ? SMART_PICKS_GOLDEN_PERSONAS.filter((persona) =>
        options.personaIds.includes(persona.id),
      )
    : SMART_PICKS_GOLDEN_PERSONAS;
  if (personas.length === 0) {
    throw new Error('No Smart Picks evaluation personas matched the filter.');
  }

  const config = new ConfigService();
  const model =
    readFeatureOpenAiModel(
      config,
      SMART_PICKS_AI_MODEL_ENV_KEY,
      SMART_PICKS_EVALUATION_DEFAULT_MODEL,
    ) ?? SMART_PICKS_EVALUATION_DEFAULT_MODEL;
  const generator = new SmartPicksAiGenerator(config);
  const report = await evaluateSmartPicksGoldenPersonas({
    generator,
    model,
    promptVersion: SMART_PICKS_EVALUATION_PROMPT_VERSION,
    personas,
    includeProductPicks: options.includeProductPicks,
    onProgress: (event) => {
      if (event.phase === 'started') {
        console.log(
          `Smart Picks evaluation case ${event.index}/${event.total} started: ${event.personaId}`,
        );
        return;
      }
      console.log(
        `Smart Picks evaluation case ${event.index}/${event.total} completed: ${event.personaId} (${event.status}, score=${event.score})`,
      );
    },
  });

  await mkdir(resolve(options.out, '..'), { recursive: true });
  await writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(
    `Smart Picks evaluation saved to ${options.out}: ${report.passedCases}/${report.totalCases} passed, ${report.reviewCases} review, ${report.failedCases} failed.`,
  );

  if (!report.gate.passed) {
    console.error(formatSmartPicksEvaluationFailures(report));
    return 1;
  }

  return 0;
}

function parseArgs(args: string[]): EvaluationCliOptions {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const personas = readRepeatedFlag(args, '--persona');
  return {
    envFile: readFlag(args, '--env-file'),
    out: resolve(
      readFlag(args, '--out') ??
        join(
          process.cwd(),
          'src/smart-picks/evaluation/reports',
          `smart-picks-evaluation-${timestamp}.json`,
        ),
    ),
    personaIds: personas,
    includeProductPicks: !args.includes('--skip-products'),
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

function formatSmartPicksEvaluationFailures(
  report: SmartPicksEvaluationReport,
): string {
  const failedOrReviewCases = report.cases
    .filter((result) => result.status !== 'passed')
    .map((result) => {
      const failedChecks = result.checks
        .filter((check) => !check.passed)
        .map((check) => check.id)
        .join(', ');
      return `- ${result.id} (${result.status}): ${failedChecks || 'manual review required'}`;
    });

  return [
    'Smart Picks evaluation gate failed.',
    ...report.gate.blockers.map((blocker) => `Blocker: ${blocker}`),
    ...failedOrReviewCases,
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

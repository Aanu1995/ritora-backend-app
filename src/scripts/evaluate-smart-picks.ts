import 'dotenv/config';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { ConfigService } from '@nestjs/config';
import { SmartPicksAiGenerator } from '../smart-picks/services/smart-picks-ai-generator';
import { SMART_PICKS_GOLDEN_PERSONAS } from '../smart-picks/evaluation/smart-picks-golden-personas';
import { evaluateSmartPicksGoldenPersonas } from '../smart-picks/evaluation/smart-picks-evaluation.runner';

interface EvaluationCliOptions {
  out: string;
  personaIds: string[];
  includeProductPicks: boolean;
}

const SMART_PICKS_EVALUATION_PROMPT_VERSION = 'smart-picks-ai-first-v1';

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
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
  const model = config.get<string>('SMART_PICKS_AI_MODEL') ?? 'gpt-4.1-mini';
  const generator = new SmartPicksAiGenerator(config);
  const report = await evaluateSmartPicksGoldenPersonas({
    generator,
    model,
    promptVersion: SMART_PICKS_EVALUATION_PROMPT_VERSION,
    personas,
    includeProductPicks: options.includeProductPicks,
  });

  await mkdir(resolve(options.out, '..'), { recursive: true });
  await writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(
    `Smart Picks evaluation saved to ${options.out}: ${report.passedCases}/${report.totalCases} passed, ${report.reviewCases} review, ${report.failedCases} failed.`,
  );
}

function parseArgs(args: string[]): EvaluationCliOptions {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const personas = readRepeatedFlag(args, '--persona');
  return {
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

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
});

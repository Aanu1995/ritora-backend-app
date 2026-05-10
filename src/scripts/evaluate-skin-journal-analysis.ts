import { mkdir, readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { NestFactory } from '@nestjs/core';
import { SkinJournalAnalysisService } from '../skin-journal/services/skin-journal-analysis.service';
import { SkinJournalAnalysisEvaluationModule } from '../skin-journal/analysis-evaluation/skin-journal-analysis-evaluation.module';
import {
  SKIN_JOURNAL_ANALYSIS_EVALUATION_FIXTURES,
  type SkinJournalAnalysisEvaluationFixture,
} from '../skin-journal/analysis-evaluation/skin-journal-analysis-evaluation.fixtures';
import {
  buildAnalysisEvaluationReport,
  evaluateAnalysisResult,
} from '../skin-journal/analysis-evaluation/skin-journal-analysis-evaluation.runner';

interface EvaluationCliOptions {
  fixturesDir: string;
  out: string;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(
    SkinJournalAnalysisEvaluationModule,
    {
      logger: ['error', 'warn', 'log'],
    },
  );

  try {
    const analysis = app.get(SkinJournalAnalysisService);
    const results = [];
    let model = 'unknown';
    for (const fixture of SKIN_JOURNAL_ANALYSIS_EVALUATION_FIXTURES) {
      const imageBuffer = await loadFixtureImage(options.fixturesDir, fixture);
      const run = await analysis.analyzeEvaluationPhoto({
        fixtureId: fixture.id,
        imageBuffer,
      });
      model = run.observations.model_version || model;
      results.push(evaluateAnalysisResult(fixture, run.observations));
    }

    const report = buildAnalysisEvaluationReport({
      model,
      promptVersion: analysis.promptVersion(),
      results,
    });
    await mkdir(resolve(options.out, '..'), { recursive: true });
    await writeFile(
      options.out,
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    );
    console.log(
      `Skin Journal analysis evaluation saved to ${options.out}: ${report.passed_cases}/${report.total_cases} passed.`,
    );
  } finally {
    await app.close();
  }
}

function parseArgs(args: string[]): EvaluationCliOptions {
  const fixturesDir =
    readFlag(args, '--fixtures-dir') ??
    join(process.cwd(), 'src/skin-journal/analysis-evaluation/private-images');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    fixturesDir: resolve(fixturesDir),
    out: resolve(
      readFlag(args, '--out') ??
        join(
          process.cwd(),
          'src/skin-journal/analysis-evaluation/reports',
          `skin-journal-analysis-evaluation-${timestamp}.json`,
        ),
    ),
  };
}

function readFlag(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : null;
}

async function loadFixtureImage(
  fixturesDir: string,
  fixture: SkinJournalAnalysisEvaluationFixture,
): Promise<Buffer> {
  return readFile(resolve(fixturesDir, fixture.private_image_filename));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

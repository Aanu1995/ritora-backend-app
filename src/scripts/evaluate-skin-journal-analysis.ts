import { mkdir, readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { NestFactory } from '@nestjs/core';
import { evaluationEnvFilePaths, loadEnvFiles } from '../config/env-files';
import { SkinJournalAnalysisService } from '../skin-journal/services/skin-journal-analysis.service';
import { detectLocalFaceLikeRegion } from '../skin-journal/services/skin-journal-analysis-local-face-gate';
import { parseAnalysisPhotoPreflightIssues } from '../skin-journal/services/skin-journal-analysis-preflight';
import { SkinJournalAnalysisEvaluationModule } from '../skin-journal/analysis-evaluation/skin-journal-analysis-evaluation.module';
import {
  SKIN_JOURNAL_ANALYSIS_EVALUATION_FIXTURES,
  type SkinJournalAnalysisEvaluationFixture,
} from '../skin-journal/analysis-evaluation/skin-journal-analysis-evaluation.fixtures';
import {
  buildAnalysisEvaluationReport,
  type AnalysisEvaluationCaseResult,
  type LocalFaceGateEvaluationCaseResult,
  evaluateAnalysisPreflightRejection,
  evaluateAnalysisResult,
  evaluateLocalFaceGateResult,
} from '../skin-journal/analysis-evaluation/skin-journal-analysis-evaluation.runner';
import {
  AnalysisFailureCodeValue,
  type Angle,
  SKIN_JOURNAL_FRONT_PHOTO_ANGLE,
} from '../skin-journal/skin-journal.constants';

interface EvaluationCliOptions {
  envFile: string | null;
  fixturesDir: string;
  out: string;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  loadEnvFiles(evaluationEnvFilePaths(options.envFile));
  const app = await NestFactory.createApplicationContext(
    SkinJournalAnalysisEvaluationModule,
    {
      logger: ['error', 'warn', 'log'],
    },
  );

  try {
    const analysis = app.get(SkinJournalAnalysisService);
    const results: AnalysisEvaluationCaseResult[] = [];
    const localFaceGateResults: LocalFaceGateEvaluationCaseResult[] = [];
    let model = 'unknown';
    for (const fixture of SKIN_JOURNAL_ANALYSIS_EVALUATION_FIXTURES) {
      const imageBuffer = await loadFixtureImage(options.fixturesDir, fixture);
      const angle = fixtureAngle(fixture);
      const localFaceGate = await detectLocalFaceLikeRegion({
        angle,
        buffer: imageBuffer,
      });
      localFaceGateResults.push(
        evaluateLocalFaceGateResult(fixture, localFaceGate),
      );
      try {
        const run = await analysis.analyzeEvaluationPhoto({
          fixtureId: fixture.id,
          imageBuffer,
          angle,
        });
        model = run.observations.model_version || model;
        results.push(evaluateAnalysisResult(fixture, run.observations));
      } catch (error) {
        if (isLocalPreflightRejection(error)) {
          results.push(
            evaluateAnalysisPreflightRejection(
              fixture,
              parseAnalysisPhotoPreflightIssues(
                error instanceof Error ? error.message : null,
              ),
            ),
          );
          continue;
        }
        throw error;
      }
    }

    const report = buildAnalysisEvaluationReport({
      model,
      promptVersion: analysis.promptVersion(),
      results,
      localFaceGateResults,
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
    if (!report.gate.passed || !report.local_face_gate.passed) {
      console.error(
        `Skin Journal analysis evaluation gate failed: pass_rate=${report.gate.pass_rate}, min_pass_rate=${report.gate.min_pass_rate}, missing_required_cases=${report.gate.missing_required_cases.join(',') || 'none'}, local_face_gate_pass_rate=${report.local_face_gate.pass_rate}, local_face_gate_review_recommended=${report.local_face_gate.ml_detector_review_recommended}.`,
      );
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

function isLocalPreflightRejection(error: unknown): boolean {
  const candidate = error as { code?: unknown } | null;
  return (
    typeof error === 'object' &&
    error !== null &&
    candidate?.code === AnalysisFailureCodeValue.PhotoPreflightRejected
  );
}

function fixtureAngle(fixture: SkinJournalAnalysisEvaluationFixture): Angle {
  return fixture.angle ?? SKIN_JOURNAL_FRONT_PHOTO_ANGLE;
}

function parseArgs(args: string[]): EvaluationCliOptions {
  const fixturesDir =
    readFlag(args, '--fixtures-dir') ??
    join(process.cwd(), 'src/skin-journal/analysis-evaluation/private-images');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    envFile: readFlag(args, '--env-file'),
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

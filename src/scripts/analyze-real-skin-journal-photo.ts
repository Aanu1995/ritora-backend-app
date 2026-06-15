import { mkdir, writeFile } from 'fs/promises';
import { createHash } from 'crypto';
import { dirname, resolve } from 'path';
import { NestFactory } from '@nestjs/core';
import { DataSource, IsNull, Not, Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { evaluationEnvFilePaths, loadEnvFiles } from '../config/env-files';
import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { SkinJournalEntry } from '../skin-journal/entities/skin-journal-entry.entity';
import { SkinJournalEntryPhoto } from '../skin-journal/entities/skin-journal-entry-photo.entity';
import { SkinJournalService } from '../skin-journal/skin-journal.service';
import { SkinJournalAnalysisService } from '../skin-journal/services/skin-journal-analysis.service';
import { SkinJournalPhotoInterpretationService } from '../skin-journal/services/skin-journal-photo-interpretation.service';
import {
  buildAnalysisComparisonReference,
  withAnalysisComparisonReference,
} from '../skin-journal/skin-journal-reference-quality';
import type {
  AnalysisEntryContext,
  AnalysisObservations,
  AnalysisPhotoInput,
  AnalysisRoutineContext,
  AnalysisSkinContext,
  PhotoAnalysisInterpretation,
} from '../skin-journal/skin-journal.constants';
import { AnalysisStatusValue } from '../skin-journal/skin-journal.constants';

interface CliOptions {
  envFile: string | null;
  userId: string | null;
  entryId: string | null;
  out: string;
}

interface SkinJournalAnalysisContextBuilder {
  normalizePhotoRowsForEntry(
    entry: SkinJournalEntry,
    rows: SkinJournalEntryPhoto[],
  ): SkinJournalEntryPhoto[];
  frontPhotoRow(rows: SkinJournalEntryPhoto[]): SkinJournalEntryPhoto | null;
  toAnalysisPhotoInputs(rows: SkinJournalEntryPhoto[]): AnalysisPhotoInput[];
  loadEntryPhotoRows(
    userId: string,
    entryId: string,
  ): Promise<SkinJournalEntryPhoto[]>;
  findPreviousPhotoEntry(
    userId: string,
    entry: SkinJournalEntry,
  ): Promise<SkinJournalEntry | null>;
  buildAnalysisSkinContext(
    profile: SkinProfile | null,
  ): AnalysisSkinContext | null;
  buildAnalysisEntryContext(entry: SkinJournalEntry): AnalysisEntryContext;
  buildAnalysisRoutineContext(
    userId: string,
    entry: SkinJournalEntry,
    observations: AnalysisObservations | null,
    options?: {
      routineMemoryContext?: AnalysisRoutineContext['routine_memory'] | null;
    },
  ): Promise<AnalysisRoutineContext>;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  loadEnvFiles(evaluationEnvFilePaths(options.envFile));
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const dataSource = app.get(DataSource);
    const entries = dataSource.getRepository(SkinJournalEntry);
    const skinProfiles = dataSource.getRepository(SkinProfile);
    const skinJournal = app.get(SkinJournalService);
    const analysis = app.get(SkinJournalAnalysisService);
    const interpretationService = app.get(
      SkinJournalPhotoInterpretationService,
    );
    const contextBuilder =
      skinJournal as unknown as SkinJournalAnalysisContextBuilder;

    const entry = await resolveEntry(entries, options);
    if (!entry) {
      throw new Error(
        options.entryId
          ? 'No matching journal entry with a front photo was found.'
          : 'No skin journal entry with a front photo was found.',
      );
    }

    const photoRows = contextBuilder.normalizePhotoRowsForEntry(
      entry,
      await contextBuilder.loadEntryPhotoRows(entry.user_id, entry.id),
    );
    const frontPhoto = contextBuilder.frontPhotoRow(photoRows);
    if (!frontPhoto) {
      throw new Error('The selected journal entry has no front photo row.');
    }

    const currentPhotos = contextBuilder.toAnalysisPhotoInputs(photoRows);
    const [previousEntry, skinProfile, preAnalysisRoutineContext] =
      await Promise.all([
        contextBuilder.findPreviousPhotoEntry(entry.user_id, entry),
        skinProfiles.findOne({ where: { user_id: entry.user_id } }),
        contextBuilder.buildAnalysisRoutineContext(entry.user_id, entry, null),
      ]);
    const skinContext = contextBuilder.buildAnalysisSkinContext(skinProfile);
    const result = await analysis.analyze({
      userId: entry.user_id,
      entryId: entry.id,
      photoObjectKey: frontPhoto.photo_object_key,
      photos: currentPhotos,
      priorPhotoObjectKey: previousEntry?.photo_object_key ?? null,
      concernFocus: entry.concern_focus,
      priorAnalysis: previousEntry?.analysis_observations ?? null,
      skinContext,
      entryContext: contextBuilder.buildAnalysisEntryContext(entry),
      routineContext: preAnalysisRoutineContext,
    });
    const observations = withAnalysisComparisonReference(
      result.observations,
      previousEntry ? buildAnalysisComparisonReference(previousEntry) : null,
    );
    const routineContext = await contextBuilder.buildAnalysisRoutineContext(
      entry.user_id,
      entry,
      observations,
      {
        routineMemoryContext: preAnalysisRoutineContext.routine_memory,
      },
    );
    const interpretation = interpretationService.interpret(
      observations,
      new Date(),
      {
        skinContext,
        recentChange: entry.recent_change,
        routineContext,
      },
    );
    const report = buildReport({
      entry,
      previousEntry,
      currentPhotos,
      frontPhoto,
      result,
      observations,
      routineContext,
      interpretation,
    });

    await mkdir(dirname(options.out), { recursive: true });
    await writeFile(
      options.out,
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    );
    console.log(
      `Real Skin Journal photo analysis saved to ${options.out}: model=${report.model}, entry_date=${report.entry.entry_date}, status_if_saved=${report.status_if_saved}.`,
    );
    console.log(
      `Concerns: ${report.observations.detected_concerns.map((concern) => concern.concern).join(', ') || 'none'}. Guidance decisions: ${report.observations.guidance_decisions.length}.`,
    );
  } finally {
    await app.close();
  }
}

async function resolveEntry(
  entries: Repository<SkinJournalEntry>,
  options: CliOptions,
): Promise<SkinJournalEntry | null> {
  if (options.entryId) {
    return entries.findOne({
      where: {
        id: options.entryId,
        ...(options.userId ? { user_id: options.userId } : {}),
        photo_object_key: Not(IsNull()),
      },
    });
  }
  return entries.findOne({
    where: {
      ...(options.userId ? { user_id: options.userId } : {}),
      photo_object_key: Not(IsNull()),
    },
    order: {
      entry_date: 'DESC',
      updated_at: 'DESC',
    },
  });
}

function buildReport(params: {
  entry: SkinJournalEntry;
  previousEntry: SkinJournalEntry | null;
  currentPhotos: AnalysisPhotoInput[];
  frontPhoto: SkinJournalEntryPhoto;
  result: Awaited<ReturnType<SkinJournalAnalysisService['analyze']>>;
  observations: AnalysisObservations;
  routineContext: AnalysisRoutineContext;
  interpretation: PhotoAnalysisInterpretation;
}) {
  const observations = params.observations;
  return {
    generated_at: new Date().toISOString(),
    mode: 'read_only_real_s3_photo_analysis',
    model: observations.model_version,
    prompt_version: params.result.metadata.prompt_version,
    status_if_saved:
      observations.image_quality.face_detected &&
      observations.image_quality.needs_retake !== true
        ? AnalysisStatusValue.Completed
        : AnalysisStatusValue.NeedsReview,
    entry: {
      id: params.entry.id,
      user_hash: shortHash(params.entry.user_id),
      entry_date: params.entry.entry_date,
      time_zone: params.entry.time_zone,
      photo_object_key_hash: shortHash(params.frontPhoto.photo_object_key),
      photo_count: params.currentPhotos.length,
      angles: params.currentPhotos.map((photo) => photo.angle),
      previous_photo_entry_date: params.previousEntry?.entry_date ?? null,
    },
    metadata: params.result.metadata,
    context_coverage: summarizeRoutineContext(params.routineContext),
    observations: {
      image_quality: observations.image_quality,
      per_angle_quality: observations.per_angle_quality ?? [],
      detected_concerns: observations.detected_concerns,
      reaction_signals: observations.reaction_signals,
      barrier_signs: observations.barrier_signs,
      guidance_decisions: observations.guidance_decisions ?? [],
      safety_flags: observations.safety_flags ?? null,
      should_flag_for_doctor: observations.should_flag_for_doctor,
      doctor_flag_reason: observations.doctor_flag_reason ?? null,
      overall_assessment: observations.overall_assessment,
      overall_change_from_previous:
        observations.overall_change_from_previous ?? null,
      user_visible_message: observations.user_visible_message ?? null,
    },
    interpretation: {
      code: params.interpretation.code,
      severity: params.interpretation.severity,
      summary_key: params.interpretation.summary_key,
      guidance_keys: params.interpretation.guidance_keys,
      caveat_keys: params.interpretation.caveat_keys,
      source_ids: params.interpretation.source_ids,
      reading_quality: params.interpretation.reading_quality ?? null,
      concern_guidance: params.interpretation.concern_guidance ?? [],
    },
  };
}

function summarizeRoutineContext(context: AnalysisRoutineContext) {
  return {
    active_recovery_present:
      context.active_recovery !== null && context.active_recovery !== undefined,
    routine_memory_present:
      context.routine_memory !== null && context.routine_memory !== undefined,
    routine_memory_summary: context.routine_memory?.summary ?? null,
    active_shelf_product_count: context.active_shelf_products.length,
    routine_product_count: context.routine_products.length,
    recent_application_count: context.recent_applications.length,
    recent_application_item_count: context.recent_applications.reduce(
      (sum, application) => sum + application.items.length,
      0,
    ),
    recent_check_in_count: context.recent_check_ins.length,
    products_with_lifecycle_count: [
      ...context.active_shelf_products,
      ...context.routine_products,
    ].filter(
      (product) =>
        product.opened_at ||
        product.expires_at ||
        product.effective_expires_at ||
        product.introduction_status,
    ).length,
    products_with_guidance_count: [
      ...context.active_shelf_products,
      ...context.routine_products,
    ].filter(
      (product) =>
        product.application_method ||
        product.quantity ||
        typeof product.wait_minutes === 'number' ||
        product.guidance_steps?.length ||
        product.guidance_cautions?.length,
    ).length,
  };
}

function parseArgs(args: string[]): CliOptions {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    envFile: readFlag(args, '--env-file'),
    userId: readFlag(args, '--user-id'),
    entryId: readFlag(args, '--entry-id'),
    out: resolve(
      readFlag(args, '--out') ??
        `/private/tmp/ritora-real-photo-analysis-${timestamp}.json`,
    ),
  };
}

function readFlag(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : null;
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

import sharp from 'sharp';
import {
  AnalysisFailureCodeValue,
  Angle,
  SKIN_JOURNAL_ANALYSIS_MAX_ASPECT_RATIO,
  SKIN_JOURNAL_ANALYSIS_MIN_IMAGE_DIMENSION,
  SKIN_JOURNAL_ANALYSIS_MIN_LUMA_STANDARD_DEVIATION,
} from '../skin-journal.constants';
import { SkinJournalAnalysisError } from './skin-journal-analysis-errors';
import { detectLocalFaceLikeRegion } from './skin-journal-analysis-local-face-gate';

export const AnalysisPhotoPreflightIssueValue = {
  ImageTooSmall: 'image_too_small',
  ExtremeAspectRatio: 'extreme_aspect_ratio',
  BlankOrLowDetail: 'blank_or_low_detail',
  NoLocalFaceDetected: 'no_local_face_detected',
  UnreadableImage: 'unreadable_image',
} as const;

export type AnalysisPhotoPreflightIssue =
  (typeof AnalysisPhotoPreflightIssueValue)[keyof typeof AnalysisPhotoPreflightIssueValue];

export const SKIN_JOURNAL_ANALYSIS_PREFLIGHT_ISSUES = Object.values(
  AnalysisPhotoPreflightIssueValue,
);

const PHOTO_PREFLIGHT_ERROR_PREFIX = 'Photo failed local quality checks:';

export interface AnalysisPhotoBufferInput {
  angle: Angle;
  buffer: Buffer;
}

export interface AnalysisPhotoPreflightResult {
  angle: Angle;
  width: number | null;
  height: number | null;
  byte_size: number;
  luma_standard_deviation: number | null;
  local_face_detected: boolean | null;
  local_face_confidence: number | null;
  issues: AnalysisPhotoPreflightIssue[];
  passed: boolean;
}

export function assertAnalysisPhotoPayloadLimits(params: {
  photos: AnalysisPhotoBufferInput[];
  priorPhoto: Buffer | null;
  maxImageBytes: number;
  maxTotalImageBytes: number;
}): void {
  const allBuffers = [
    ...params.photos.map((photo) => photo.buffer),
    ...(params.priorPhoto ? [params.priorPhoto] : []),
  ];
  const largest = allBuffers.reduce(
    (max, buffer) => Math.max(max, buffer.length),
    0,
  );
  const total = allBuffers.reduce((sum, buffer) => sum + buffer.length, 0);
  if (largest > params.maxImageBytes || total > params.maxTotalImageBytes) {
    throw new SkinJournalAnalysisError(
      AnalysisFailureCodeValue.PayloadTooLarge,
      'Photo analysis payload exceeds the allowed image byte budget.',
      false,
    );
  }
}

export async function assertAnalysisPhotoPreflight(params: {
  photos: AnalysisPhotoBufferInput[];
  minDimension?: number;
  maxAspectRatio?: number;
  minLumaStandardDeviation?: number;
}): Promise<AnalysisPhotoPreflightResult[]> {
  const results = await Promise.all(
    params.photos.map((photo) =>
      inspectAnalysisPhoto(photo, {
        minDimension:
          params.minDimension ?? SKIN_JOURNAL_ANALYSIS_MIN_IMAGE_DIMENSION,
        maxAspectRatio:
          params.maxAspectRatio ?? SKIN_JOURNAL_ANALYSIS_MAX_ASPECT_RATIO,
        minLumaStandardDeviation:
          params.minLumaStandardDeviation ??
          SKIN_JOURNAL_ANALYSIS_MIN_LUMA_STANDARD_DEVIATION,
      }),
    ),
  );
  const failed = results.find((result) => !result.passed);
  if (failed) {
    throw new SkinJournalAnalysisError(
      AnalysisFailureCodeValue.PhotoPreflightRejected,
      `${PHOTO_PREFLIGHT_ERROR_PREFIX} ${failed.issues.join(', ')}`,
      false,
    );
  }
  return results;
}

export function parseAnalysisPhotoPreflightIssues(
  message: string | null | undefined,
): AnalysisPhotoPreflightIssue[] {
  if (!message) {
    return [];
  }
  const rawIssues = message.includes(PHOTO_PREFLIGHT_ERROR_PREFIX)
    ? message.slice(
        message.indexOf(PHOTO_PREFLIGHT_ERROR_PREFIX) +
          PHOTO_PREFLIGHT_ERROR_PREFIX.length,
      )
    : message;
  return rawIssues
    .split(',')
    .map((issue) => issue.trim())
    .filter(isAnalysisPhotoPreflightIssue);
}

async function inspectAnalysisPhoto(
  photo: AnalysisPhotoBufferInput,
  thresholds: {
    minDimension: number;
    maxAspectRatio: number;
    minLumaStandardDeviation: number;
  },
): Promise<AnalysisPhotoPreflightResult> {
  try {
    const image = sharp(photo.buffer, { failOn: 'none' }).rotate();
    const metadata = await image.metadata();
    const width = metadata.width ?? null;
    const height = metadata.height ?? null;
    const issues: AnalysisPhotoPreflightIssue[] = [];

    if (
      !width ||
      !height ||
      width < thresholds.minDimension ||
      height < thresholds.minDimension
    ) {
      issues.push(AnalysisPhotoPreflightIssueValue.ImageTooSmall);
    }

    if (width && height) {
      const aspectRatio = Math.max(width / height, height / width);
      if (aspectRatio > thresholds.maxAspectRatio) {
        issues.push(AnalysisPhotoPreflightIssueValue.ExtremeAspectRatio);
      }
    }

    const lumaStandardDeviation = await computeLumaStandardDeviation(
      photo.buffer,
    );
    if (
      lumaStandardDeviation !== null &&
      lumaStandardDeviation < thresholds.minLumaStandardDeviation
    ) {
      issues.push(AnalysisPhotoPreflightIssueValue.BlankOrLowDetail);
    }

    const localFaceDetection =
      issues.length === 0 ? await detectLocalFaceLikeRegion(photo) : null;
    if (localFaceDetection && !localFaceDetection.detected) {
      issues.push(AnalysisPhotoPreflightIssueValue.NoLocalFaceDetected);
    }

    return {
      angle: photo.angle,
      width,
      height,
      byte_size: photo.buffer.length,
      luma_standard_deviation: lumaStandardDeviation,
      local_face_detected: localFaceDetection?.detected ?? null,
      local_face_confidence:
        localFaceDetection === null
          ? null
          : Number(localFaceDetection.confidence.toFixed(3)),
      issues,
      passed: issues.length === 0,
    };
  } catch {
    return {
      angle: photo.angle,
      width: null,
      height: null,
      byte_size: photo.buffer.length,
      luma_standard_deviation: null,
      local_face_detected: null,
      local_face_confidence: null,
      issues: [AnalysisPhotoPreflightIssueValue.UnreadableImage],
      passed: false,
    };
  }
}

async function computeLumaStandardDeviation(
  buffer: Buffer,
): Promise<number | null> {
  const sample = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({ width: 64, height: 64, fit: 'inside' })
    .greyscale()
    .raw()
    .toBuffer();
  if (sample.length === 0) {
    return null;
  }
  const mean =
    sample.reduce((sum, value) => sum + value, 0) / Math.max(1, sample.length);
  const variance =
    sample.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    Math.max(1, sample.length);
  return Math.sqrt(variance);
}

function isAnalysisPhotoPreflightIssue(
  value: string,
): value is AnalysisPhotoPreflightIssue {
  return (SKIN_JOURNAL_ANALYSIS_PREFLIGHT_ISSUES as string[]).includes(value);
}

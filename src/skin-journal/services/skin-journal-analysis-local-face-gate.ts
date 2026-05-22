import sharp from 'sharp';
import type { Angle } from '../skin-journal.constants';

export interface AnalysisLocalFaceInput {
  angle: Angle;
  buffer: Buffer;
}

export interface LocalFaceDetectionResult {
  detected: boolean;
  confidence: number;
}

interface ImageSample {
  data: Buffer;
  width: number;
  height: number;
}

interface RegionStats {
  count: number;
  skin_like_count: number;
  luma_sum: number;
}

const FACE_SAMPLE_SIZE = 96;
const HEAD_ON_FACE_CONFIDENCE_THRESHOLD = 0.4;
const SIDE_FACE_CONFIDENCE_THRESHOLD = 0.34;

export async function detectLocalFaceLikeRegion(
  photo: AnalysisLocalFaceInput,
): Promise<LocalFaceDetectionResult> {
  const sample = await readImageSample(photo.buffer);
  const centralFace = regionStats(sample, isCentralFaceRegion);
  const border = regionStats(sample, isBorderRegion);
  const centralSkinRatio = ratio(
    centralFace.skin_like_count,
    centralFace.count,
  );
  const borderSkinRatio = ratio(border.skin_like_count, border.count);
  const skinScore = clamp((centralSkinRatio - 0.04) / 0.26);
  const skinContrastScore = clamp(
    (centralSkinRatio - borderSkinRatio - 0.04) / 0.18,
  );
  const centralMeanLuma = ratio(centralFace.luma_sum, centralFace.count);
  const featureScore = computeFeatureContrastScore(sample, centralMeanLuma);
  const symmetryScore = computeVerticalSymmetryScore(sample);
  const detailScore = clamp((computeCentralGradient(sample) - 3) / 18);
  const sideProfile = photo.angle !== 'head_on';
  const uniformSkinPatchCue =
    centralSkinRatio >= 0.85 && skinContrastScore < 0.08 && detailScore < 0.04;
  const confidence = sideProfile
    ? 0.45 * skinScore +
      0.2 * skinContrastScore +
      0.2 * featureScore +
      0.1 * detailScore +
      0.05 * symmetryScore
    : 0.38 * skinScore +
      0.18 * skinContrastScore +
      0.18 * featureScore +
      0.16 * symmetryScore +
      0.1 * detailScore;
  const threshold = sideProfile
    ? SIDE_FACE_CONFIDENCE_THRESHOLD
    : HEAD_ON_FACE_CONFIDENCE_THRESHOLD;
  const hasColorCue = centralSkinRatio >= 0.06 || skinContrastScore >= 0.15;
  const hasStructuralCue =
    featureScore >= 0.2 && detailScore >= 0.2 && symmetryScore >= 0.5;

  return {
    confidence: clamp(confidence),
    detected:
      !uniformSkinPatchCue &&
      confidence >= threshold &&
      (hasColorCue || hasStructuralCue),
  };
}

async function readImageSample(buffer: Buffer): Promise<ImageSample> {
  const { data, info } = await sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize(FACE_SAMPLE_SIZE, FACE_SAMPLE_SIZE, {
      fit: 'cover',
      position: 'centre',
    })
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    data,
    width: info.width,
    height: info.height,
  };
}

function regionStats(
  sample: ImageSample,
  includesPixel: (x: number, y: number, sample: ImageSample) => boolean,
): RegionStats {
  const stats: RegionStats = {
    count: 0,
    skin_like_count: 0,
    luma_sum: 0,
  };
  for (let y = 0; y < sample.height; y += 1) {
    for (let x = 0; x < sample.width; x += 1) {
      if (!includesPixel(x, y, sample)) {
        continue;
      }
      const pixel = readPixel(sample, x, y);
      stats.count += 1;
      stats.luma_sum += pixel.luma;
      if (isBroadSkinChroma(pixel.r, pixel.g, pixel.b, pixel.luma)) {
        stats.skin_like_count += 1;
      }
    }
  }
  return stats;
}

function isCentralFaceRegion(
  x: number,
  y: number,
  sample: ImageSample,
): boolean {
  const normalizedX = (x + 0.5 - sample.width / 2) / (sample.width * 0.31);
  const normalizedY = (y + 0.5 - sample.height * 0.51) / (sample.height * 0.38);
  return normalizedX ** 2 + normalizedY ** 2 <= 1;
}

function isBorderRegion(x: number, y: number, sample: ImageSample): boolean {
  const borderSize = Math.max(6, Math.floor(sample.width * 0.1));
  return (
    x < borderSize ||
    y < borderSize ||
    x >= sample.width - borderSize ||
    y >= sample.height - borderSize
  );
}

function computeFeatureContrastScore(
  sample: ImageSample,
  centralMeanLuma: number,
): number {
  const upperDarkRatio = darkPixelRatio(
    sample,
    centralMeanLuma - 18,
    0.26,
    0.74,
    0.28,
    0.5,
  );
  const lowerDarkRatio = darkPixelRatio(
    sample,
    centralMeanLuma - 16,
    0.3,
    0.7,
    0.56,
    0.75,
  );
  return clamp((upperDarkRatio + lowerDarkRatio - 0.025) / 0.12);
}

function darkPixelRatio(
  sample: ImageSample,
  lumaThreshold: number,
  minXRatio: number,
  maxXRatio: number,
  minYRatio: number,
  maxYRatio: number,
): number {
  let count = 0;
  let darkCount = 0;
  const minX = Math.floor(sample.width * minXRatio);
  const maxX = Math.floor(sample.width * maxXRatio);
  const minY = Math.floor(sample.height * minYRatio);
  const maxY = Math.floor(sample.height * maxYRatio);

  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      count += 1;
      if (lumaAt(sample, x, y) < lumaThreshold) {
        darkCount += 1;
      }
    }
  }
  return ratio(darkCount, count);
}

function computeVerticalSymmetryScore(sample: ImageSample): number {
  let diffSum = 0;
  let count = 0;
  const centerX = Math.floor(sample.width / 2);
  const minY = Math.floor(sample.height * 0.18);
  const maxY = Math.floor(sample.height * 0.84);
  const radius = Math.floor(sample.width * 0.3);

  for (let y = minY; y < maxY; y += 1) {
    for (let offset = 1; offset < radius; offset += 1) {
      const leftX = centerX - offset;
      const rightX = centerX + offset;
      if (leftX < 0 || rightX >= sample.width) {
        continue;
      }
      diffSum += Math.abs(lumaAt(sample, leftX, y) - lumaAt(sample, rightX, y));
      count += 1;
    }
  }

  return clamp((1 - ratio(diffSum, count) / 85 - 0.48) / 0.34);
}

function computeCentralGradient(sample: ImageSample): number {
  let gradientSum = 0;
  let count = 0;

  for (let y = 1; y < sample.height - 1; y += 1) {
    for (let x = 1; x < sample.width - 1; x += 1) {
      if (!isCentralFaceRegion(x, y, sample)) {
        continue;
      }
      const current = lumaAt(sample, x, y);
      const right = lumaAt(sample, x + 1, y);
      const below = lumaAt(sample, x, y + 1);
      gradientSum +=
        (Math.abs(current - right) + Math.abs(current - below)) / 2;
      count += 1;
    }
  }

  return ratio(gradientSum, count);
}

function readPixel(
  sample: ImageSample,
  x: number,
  y: number,
): { r: number; g: number; b: number; luma: number } {
  const offset = (y * sample.width + x) * 3;
  const r = sample.data[offset] ?? 0;
  const g = sample.data[offset + 1] ?? 0;
  const b = sample.data[offset + 2] ?? 0;
  return { r, g, b, luma: computeLuma(r, g, b) };
}

function lumaAt(sample: ImageSample, x: number, y: number): number {
  const offset = (y * sample.width + x) * 3;
  return computeLuma(
    sample.data[offset] ?? 0,
    sample.data[offset + 1] ?? 0,
    sample.data[offset + 2] ?? 0,
  );
}

function isBroadSkinChroma(
  r: number,
  g: number,
  b: number,
  luma: number,
): boolean {
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return (
    luma >= 28 && luma <= 245 && cb >= 65 && cb <= 160 && cr >= 115 && cr <= 200
  );
}

function computeLuma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function ratio(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : numerator / denominator;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

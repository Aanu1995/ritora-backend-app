import sharp from 'sharp';
import type { ExtractionResult } from '../../catalogue/openai-extraction.utils';
import { DEFAULT_LANGUAGE, type AppLanguage } from '../../common/i18n/i18n';
import { LookupConfidence, ProductCategory } from '../../shelf/shelf.types';
import {
  ProductCheckSource,
  type ProductCheckResponse,
} from '../product-check.types';
import {
  photoExtractionAssertions,
  productCheckAssertions,
} from './product-check-evaluation-assertions';
import {
  buildProductCheckService,
  type ProductCheckEvaluationRuntime,
} from './product-check-evaluation-runtime';
import type { PhotoQuickCheckEvaluationCaseResult } from './product-check-evaluation.types';
import type { PhotoQuickCheckRealLifeCase } from './product-check-real-life-cases';

const DEFAULT_PHOTO_WIDTH = 1400;
const DEFAULT_PHOTO_HEIGHT = 1000;

export async function evaluatePhotoQuickCheckCase(
  runtime: ProductCheckEvaluationRuntime,
  evaluationCase: PhotoQuickCheckRealLifeCase,
  language: AppLanguage = DEFAULT_LANGUAGE,
  includeLanguageInCaseId = false,
): Promise<PhotoQuickCheckEvaluationCaseResult> {
  const buffer = await createSyntheticLabelPhoto(evaluationCase.labelLines);
  const extraction = await runtime.photoExtractorProvider.extractFromImages({
    heroImageIndex: 0,
    sourceImageCount: 1,
    images: [
      {
        buffer,
        mimetype: 'image/png',
        sourceIndex: 0,
        isHero: true,
        variant: 'overview',
        width: DEFAULT_PHOTO_WIDTH,
        height: DEFAULT_PHOTO_HEIGHT,
      },
    ],
  });
  const checks = photoExtractionAssertions(evaluationCase, extraction);
  const output = await maybeRunQuickCheck(
    runtime,
    evaluationCase,
    extraction,
    language,
  );

  if (output) {
    checks.push(...productCheckAssertions(evaluationCase.expected, output));
  } else {
    checks.push({
      id: 'photo_quick_check_completed',
      expected: true,
      actual: false,
      passed: false,
    });
  }

  return {
    kind: 'photo_quick_check',
    id: includeLanguageInCaseId
      ? `${evaluationCase.id}__${language}`
      : evaluationCase.id,
    title: includeLanguageInCaseId
      ? `${evaluationCase.title} [${language}]`
      : evaluationCase.title,
    language,
    status: checks.every((item) => item.passed) ? 'passed' : 'failed',
    checks,
    extraction,
    output,
  };
}

async function maybeRunQuickCheck(
  runtime: ProductCheckEvaluationRuntime,
  evaluationCase: PhotoQuickCheckRealLifeCase,
  extraction: ExtractionResult | null,
  language: AppLanguage,
): Promise<ProductCheckResponse | null> {
  const identity = extraction?.data.identity;
  const inciIngredients = identity?.inciIngredients ?? [];
  if (!identity || inciIngredients.length === 0) {
    return null;
  }

  return buildProductCheckService(runtime, evaluationCase).checkForUser(
    'eval-user',
    {
      product: {
        source: ProductCheckSource.PhotoExtraction,
        brand: identity.brand ?? null,
        name: identity.name ?? null,
        category: identity.category ?? ProductCategory.Other,
        inciIngredients,
        lookupConfidence: LookupConfidence.Low,
        lookupWarnings: extraction?.warnings ?? [],
        reviewRequired: true,
      },
    },
    language,
  );
}

async function createSyntheticLabelPhoto(lines: string[]): Promise<Buffer> {
  const svg = [
    `<svg width="${DEFAULT_PHOTO_WIDTH}" height="${DEFAULT_PHOTO_HEIGHT}" viewBox="0 0 ${DEFAULT_PHOTO_WIDTH} ${DEFAULT_PHOTO_HEIGHT}" xmlns="http://www.w3.org/2000/svg">`,
    '<rect width="100%" height="100%" fill="#f8f5ed"/>',
    '<rect x="60" y="55" width="1280" height="890" rx="34" fill="#fffdf8" stroke="#1d3028" stroke-width="6"/>',
    ...lines.map((line, index) => {
      const fontSize = index <= 1 ? 62 : 38;
      const y = 150 + index * 82;
      return `<text x="115" y="${y}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="${index <= 1 ? 700 : 500}" fill="#14251e">${escapeXml(line)}</text>`;
    }),
    '</svg>',
  ].join('');

  return sharp(Buffer.from(svg)).png().toBuffer();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

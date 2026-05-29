import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import {
  ApplicationMethod,
  ProductCategory,
  Quantity,
} from '../../shelf/shelf.types';
import { CataloguePhotoProcessorService } from '../catalogue-photo-processor.service';
import type { UploadedCatalogueImage } from '../catalogue-photo.types';
import {
  OPENAI_EXTRACTION_STRUCTURED_OUTPUT_ATTEMPTS,
  OPENAI_PRODUCT_EXTRACTION_MAX_OUTPUT_TOKENS,
  OpenAiExtractorProvider,
} from '../openai-extractor.provider';
import type { ExtractionResult } from '../openai-extraction.utils';

export type CataloguePhotoEvaluationCheck = {
  code: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
};

export type CataloguePhotoEvaluationCaseResult = {
  caseId: string;
  title: string;
  status: 'passed' | 'failed';
  hardChecksPassed: number;
  hardChecksTotal: number;
  hardCheckFailures: string[];
  extraction: {
    brand: string | null;
    name: string | null;
    category: string | null;
    sizeMl: number | null;
    ingredients: string[];
    steps: string[];
    cautions: string[];
    applicationMethod: string | null;
    quantity: string | null;
  } | null;
  checks: CataloguePhotoEvaluationCheck[];
};

export type CataloguePhotoEvaluationReport = {
  reportType: 'catalogue_photo_extraction_live_ai_evaluation';
  generatedAt: string;
  model: string | null;
  timeoutMs: {
    photoExtraction: number;
  };
  maxOutputTokens: {
    photoExtraction: number;
  };
  structuredOutputAttempts: number;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  gate: {
    passed: boolean;
    blockers: string[];
  };
  cases: CataloguePhotoEvaluationCaseResult[];
};

type CataloguePhotoEvaluationCase = {
  id: string;
  title: string;
  heroImageIndex: number;
  photos: Array<{
    name: string;
    heading: string;
    lines: string[];
  }>;
  expected: {
    brandIncludes: string;
    nameIncludes: string[];
    category: ProductCategory;
    sizeMl?: number;
    ingredientsInclude: string[];
    stepsInclude?: string[];
    cautionsInclude?: string[];
    applicationMethod?: ApplicationMethod;
    quantity?: Quantity;
  };
};

const PHOTO_EXTRACTION_TIMEOUT_MS = 45_000;

const CATALOGUE_PHOTO_EVALUATION_CASES: CataloguePhotoEvaluationCase[] = [
  {
    id: 'cleanser_complete_label',
    title: 'Cleanser label extracts core identity, size, ingredients, and use',
    heroImageIndex: 0,
    photos: [
      {
        name: 'cleanser-front',
        heading: 'RITORA LAB',
        lines: [
          'Calm Barrier Cleanser',
          'Gentle Cream Cleanser',
          'For dry and sensitive skin',
          'Hydrating, non-stripping, fragrance-free',
          '150 ml / 5.0 fl oz',
        ],
      },
      {
        name: 'cleanser-back',
        heading: 'Calm Barrier Cleanser',
        lines: [
          'Directions: Massage onto wet skin with fingertips, then rinse thoroughly.',
          'Ingredients: Aqua, Glycerin, Cocamidopropyl Betaine, Sodium Lauroyl Sarcosinate, Panthenol, Ceramide NP, Sodium Chloride, Citric Acid, Phenoxyethanol.',
          'Caution: For external use only. Avoid direct contact with eyes.',
          'Responsible person: Ritora Lab AB, Stockholm, Sweden. support@ritora.example',
        ],
      },
    ],
    expected: {
      brandIncludes: 'ritora',
      nameIncludes: ['calm', 'barrier', 'cleanser'],
      category: ProductCategory.Cleanser,
      sizeMl: 150,
      ingredientsInclude: ['Aqua', 'Glycerin', 'Ceramide NP'],
      stepsInclude: ['massage', 'wet skin', 'rinse'],
      cautionsInclude: ['external use', 'eyes'],
      applicationMethod: ApplicationMethod.Fingertips,
    },
  },
  {
    id: 'spf_front_label',
    title: 'SPF label is categorized as sun protection, not moisturizer',
    heroImageIndex: 0,
    photos: [
      {
        name: 'spf-front',
        heading: 'NORDIC SKIN',
        lines: [
          'Daily Shield SPF 50',
          'Broad Spectrum UVA/UVB Sunscreen',
          'Lightweight sun fluid',
          'For all skin types',
          '50 ml',
        ],
      },
      {
        name: 'spf-back',
        heading: 'Daily Shield SPF 50',
        lines: [
          'How to use: Apply a generous amount every morning as the last step of skincare. Reapply every two hours during sun exposure.',
          'Ingredients: Aqua, Diethylamino Hydroxybenzoyl Hexyl Benzoate, Ethylhexyl Triazone, Glycerin, Niacinamide, Tocopherol, Phenoxyethanol.',
          'Warning: Avoid contact with eyes. Reduce sun exposure even while using sunscreen.',
        ],
      },
    ],
    expected: {
      brandIncludes: 'nordic',
      nameIncludes: ['daily', 'shield', 'spf 50'],
      category: ProductCategory.SunProtection,
      sizeMl: 50,
      ingredientsInclude: ['Ethylhexyl Triazone', 'Niacinamide'],
      stepsInclude: ['morning', 'reapply'],
      quantity: Quantity.Generous,
    },
  },
  {
    id: 'retinal_serum_usage',
    title: 'Retinal serum keeps active product identity and caution context',
    heroImageIndex: 0,
    photos: [
      {
        name: 'serum-front',
        heading: 'AURORA DERM',
        lines: [
          'Retinal Night Renewal Serum',
          '0.05% Retinal + Peptides',
          'Smooths texture and supports firmness',
          '30 ml',
        ],
      },
      {
        name: 'serum-back',
        heading: 'Retinal Night Renewal Serum',
        lines: [
          'Directions: Apply two to three drops at night after cleansing. Follow with moisturizer.',
          'Ingredients: Aqua, Propanediol, Glycerin, Retinal, Palmitoyl Tripeptide-5, Squalane, Lecithin, Xanthan Gum, Phenoxyethanol.',
          'Caution: Patch test first. Use sunscreen during the day. Do not use on irritated skin.',
        ],
      },
    ],
    expected: {
      brandIncludes: 'aurora',
      nameIncludes: ['retinal', 'night', 'serum'],
      category: ProductCategory.Serum,
      sizeMl: 30,
      ingredientsInclude: ['Retinal', 'Squalane'],
      stepsInclude: ['night', 'moisturizer'],
      cautionsInclude: ['patch test', 'sunscreen'],
      quantity: Quantity.TwoToThreeDrops,
    },
  },
];

export async function buildCataloguePhotoEvaluationReport(
  input: {
    generatedAt?: Date;
  } = {},
): Promise<CataloguePhotoEvaluationReport> {
  const generatedAt = input.generatedAt ?? new Date();
  const configService = configServiceFromEnv();
  const model = readCatalogueModel();
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for Catalogue evaluation.');
  }
  if (!model) {
    throw new Error('CATALOGUE_AI_MODEL or OPENAI_MODEL is required.');
  }

  const processor = new CataloguePhotoProcessorService(configService);
  const extractor = new OpenAiExtractorProvider(configService);
  const cases: CataloguePhotoEvaluationCaseResult[] = [];

  for (const evaluationCase of CATALOGUE_PHOTO_EVALUATION_CASES) {
    const images = await renderCaseImages(evaluationCase);
    const processed = await processor.prepareForExtraction(
      images,
      evaluationCase.heroImageIndex,
    );
    const extraction = await extractor.extractFromImages(
      processed.extractionInput,
    );
    const checks = evaluateCase(evaluationCase, extraction);
    const hardCheckFailures = checks
      .filter((item) => !item.passed)
      .map((item) => item.code);

    cases.push({
      caseId: evaluationCase.id,
      title: evaluationCase.title,
      status: hardCheckFailures.length === 0 ? 'passed' : 'failed',
      hardChecksPassed: checks.length - hardCheckFailures.length,
      hardChecksTotal: checks.length,
      hardCheckFailures,
      extraction: extraction ? summarizeExtraction(extraction) : null,
      checks,
    });
  }

  const failedCases = cases.filter((item) => item.status === 'failed').length;
  const blockers = [
    ...(failedCases > 0
      ? ['One or more Catalogue photo extraction cases failed.']
      : []),
  ];

  return {
    reportType: 'catalogue_photo_extraction_live_ai_evaluation',
    generatedAt: generatedAt.toISOString(),
    model,
    timeoutMs: {
      photoExtraction: PHOTO_EXTRACTION_TIMEOUT_MS,
    },
    maxOutputTokens: {
      photoExtraction: OPENAI_PRODUCT_EXTRACTION_MAX_OUTPUT_TOKENS,
    },
    structuredOutputAttempts: OPENAI_EXTRACTION_STRUCTURED_OUTPUT_ATTEMPTS,
    totalCases: cases.length,
    passedCases: cases.length - failedCases,
    failedCases,
    gate: {
      passed: blockers.length === 0,
      blockers,
    },
    cases,
  };
}

function evaluateCase(
  evaluationCase: CataloguePhotoEvaluationCase,
  extraction: ExtractionResult | null,
): CataloguePhotoEvaluationCheck[] {
  const identity = extraction?.data.identity;
  const guidance = extraction?.data.guidance;
  const expected = evaluationCase.expected;
  const ingredients = identity?.inciIngredients ?? [];
  const steps = guidance?.steps ?? [];
  const cautions = guidance?.cautions ?? [];
  const checks: CataloguePhotoEvaluationCheck[] = [
    check(
      'extraction_returned',
      Boolean(extraction),
      true,
      Boolean(extraction),
    ),
    check(
      'brand_matches_label',
      includesText(identity?.brand, expected.brandIncludes),
      expected.brandIncludes,
      identity?.brand ?? null,
    ),
    check(
      'name_matches_label',
      expected.nameIncludes.every((term) => includesText(identity?.name, term)),
      expected.nameIncludes,
      identity?.name ?? null,
    ),
    check(
      'category_matches_primary_role',
      identity?.category === expected.category,
      expected.category,
      identity?.category ?? null,
    ),
    check(
      'ingredients_include_required_items',
      expected.ingredientsInclude.every((ingredient) =>
        listIncludesText(ingredients, ingredient),
      ),
      expected.ingredientsInclude,
      ingredients,
    ),
  ];

  if (typeof expected.sizeMl === 'number') {
    checks.push(
      check(
        'size_ml_matches_label',
        Math.abs((identity?.sizeMl ?? Number.NaN) - expected.sizeMl) <= 1,
        expected.sizeMl,
        identity?.sizeMl ?? null,
      ),
    );
  }

  if (expected.stepsInclude?.length) {
    checks.push(
      check(
        'guidance_steps_include_required_context',
        expected.stepsInclude.every((term) => listIncludesText(steps, term)),
        expected.stepsInclude,
        steps,
      ),
    );
  }

  if (expected.cautionsInclude?.length) {
    checks.push(
      check(
        'cautions_include_required_context',
        expected.cautionsInclude.every((term) =>
          listIncludesText(cautions, term),
        ),
        expected.cautionsInclude,
        cautions,
      ),
    );
  }

  if (expected.applicationMethod) {
    checks.push(
      check(
        'application_method_matches_label',
        guidance?.applicationMethod === expected.applicationMethod,
        expected.applicationMethod,
        guidance?.applicationMethod ?? null,
      ),
    );
  }

  if (expected.quantity) {
    checks.push(
      check(
        'quantity_matches_label',
        guidance?.quantity === expected.quantity,
        expected.quantity,
        guidance?.quantity ?? null,
      ),
    );
  }

  return checks;
}

async function renderCaseImages(
  evaluationCase: CataloguePhotoEvaluationCase,
): Promise<UploadedCatalogueImage[]> {
  return Promise.all(
    evaluationCase.photos.map(async (photo) => {
      const buffer = await sharp(Buffer.from(toProductLabelSvg(photo)))
        .jpeg({ quality: 92 })
        .toBuffer();

      return {
        buffer,
        mimetype: 'image/jpeg',
        originalname: `${photo.name}.jpg`,
        size: buffer.length,
      };
    }),
  );
}

function toProductLabelSvg(input: {
  heading: string;
  lines: string[];
}): string {
  const width = 1400;
  const height = 1800;
  const rows = [
    `<text x="90" y="170" font-size="82" font-weight="700">${escapeXml(
      input.heading,
    )}</text>`,
    ...input.lines.flatMap((line, lineIndex) =>
      wrapText(line, 34).map((part, partIndex) => {
        const y = 320 + lineIndex * 230 + partIndex * 72;
        return `<text x="90" y="${y}" font-size="54">${escapeXml(part)}</text>`;
      }),
    ),
  ];

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="100%" height="100%" fill="#fbfaf7"/>',
    '<rect x="44" y="44" width="1312" height="1712" rx="64" fill="#ffffff" stroke="#1f2933" stroke-width="8"/>',
    '<g font-family="Arial, Helvetica, sans-serif" fill="#111827">',
    ...rows,
    '</g>',
    '</svg>',
  ].join('');
}

function summarizeExtraction(extraction: ExtractionResult) {
  return {
    brand: extraction.data.identity?.brand ?? null,
    name: extraction.data.identity?.name ?? null,
    category: extraction.data.identity?.category ?? null,
    sizeMl: extraction.data.identity?.sizeMl ?? null,
    ingredients: extraction.data.identity?.inciIngredients ?? [],
    steps: extraction.data.guidance?.steps ?? [],
    cautions: extraction.data.guidance?.cautions ?? [],
    applicationMethod: extraction.data.guidance?.applicationMethod ?? null,
    quantity: extraction.data.guidance?.quantity ?? null,
  };
}

function check(
  code: string,
  passed: boolean,
  expected: unknown,
  actual: unknown,
): CataloguePhotoEvaluationCheck {
  return { code, passed, expected, actual };
}

function includesText(value: string | null | undefined, expected: string) {
  return normalize(value).includes(normalize(expected));
}

function listIncludesText(values: string[], expected: string) {
  return values.some((value) => includesText(value, expected));
}

function normalize(value: string | null | undefined) {
  return (value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function readCatalogueModel(): string | null {
  return (
    process.env.CATALOGUE_AI_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    null
  );
}

function configServiceFromEnv(): ConfigService {
  return {
    get: <T = string>(key: string): T | undefined =>
      readConfigValue(key) as T | undefined,
    getOrThrow: <T = string>(key: string): T => {
      const value = readConfigValue(key);
      if (value === undefined || value === '') {
        throw new Error(`Missing required config value: ${key}`);
      }
      return value as T;
    },
  } as ConfigService;
}

function readConfigValue(key: string): string | number | undefined {
  const value = process.env[key];
  if (
    key === 'PRODUCT_EXTRACTION_IMAGE_MAX_DIMENSION' ||
    key === 'PRODUCT_EXTRACTION_IMAGE_WEBP_QUALITY'
  ) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return value;
}

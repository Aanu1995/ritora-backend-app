import {
  ApplicationMethod,
  LookupWarningCode,
  ProductCategory,
  Quantity,
  type LookupEvidence,
} from '../shelf/shelf.types';
import {
  extractEvidence,
  sanitizeApplicationMethod,
  sanitizeConciseDescription,
  sanitizeConciseList,
  sanitizeIngredientList,
  sanitizeOptionalString,
  sanitizeOptionalUrl,
  sanitizeProductCategory,
  sanitizeQuantity,
  sanitizeSizeMl,
  sanitizeWaitMinutes,
  toWebsiteUrl,
} from './openai-extraction-sanitizers';
import {
  sanitizeBenefitList,
  sanitizeSuitedForList,
} from './product-claim-sanitizers';

export type ExtractedGroundedData = {
  identity?: {
    brand?: string;
    name?: string;
    category?: ProductCategory;
    sizeMl?: number | null;
    description?: string | null;
    benefits?: string[];
    suitedFor?: string[];
    inciIngredients?: string[];
  };
  guidance?: {
    applicationMethod?: ApplicationMethod | null;
    quantity?: Quantity | null;
    steps?: string[];
    cautions?: string[];
    waitMinutes?: number | null;
  };
  manufacturer?: {
    supportEmail?: string | null;
    countryOfOrigin?: string | null;
    countryOfManufacture?: string | null;
    parentCompany?: string | null;
    productUrl?: string | null;
    websiteUrl?: string | null;
  };
};

export type ExtractionResult = {
  data: ExtractedGroundedData;
  warnings: LookupWarningCode[];
  evidence: LookupEvidence[];
};

export type OpenAiResponsePayload = {
  output_text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
    action?: {
      sources?: Array<{
        type?: string;
        url?: string;
      }>;
    };
  }>;
};

export function extractJsonObject(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const firstBrace = fenced.indexOf('{');
  const lastBrace = fenced.lastIndexOf('}');

  return firstBrace >= 0 && lastBrace > firstBrace
    ? fenced.slice(firstBrace, lastBrace + 1)
    : fenced;
}

export function extractOutputText(
  payload: OpenAiResponsePayload,
): string | null {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type !== 'output_text') {
        continue;
      }

      if (typeof content.text === 'string' && content.text.trim()) {
        return content.text.trim();
      }
    }
  }

  return null;
}

export function toExtractionResult(
  parsed: ExtractedGroundedData,
  payload: OpenAiResponsePayload,
): ExtractionResult | null {
  const identity = parsed.identity ?? {};
  const guidance = parsed.guidance ?? {};
  const manufacturer = parsed.manufacturer ?? {};
  const evidence = extractEvidence(payload);
  const fallbackEvidenceUrl = evidence[0]?.url ?? null;

  const productUrl =
    sanitizeOptionalUrl(manufacturer.productUrl) ?? fallbackEvidenceUrl;
  const steps = sanitizeConciseList(guidance.steps, {
    maxItems: 5,
    maxChars: 80,
    maxWords: 12,
  });
  const cautions = sanitizeConciseList(guidance.cautions, {
    maxItems: 5,
    maxChars: 80,
    maxWords: 12,
  });
  const guidanceText = [
    sanitizeOptionalString(guidance.applicationMethod),
    sanitizeOptionalString(guidance.quantity),
    ...steps,
    ...cautions,
  ].join(' ');
  const applicationMethod =
    sanitizeApplicationMethod(guidance.applicationMethod) ??
    sanitizeApplicationMethod(guidanceText);
  const quantity =
    sanitizeQuantity(guidance.quantity) ?? sanitizeQuantity(guidanceText);

  const sanitized: ExtractedGroundedData = {
    identity: {
      ...optional('brand', sanitizeOptionalString(identity.brand)),
      ...optional('name', sanitizeOptionalString(identity.name)),
      ...optional('category', sanitizeProductCategory(identity.category)),
      ...optional('sizeMl', sanitizeSizeMl(identity.sizeMl)),
      ...optional(
        'description',
        sanitizeConciseDescription(identity.description),
      ),
      benefits: sanitizeBenefitList(identity.benefits),
      suitedFor: sanitizeSuitedForList(identity.suitedFor),
      inciIngredients: sanitizeIngredientList(identity.inciIngredients),
    },
    guidance: {
      ...optional('applicationMethod', applicationMethod),
      ...optional('quantity', quantity),
      steps,
      cautions,
      ...optional('waitMinutes', sanitizeWaitMinutes(guidance.waitMinutes)),
    },
    manufacturer: {
      ...optional(
        'supportEmail',
        sanitizeOptionalString(manufacturer.supportEmail),
      ),
      ...optional(
        'countryOfOrigin',
        sanitizeOptionalString(manufacturer.countryOfOrigin),
      ),
      ...optional(
        'countryOfManufacture',
        sanitizeOptionalString(manufacturer.countryOfManufacture),
      ),
      ...optional(
        'parentCompany',
        sanitizeOptionalString(manufacturer.parentCompany),
      ),
      ...optional('productUrl', productUrl),
      ...optional(
        'websiteUrl',
        toWebsiteUrl(productUrl, sanitizeOptionalUrl(manufacturer.websiteUrl)),
      ),
    },
  };

  if (!usesAnyField(sanitized)) {
    return null;
  }

  return {
    data: sanitized,
    warnings: extractionWarnings(sanitized),
    evidence,
  };
}

function optional<T>(
  key: string,
  value: T | null | undefined,
): Record<string, T> {
  return value === null || value === undefined ? {} : { [key]: value };
}

function usesAnyField(data: ExtractedGroundedData): boolean {
  return (
    Boolean(data.identity?.brand) ||
    Boolean(data.identity?.name) ||
    Boolean(data.identity?.category) ||
    typeof data.identity?.sizeMl === 'number' ||
    Boolean(data.identity?.description) ||
    Boolean(data.identity?.benefits?.length) ||
    Boolean(data.identity?.suitedFor?.length) ||
    Boolean(data.identity?.inciIngredients?.length) ||
    Boolean(data.guidance?.applicationMethod) ||
    Boolean(data.guidance?.quantity) ||
    Boolean(data.guidance?.steps?.length) ||
    Boolean(data.guidance?.cautions?.length) ||
    typeof data.guidance?.waitMinutes === 'number' ||
    Boolean(data.manufacturer?.supportEmail) ||
    Boolean(data.manufacturer?.countryOfOrigin) ||
    Boolean(data.manufacturer?.countryOfManufacture) ||
    Boolean(data.manufacturer?.parentCompany) ||
    Boolean(data.manufacturer?.productUrl) ||
    Boolean(data.manufacturer?.websiteUrl)
  );
}

function extractionWarnings(data: ExtractedGroundedData): LookupWarningCode[] {
  const warnings = [LookupWarningCode.AiNormalized];

  if (
    data.guidance?.applicationMethod ||
    data.guidance?.quantity ||
    data.guidance?.steps?.length ||
    data.guidance?.cautions?.length
  ) {
    warnings.push(LookupWarningCode.GuidanceUnverified);
  }

  if (data.identity?.inciIngredients?.length) {
    warnings.push(LookupWarningCode.IngredientsUnverified);
  }

  return warnings;
}

import {
  APPLICATION_METHOD_VALUES,
  PRODUCT_CATEGORY_VALUES,
  QUANTITY_VALUES,
} from '../shelf/shelf.constants';
import type { CataloguePhotoExtractionInput } from './catalogue-photo.types';
import type {
  OfficialPageExtraction,
  ResolvedProductDraft,
} from './product-discovery.types';

const CATEGORY_DECISION_RULES = [
  'Category rules:',
  '- Choose the primary product role, not texture, format, ingredient theme, or marketing benefit.',
  '- cleanser: face/body wash, cleanser, cleansing oil/balm/foam/gel/milk/cream, micellar water.',
  '- toner: toner, tonic, or mist used after cleansing before treatment steps.',
  '- essence: essence or treatment essence.',
  '- serum: serum, ampoule, booster, or concentrate.',
  '- sun-protection: SPF, sunscreen, sun protection, UVA/UVB, broad spectrum, PA++, sun fluid/cream/gel/stick.',
  '- mask: wash-off mask, sheet mask, overnight mask, sleeping pack.',
  '- exfoliant: exfoliant/exfoliator, peel, peeling solution, AHA/BHA/PHA exfoliating product.',
  '- eye-care: eye cream, eye serum, eye gel, or eye treatment.',
  '- lip-care: lip balm, lip mask, lip treatment, lip sleeping mask.',
  '- treatment: spot/acne/blemish treatment or treatment product that is not more specifically a serum, mask, exfoliant, eye-care, lip-care, cleanser, or sun-protection.',
  '- moisturizer: moisturiser/moisturizer, cream, lotion, gel-cream, balm, or emulsion when hydration/barrier support is the primary role.',
  '- other: use only when no category is supported clearly.',
  '- Prefer more specific roles over texture words. For example, SPF gel-cream is sun-protection, eye serum is eye-care, cleansing balm is cleanser, and lip sleeping mask is lip-care.',
];
const GUIDANCE_DECISION_RULES = [
  'Guidance method and quantity rules:',
  '- Return guidance.applicationMethod only when usage text supports it. Use one of the allowed enum values exactly.',
  '- cotton-pad: cotton pad, cotton round, cotton ball, or saturate a pad.',
  '- fingertips: fingertips, fingers, hands, palms, massage, pat, smooth, or apply directly by hand.',
  '- spray: spray, spritz, mist.',
  '- dropper: dropper or pipette.',
  '- brush: brush.',
  '- spatula: spatula or scoop.',
  '- other: use only when the label clearly gives a method that does not match the known methods.',
  '- Return guidance.quantity only when usage text supports it. Use one of the allowed enum values exactly.',
  '- one-drop: one drop or single drop.',
  '- two-to-three-drops: two to three drops, 2-3 drops, or a few drops.',
  '- pea-size: pea-sized amount.',
  '- pump-one: one pump.',
  '- pump-two: two pumps.',
  '- coin-size: coin-sized amount.',
  '- generous: generous amount, liberal amount, or generous layer.',
  '- as-needed: as needed.',
];

const CLAIM_DECISION_RULES = [
  'Benefits and suited-for rules:',
  '- identity.benefits must contain product effects or claims only, such as hydrating, calming, anti-aging, pore-minimizing, brightening, firming, oil control, exfoliating, smoothing, barrier support, or sun protection.',
  '- identity.suitedFor must contain skin types, skin states, concerns, or audiences only, such as all skin types, dry skin, oily skin, combination skin, sensitive skin, normal skin, acne-prone skin, blemish-prone skin, dehydrated skin, stressed skin, mature skin, dull skin, rough skin, uneven tone, redness-prone skin, or visible pores.',
  '- If the label has a "How does it help?", "Benefits", "Skin concerns", or checkbox-style claims section, put those visible options in identity.benefits.',
  '- If the label has a "Skin type?", "Suitable for", "Best for", or "Ideal for" section, put those visible options in identity.suitedFor.',
  '- Do not put skin types in benefits. Do not put product effects in suitedFor.',
  '- Keep each value as a short standalone phrase. Normalize obvious spelling variants only, such as anti-ageing to anti-aging and pore minimising to pore-minimizing.',
];

const FIELD_DECISION_RULES = [
  'Field extraction source rules:',
  '- brand: use the logo, brand mark, manufacturer brand, or official page brand. Preserve brand capitalization and do not translate.',
  '- name: use the front-label product name plus variant, strength, SPF rating, or product line when visible. Exclude size, barcode, directions, and claims unless they are part of the printed name.',
  '- category: infer only the primary product role from product name, function, SPF/drug facts, usage, and label headings. Return one allowed enum value.',
  '- sizeMl: use net contents, volume, or metric quantity. Convert only clear ml values; do not convert ounces when ml is absent.',
  '- description: use product-specific description copy. Translate to concise English when the source text is not English.',
  '- inciIngredients: use only a complete ingredient list. Preserve INCI ingredient names, Latin botanical names, punctuation inside names, and source order. Do not translate INCI names.',
  '- guidance.steps: use directions/how-to-use text. Translate to concise English, preserving timing such as morning, evening, rinse, leave on, or reapply.',
  '- guidance.applicationMethod and guidance.quantity: infer only from explicit usage words, not from packaging type.',
  '- guidance.cautions: use warning, caution, precaution, allergy, sun exposure, eye-contact, external-use, and child-safety text. Translate to concise English.',
  '- manufacturer fields: use printed company, responsible person, distributor, country, email, website, or official page metadata. Do not infer missing company facts.',
];

const LANGUAGE_DECISION_RULES = [
  'Language handling rules:',
  '- Labels may be in English, Swedish, French, Spanish, German, Italian, Portuguese, Korean, Japanese, Chinese, Arabic, or mixed languages.',
  '- Translate user-facing values to English for description, benefits, suitedFor, guidance.steps, and guidance.cautions.',
  '- Preserve brand names, product names, INCI ingredient names, email addresses, URLs, barcode values, and legal company names as printed.',
  '- Use translated field headings as evidence, including accented variants: ingredients/ingredienser/ingredientes/ingredients/inhaltsstoffe/ingredienti, how to use/anvandning/modo de uso/mode d emploi/anwendung, warning/varning/advertencia/avertissement/warnhinweis, suitable for/passar for/apto para/convient aux/geeignet fur.',
  '- If a translation is uncertain, return null or an empty array for that field instead of guessing.',
];

const RESULT_SHAPE = {
  identity: {
    brand: 'string|null',
    name: 'string|null',
    category: PRODUCT_CATEGORY_VALUES,
    description: 'string|null',
    benefits: ['string'],
    suitedFor: ['string'],
    inciIngredients: ['string'],
  },
  guidance: {
    applicationMethod: APPLICATION_METHOD_VALUES,
    quantity: QUANTITY_VALUES,
    steps: ['string'],
    cautions: ['string'],
    waitMinutes: 'number|null',
  },
  manufacturer: {
    supportEmail: 'string|null',
    countryOfOrigin: 'string|null',
    countryOfManufacture: 'string|null',
    parentCompany: 'string|null',
    productUrl: 'string|null',
    websiteUrl: 'string|null',
  },
};

export function buildOfficialPageExtractionPrompt(
  extraction: OfficialPageExtraction,
): string {
  return [
    'You normalize skincare product data into JSON for a cosmetics inventory app.',
    'Only use facts explicitly present in the provided structured data, meta tags, or text excerpt.',
    'Treat the provided page content as the only source of truth.',
    'Every returned field must be cleaned so it contains only product-specific data for the exact item.',
    'Exclude navigation, cookie banners, legal text, store locators, retailer lists, related products, footer links, and page chrome from every field.',
    'Do not infer unsupported facts. Do not guess parent company, support email, or country information.',
    ...LANGUAGE_DECISION_RULES,
    ...FIELD_DECISION_RULES,
    ...CATEGORY_DECISION_RULES,
    'Descriptions must be factual, one sentence, concise, and based only on the actual product description.',
    ...CLAIM_DECISION_RULES,
    'Benefits and suited-for values must be for this exact product, not general brand copy or related items.',
    'Guidance and cautions must be brief direct phrases copied or tightly paraphrased from the page.',
    ...GUIDANCE_DECISION_RULES,
    'For identity.inciIngredients, extract the complete ingredient list only.',
    'If the page shows hero ingredients plus a longer full INCI list, return only the full INCI list.',
    'Exclude claims, directions, warnings, headings, sizes, retailer names, links, and legal text from identity.inciIngredients.',
    'Return each ingredient as its own array item in source order and keep the list complete through the last ingredient shown.',
    'Return JSON only with this shape:',
    JSON.stringify(RESULT_SHAPE, null, 2),
    'Use empty arrays or null when absent.',
    ...formattingRules(),
    'Context:',
    JSON.stringify(
      {
        structured: extraction.rawSource,
        textExcerpt: extraction.textExcerpt,
      },
      null,
      2,
    ),
  ].join('\n');
}

export function buildPhotoExtractionPrompt(
  sourceImageCount: number,
  assetCount: number,
): string {
  return [
    `You extract skincare product facts from ${sourceImageCount} user-provided source photos of the same product into JSON for a cosmetics inventory app.`,
    `You may receive ${assetCount} image assets because some source photos include a full overview plus a text-enhanced crop. Treat variants from the same source photo as duplicate views, not separate products.`,
    'One source photo is the selected product photo that will be saved with the item.',
    'The remaining source photos are label photos and may be overlapping captures from curved, cylindrical, spherical, wrapped, cut-off, blurry, or low-resolution packaging.',
    'Each image has already been oriented. Some variants are high-resolution, cropped, grayscale, sharpened, or contrast-normalized to help read label text.',
    'Use only what is visible in the provided photos. Do not use outside knowledge or web search.',
    'Ignore any remaining background scene text that is not printed on the product packaging itself.',
    'If the photos show multiple products, conflicting products, unreadable text, or do not clearly match, return empty arrays and null values for any ambiguous field instead of guessing.',
    'Extract as much supported information as possible. Do not fail the whole extraction because ingredients, manufacturer details, or one label side is missing.',
    'Use the selected product photo and its variants as the primary source for brand, product name, variant, category, size, and front-label claims.',
    ...LANGUAGE_DECISION_RULES,
    ...FIELD_DECISION_RULES,
    ...CATEGORY_DECISION_RULES,
    'Use all photos together to reconstruct the complete INCI ingredient list, description, benefits, suited-for text, and usage/caution text.',
    'For cylindrical or wrapped packaging, combine partial side-label photos like a panorama: stitch overlapping text fragments mentally, dedupe repeated fragments, and preserve ingredient order when the packaging supports it.',
    'When text is blurry or cut off, use the legible fragments to fill independent fields such as brand, name, category, size, benefits, suited-for skin type, method, quantity, steps, or cautions.',
    'If the full ingredient list is not visible across the photo set, return an empty ingredients array instead of a partial or guessed list.',
    'Clean every field so it contains only product-specific data for the exact item shown.',
    'Exclude stickers, prices, retailer overlays, navigation-like text, icons without text meaning, legal footers, distributor blocks, barcode numbers, lot codes, website chrome, and unrelated packaging copy.',
    'For identity.inciIngredients, extract the complete ingredient list only.',
    'If the packaging shows hero ingredients plus a longer full INCI list, return only the full INCI list in source order.',
    'Never return claims, headings, directions, warnings, sizes, store names, or legal text in identity.inciIngredients.',
    'Descriptions must be factual, one sentence, concise, and based only on the product text visible in the photos.',
    ...CLAIM_DECISION_RULES,
    'Benefits and suited-for values must be for this exact product, not marketing slogans or inferred effects.',
    'Guidance steps and cautions must be brief direct phrases copied or tightly paraphrased from the packaging.',
    ...GUIDANCE_DECISION_RULES,
    'Manufacturer fields should stay null unless they are explicitly printed on the packaging.',
    'Return JSON only with this shape:',
    JSON.stringify(
      {
        ...RESULT_SHAPE,
        identity: { ...RESULT_SHAPE.identity, sizeMl: 'number|null' },
      },
      null,
      2,
    ),
    'Use empty arrays or null when a field cannot be supported cleanly.',
    ...formattingRules(),
  ].join('\n');
}

export function buildDiscoveryPrompt(draft: ResolvedProductDraft): string {
  return [
    'You help a skincare inventory app complete missing product details.',
    'Use web search to find the official manufacturer product page first.',
    'If needed, also use the official support/contact page and official company/about page for parent company or support details.',
    'Only fill fields that are currently missing or empty.',
    'Known product data is authoritative. Never rewrite or replace a non-empty known field.',
    ...CATEGORY_DECISION_RULES,
    'Prefer official brand/manufacturer pages for productUrl, supportEmail, benefits, suitedFor, cautions, parentCompany, and manufacturing details.',
    'Use community sources like Open Beauty Facts only to support barcode, brand, name, size, image, ingredients, or generic description when official pages do not provide them.',
    'Clean every returned field by excluding navigation, cookie banners, legal text, retailer blocks, related products, and footer content.',
    'Do not invent skincare instructions, cautions, support emails, countries, or parent companies.',
    ...LANGUAGE_DECISION_RULES,
    ...FIELD_DECISION_RULES,
    'For identity.inciIngredients, only return the complete INCI ingredient list as raw ingredient names in separate array items.',
    'If a source shows hero ingredients and a longer full INCI list, return only the full INCI list in source order.',
    'Never return sentences, summaries, navigation text, policies, usage directions, claims, store lists, or marketing copy in identity.inciIngredients.',
    'If a clean ingredient list cannot be verified, return an empty array for identity.inciIngredients.',
    'Descriptions must be factual, one sentence, concise, and based only on the actual product description.',
    ...CLAIM_DECISION_RULES,
    ...GUIDANCE_DECISION_RULES,
    `Missing fields to complete: ${listMissingFields(draft).join(', ') || 'none'}.`,
    'Return JSON only with this shape:',
    JSON.stringify(RESULT_SHAPE, null, 2),
    'Use empty arrays or null when a field cannot be supported.',
    ...formattingRules(),
    'Known product data:',
    JSON.stringify(toKnownProductData(draft), null, 2),
  ].join('\n');
}

export function buildOfficialDiscoveryPrompt(input: {
  query: string;
  brand?: string;
  name?: string;
  barcode?: string;
}): string {
  return [
    'You help a skincare inventory app find official manufacturer product pages.',
    'Use web search to find the brand or manufacturer official product page for the exact product.',
    'Only return URLs on the official brand or manufacturer site.',
    'Never return retailers, marketplaces, distributors, databases, review sites, blogs, or social media.',
    'Return up to 3 candidate product page URLs.',
    'Return JSON only with this shape:',
    JSON.stringify(
      { productUrls: ['https://official-brand-site.com/product-page'] },
      null,
      2,
    ),
    'Use an empty array if no official product page can be found confidently.',
    'Known clues:',
    JSON.stringify(input, null, 2),
  ].join('\n');
}

export function describePhotoVariant(
  variant: CataloguePhotoExtractionInput['images'][number]['variant'],
): string {
  return variant === 'text-enhanced' ? 'text-enhanced crop' : 'full overview';
}

function listMissingFields(draft: ResolvedProductDraft): string[] {
  const missingFields: string[] = [];

  if (!draft.identity.brand) missingFields.push('identity.brand');
  if (!draft.identity.name) missingFields.push('identity.name');
  if (!draft.identity.description) missingFields.push('identity.description');
  if (!draft.identity.benefits?.length) missingFields.push('identity.benefits');
  if (!draft.identity.suitedFor?.length)
    missingFields.push('identity.suitedFor');
  if (!draft.identity.inciIngredients?.length) {
    missingFields.push('identity.inciIngredients');
  }
  if (!draft.guidance.steps?.length) missingFields.push('guidance.steps');
  if (!draft.guidance.applicationMethod) {
    missingFields.push('guidance.applicationMethod');
  }
  if (!draft.guidance.quantity) missingFields.push('guidance.quantity');
  if (!draft.guidance.cautions?.length) missingFields.push('guidance.cautions');
  if (draft.guidance.waitMinutes === undefined) {
    missingFields.push('guidance.waitMinutes');
  }
  if (!draft.manufacturer.supportEmail) {
    missingFields.push('manufacturer.supportEmail');
  }
  if (!draft.manufacturer.countryOfOrigin) {
    missingFields.push('manufacturer.countryOfOrigin');
  }
  if (!draft.manufacturer.countryOfManufacture) {
    missingFields.push('manufacturer.countryOfManufacture');
  }
  if (!draft.manufacturer.parentCompany) {
    missingFields.push('manufacturer.parentCompany');
  }
  if (!draft.manufacturer.productUrl)
    missingFields.push('manufacturer.productUrl');
  if (!draft.manufacturer.websiteUrl)
    missingFields.push('manufacturer.websiteUrl');

  return missingFields;
}

function formattingRules(): string[] {
  return [
    'Formatting rules:',
    '- description: maximum 20 words',
    '- benefits: 1 to 6 short phrases, maximum 5 words each',
    '- suitedFor: 1 to 6 short phrases, maximum 5 words each',
    '- steps and cautions: short imperative phrases, maximum 10 words each',
  ];
}

function toKnownProductData(draft: ResolvedProductDraft) {
  return {
    brand: draft.identity.brand ?? null,
    name: draft.identity.name ?? null,
    barcode: draft.identity.barcode ?? null,
    category: draft.identity.category ?? null,
    description: draft.identity.description ?? null,
    benefits: draft.identity.benefits ?? [],
    suitedFor: draft.identity.suitedFor ?? [],
    ingredients: draft.identity.inciIngredients ?? [],
    applicationMethod: draft.guidance.applicationMethod ?? null,
    quantity: draft.guidance.quantity ?? null,
    cautions: draft.guidance.cautions ?? [],
    steps: draft.guidance.steps ?? [],
    productUrl: draft.manufacturer.productUrl ?? null,
    supportEmail: draft.manufacturer.supportEmail ?? null,
    parentCompany: draft.manufacturer.parentCompany ?? null,
    countryOfManufacture: draft.manufacturer.countryOfManufacture ?? null,
    rawSource: draft.rawSource,
  };
}

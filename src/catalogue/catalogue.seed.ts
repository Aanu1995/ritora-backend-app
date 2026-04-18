import {
  ApplicationMethod,
  DataProvenance,
  ProductCategory,
  Quantity,
  type ApplicationGuidance,
  type CatalogueIdentity,
  type ManufacturerInfo,
  type ResolvedLookup,
} from '../shelf/shelf.types';

export type CatalogueSeedProduct = {
  identity: CatalogueIdentity;
  guidance: ApplicationGuidance;
  manufacturer: ManufacturerInfo;
  provenance: DataProvenance;
};

type CatalogueSeedTemplate = {
  brand: string;
  name: string;
  category: ProductCategory;
  barcode: string | null;
  sizeMl: number | null;
  description: string | null;
  benefits: string[];
  suitedFor: string[];
  inciIngredients: string[];
  parentCompany: string | null;
  countryOfOrigin: string | null;
  countryOfManufacture: string | null;
  supportEmail: string | null;
  productUrl: string | null;
  websiteUrl: string | null;
};

const NOW_ISO = '2026-04-18T00:00:00.000Z';
const VARIANT_SUFFIXES = ['', ' Light', ' Rich', ' Mini'];

function buildGuidance(category: ProductCategory): ApplicationGuidance {
  switch (category) {
    case ProductCategory.Cleanser:
      return {
        applicationMethod: ApplicationMethod.Fingertips,
        quantity: Quantity.PeaSize,
        steps: [
          'Massage onto damp skin with gentle circular motions.',
          'Rinse with lukewarm water.',
          'Pat dry before the next step.',
        ],
        cautions: ['Avoid direct contact with the eyes.'],
        waitMinutes: null,
      };
    case ProductCategory.Toner:
      return {
        applicationMethod: ApplicationMethod.CottonPad,
        quantity: Quantity.AsNeeded,
        steps: [
          'Saturate a cotton pad or palms with the toner.',
          'Sweep or press gently across the face and neck.',
          'Allow it to absorb before the next step.',
        ],
        cautions: ['Avoid the eye area.'],
        waitMinutes: null,
      };
    case ProductCategory.SunProtection:
      return {
        applicationMethod: ApplicationMethod.Fingertips,
        quantity: Quantity.CoinSize,
        steps: [
          'Apply as the last step of your morning routine.',
          'Spread generously across the face and neck.',
          'Reapply every two hours when in direct sun.',
        ],
        cautions: ['Avoid contact with the eyes.'],
        waitMinutes: null,
      };
    case ProductCategory.Exfoliant:
      return {
        applicationMethod: ApplicationMethod.CottonPad,
        quantity: Quantity.AsNeeded,
        steps: [
          'Apply a thin layer after cleansing.',
          'Leave on according to label instructions.',
          'Follow with a calming moisturiser.',
        ],
        cautions: [
          'Do not combine with retinoids on the same night.',
          'Use SPF during the day.',
        ],
        waitMinutes: 10,
      };
    default:
      return {
        applicationMethod: ApplicationMethod.Fingertips,
        quantity: Quantity.TwoToThreeDrops,
        steps: [
          'Apply to clean skin.',
          'Spread evenly across the face and neck.',
          'Follow with moisturiser if needed.',
        ],
        cautions: ['Avoid the eye area.'],
        waitMinutes: null,
      };
  }
}

function buildProduct(
  template: CatalogueSeedTemplate,
  suffix: string,
): CatalogueSeedProduct {
  const miniVariant = suffix === ' Mini';
  const imageUrls: string[] = [];

  return {
    identity: {
      brand: template.brand,
      name: `${template.name}${suffix}`,
      category: template.category,
      barcode: suffix === '' ? template.barcode : null,
      imageUrls,
      sizeMl:
        template.sizeMl === null
          ? null
          : miniVariant
            ? Math.max(10, Math.round(template.sizeMl / 2))
            : template.sizeMl,
      description:
        template.description === null
          ? null
          : suffix === ''
            ? template.description
            : `${template.description} ${suffix.trim()} edition.`,
      benefits: template.benefits,
      suitedFor: template.suitedFor,
      inciIngredients: template.inciIngredients,
      inciLastConfirmedAt: NOW_ISO,
    },
    guidance: buildGuidance(template.category),
    manufacturer: {
      brand: template.brand,
      parentCompany: template.parentCompany,
      countryOfOrigin: template.countryOfOrigin,
      countryOfManufacture: template.countryOfManufacture,
      supportEmail: template.supportEmail,
      productUrl: suffix === '' ? template.productUrl : null,
      websiteUrl: template.websiteUrl,
    },
    provenance: DataProvenance.Catalogue,
  };
}

const TEMPLATES: CatalogueSeedTemplate[] = [
  {
    brand: 'CeraVe',
    name: 'Resurfacing Retinol Serum',
    category: ProductCategory.Serum,
    barcode: '3337875597227',
    sizeMl: 30,
    description:
      'A gentle nightly retinol serum that supports smoother texture and more even tone over time.',
    benefits: ['smoothing', 'clarifying', 'hydrating'],
    suitedFor: ['dry', 'combination', 'sensitive'],
    inciIngredients: [
      'Aqua',
      'Glycerin',
      'Niacinamide',
      'Retinol',
      'Ceramide NP',
      'Licorice Root Extract',
    ],
    parentCompany: "L'Oréal",
    countryOfOrigin: 'US',
    countryOfManufacture: 'US',
    supportEmail: 'support@cerave.com',
    productUrl:
      'https://www.cerave.com/skincare/serums/resurfacing-retinol-serum',
    websiteUrl: 'https://www.cerave.com',
  },
  {
    brand: 'La Roche-Posay',
    name: 'Toleriane Hydrating Cleanser',
    category: ProductCategory.Cleanser,
    barcode: '3337875545754',
    sizeMl: 200,
    description:
      'A cream cleanser that removes impurities while keeping the skin barrier comfortable.',
    benefits: ['hydrating', 'non-stripping'],
    suitedFor: ['normal', 'dry', 'sensitive'],
    inciIngredients: [
      'Aqua',
      'Glycerin',
      'Niacinamide',
      'Ceramide NP',
      'Panthenol',
    ],
    parentCompany: "L'Oréal",
    countryOfOrigin: 'FR',
    countryOfManufacture: 'FR',
    supportEmail: 'contact@laroche-posay.com',
    productUrl: null,
    websiteUrl: 'https://www.laroche-posay.com',
  },
  {
    brand: 'Beauty of Joseon',
    name: 'Relief Sun: Rice + Probiotics SPF 50+',
    category: ProductCategory.SunProtection,
    barcode: '8809738320006',
    sizeMl: 50,
    description:
      'A lightweight sunscreen with a dewy finish and no white cast.',
    benefits: ['broad-spectrum', 'hydrating'],
    suitedFor: ['normal', 'combination', 'dry', 'oily'],
    inciIngredients: [
      'Aqua',
      'Ethylhexyl Methoxycinnamate',
      'Ethylhexyl Salicylate',
      'Oryza Sativa Extract',
      'Glycerin',
    ],
    parentCompany: null,
    countryOfOrigin: 'KR',
    countryOfManufacture: 'KR',
    supportEmail: null,
    productUrl: 'https://beautyofjoseon.com/products/relief-sun',
    websiteUrl: 'https://beautyofjoseon.com',
  },
  {
    brand: 'Cetaphil',
    name: 'Moisturising Cream',
    category: ProductCategory.Moisturizer,
    barcode: '302993927501',
    sizeMl: 450,
    description:
      'A rich cream that helps relieve dry skin and support the barrier.',
    benefits: ['rich', 'hydrating'],
    suitedFor: ['dry', 'sensitive'],
    inciIngredients: [
      'Aqua',
      'Petrolatum',
      'Glycerin',
      'Cetyl Alcohol',
      'Stearyl Alcohol',
    ],
    parentCompany: 'Galderma',
    countryOfOrigin: 'CA',
    countryOfManufacture: 'CA',
    supportEmail: null,
    productUrl: null,
    websiteUrl: 'https://www.cetaphil.com',
  },
  {
    brand: 'Pyunkang Yul',
    name: 'Essence Toner',
    category: ProductCategory.Toner,
    barcode: '8809486430552',
    sizeMl: 200,
    description:
      'A minimalist hydrating toner that layers well and feels calming on the skin.',
    benefits: ['hydrating', 'calming'],
    suitedFor: ['normal', 'dry', 'sensitive'],
    inciIngredients: [
      'Astragalus Membranaceus Root Extract',
      'Aqua',
      'Glycerin',
    ],
    parentCompany: null,
    countryOfOrigin: 'KR',
    countryOfManufacture: 'KR',
    supportEmail: null,
    productUrl: null,
    websiteUrl: 'https://pyunkangyul.com',
  },
  {
    brand: 'COSRX',
    name: 'Advanced Snail 96 Mucin Power Essence',
    category: ProductCategory.Essence,
    barcode: '8809416470405',
    sizeMl: 100,
    description:
      'A lightweight essence that supports hydration and a smoother barrier.',
    benefits: ['hydrating', 'plumping'],
    suitedFor: ['normal', 'dry', 'sensitive'],
    inciIngredients: ['Snail Secretion Filtrate', 'Betaine', 'Butylene Glycol'],
    parentCompany: null,
    countryOfOrigin: 'KR',
    countryOfManufacture: 'KR',
    supportEmail: null,
    productUrl: null,
    websiteUrl: 'https://www.cosrx.com',
  },
  {
    brand: 'The Ordinary',
    name: 'Niacinamide 10% + Zinc 1%',
    category: ProductCategory.Serum,
    barcode: '769915190533',
    sizeMl: 30,
    description:
      'A water-based serum that helps with visible oiliness and uneven texture.',
    benefits: ['clarifying', 'balancing'],
    suitedFor: ['oily', 'combination', 'acne-prone'],
    inciIngredients: ['Aqua', 'Niacinamide', 'Zinc PCA', 'Tamarindus Indica'],
    parentCompany: 'DECIEM',
    countryOfOrigin: 'CA',
    countryOfManufacture: 'CA',
    supportEmail: null,
    productUrl: null,
    websiteUrl: 'https://theordinary.com',
  },
  {
    brand: "Paula's Choice",
    name: 'Skin Perfecting 2% BHA Liquid Exfoliant',
    category: ProductCategory.Exfoliant,
    barcode: '655439019011',
    sizeMl: 118,
    description:
      'A leave-on exfoliant that helps unclog pores and smooth rough texture.',
    benefits: ['exfoliating', 'clarifying'],
    suitedFor: ['oily', 'combination', 'acne-prone'],
    inciIngredients: [
      'Aqua',
      'Methylpropanediol',
      'Salicylic Acid',
      'Camellia Oleifera Leaf Extract',
    ],
    parentCompany: null,
    countryOfOrigin: 'US',
    countryOfManufacture: 'US',
    supportEmail: null,
    productUrl: null,
    websiteUrl: 'https://www.paulaschoice.com',
  },
  {
    brand: "Kiehl's",
    name: 'Ultra Facial Cream',
    category: ProductCategory.Moisturizer,
    barcode: '3605970359034',
    sizeMl: 50,
    description: 'A daily cream that supports hydration without feeling heavy.',
    benefits: ['hydrating', 'barrier-supporting'],
    suitedFor: ['normal', 'dry', 'combination'],
    inciIngredients: ['Aqua', 'Squalane', 'Glycerin', 'Glacial Glycoprotein'],
    parentCompany: "L'Oréal",
    countryOfOrigin: 'US',
    countryOfManufacture: 'US',
    supportEmail: null,
    productUrl: null,
    websiteUrl: 'https://www.kiehls.com',
  },
  {
    brand: 'Glossier',
    name: 'Milky Jelly Cleanser',
    category: ProductCategory.Cleanser,
    barcode: '810006130010',
    sizeMl: 177,
    description:
      'A cushiony cleanser that removes daily buildup while keeping skin soft.',
    benefits: ['gentle', 'comforting'],
    suitedFor: ['normal', 'dry', 'sensitive'],
    inciIngredients: ['Aqua', 'Poloxamer 184', 'Glycerin', 'Pro-Vitamin B5'],
    parentCompany: null,
    countryOfOrigin: 'US',
    countryOfManufacture: 'US',
    supportEmail: null,
    productUrl: null,
    websiteUrl: 'https://www.glossier.com',
  },
];

export const CATALOGUE_SEED_PRODUCTS: CatalogueSeedProduct[] =
  TEMPLATES.flatMap((template) =>
    VARIANT_SUFFIXES.map((suffix) => buildProduct(template, suffix)),
  );

export const BARCODE_LOOKUP_SEED: Record<string, ResolvedLookup> =
  Object.fromEntries(
    CATALOGUE_SEED_PRODUCTS.filter((product) => product.identity.barcode).map(
      (product) => [
        product.identity.barcode as string,
        {
          identity: product.identity,
          manufacturer: product.manufacturer,
          provenance: DataProvenance.BarcodeLookup,
        },
      ],
    ),
  );

export const URL_LOOKUP_SEED: Record<string, ResolvedLookup> =
  Object.fromEntries(
    CATALOGUE_SEED_PRODUCTS.filter(
      (product) => product.manufacturer.productUrl,
    ).map((product) => [
      product.manufacturer.productUrl as string,
      {
        identity: product.identity,
        manufacturer: product.manufacturer,
        provenance: DataProvenance.UrlFetch,
      },
    ]),
  );

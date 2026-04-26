import { normalizeSearchValue } from './product-discovery.utils';

type BrandHostEntry = {
  brand: string;
  aliases?: string[];
  hostPatterns: string[];
};

type IndexedBrandEntry = {
  key: string;
  entry: BrandHostEntry;
};

/**
 * Curated official host coverage for common skincare brands. This is
 * intentionally explicit rather than heuristic so product discovery can
 * strongly prefer brand-owned domains when they are known.
 */
const BRAND_HOST_ENTRIES: readonly BrandHostEntry[] = [
  {
    brand: 'Avene',
    aliases: ['Avène', 'Eau Thermale Avene', 'Eau Thermale Avène'],
    hostPatterns: ['aveneusa.com', 'eau-thermale-avene.com'],
  },
  {
    brand: 'Aveeno',
    hostPatterns: ['aveeno.com'],
  },
  {
    brand: 'Bioderma',
    hostPatterns: ['bioderma.com', 'bioderma.us'],
  },
  {
    brand: 'Biossance',
    hostPatterns: ['biossance.com'],
  },
  {
    brand: 'Beauty of Joseon',
    hostPatterns: ['beautyofjoseon.com'],
  },
  {
    brand: 'Byoma',
    hostPatterns: ['byoma.com'],
  },
  {
    brand: 'CeraVe',
    hostPatterns: [
      'cerave.com',
      'cerave.ca',
      'cerave.co.uk',
      'cerave.ie',
      'cerave.com.au',
      'ceravemy.com',
    ],
  },
  {
    brand: 'Cetaphil',
    hostPatterns: ['cetaphil.com'],
  },
  {
    brand: 'Clinique',
    hostPatterns: ['clinique.com'],
  },
  {
    brand: 'COSRX',
    hostPatterns: ['cosrx.com'],
  },
  {
    brand: 'Differin',
    hostPatterns: ['differin.com'],
  },
  {
    brand: 'Dr. Jart+',
    aliases: ['Dr Jart', 'Dr Jart+', 'Dr. Jart', 'DrJart'],
    hostPatterns: ['drjart.com'],
  },
  {
    brand: 'Drunk Elephant',
    hostPatterns: ['drunkelephant.com'],
  },
  {
    brand: 'EltaMD',
    aliases: ['Elta MD'],
    hostPatterns: ['eltamd.com'],
  },
  {
    brand: 'Eucerin',
    hostPatterns: ['eucerin.com', 'eucerinus.com'],
  },
  {
    brand: 'Farmacy',
    aliases: ['Farmacy Beauty'],
    hostPatterns: ['farmacybeauty.com'],
  },
  {
    brand: 'First Aid Beauty',
    hostPatterns: ['firstaidbeauty.com'],
  },
  {
    brand: 'Glossier',
    hostPatterns: ['glossier.com'],
  },
  {
    brand: 'Haruharu Wonder',
    aliases: ['Haruharu', 'haruharu wonder'],
    hostPatterns: ['haruharuwonder.com', 'haruharuusa.com'],
  },
  {
    brand: 'IUNIK',
    aliases: ['IUNIK Global'],
    hostPatterns: ['iunik.com'],
  },
  {
    brand: 'Innisfree',
    hostPatterns: ['innisfree.com'],
  },
  {
    brand: 'Isntree',
    hostPatterns: ['isntree.com', 'myisntree.com'],
  },
  {
    brand: "Kiehl's",
    aliases: ['Kiehls'],
    hostPatterns: ['kiehls.com'],
  },
  {
    brand: 'La Roche-Posay',
    aliases: ['La Roche Posay'],
    hostPatterns: [
      'laroche-posay.com',
      'laroche-posay.us',
      'laroche-posay.ca',
      'laroche-posay.co.uk',
      'laroche-posay.com.au',
    ],
  },
  {
    brand: 'Laneige',
    hostPatterns: ['laneige.com', 'laneige.co.kr'],
  },
  {
    brand: 'Mediheal',
    hostPatterns: ['mediheal.com'],
  },
  {
    brand: 'Murad',
    hostPatterns: ['murad.com'],
  },
  {
    brand: 'Neutrogena',
    hostPatterns: ['neutrogena.com'],
  },
  {
    brand: 'Numbuzin',
    hostPatterns: ['numbuzin.com', 'numbuzincom.com'],
  },
  {
    brand: 'Olay',
    hostPatterns: ['olay.com'],
  },
  {
    brand: "Paula's Choice",
    aliases: ['Paulas Choice'],
    hostPatterns: ['paulaschoice.com'],
  },
  {
    brand: 'PanOxyl',
    aliases: ['Pan Oxyl'],
    hostPatterns: ['panoxyl.com'],
  },
  {
    brand: 'Purito',
    aliases: ['Purito Seoul'],
    hostPatterns: ['purito.com', 'puritocom.com'],
  },
  {
    brand: 'Pyunkang Yul',
    aliases: ['PyunkangYul'],
    hostPatterns: ['pyunkangyul.com'],
  },
  {
    brand: 'RoC',
    aliases: ['ROC'],
    hostPatterns: ['rocskincare.com'],
  },
  {
    brand: 'Round Lab',
    aliases: ['ROUND LAB'],
    hostPatterns: ['roundlab.co.kr', 'roundlab.com', 'roundlabskincare.com'],
  },
  {
    brand: 'Shiseido',
    hostPatterns: ['shiseido.com'],
  },
  {
    brand: 'SK-II',
    aliases: ['SK II', 'SK2', 'SKII'],
    hostPatterns: ['sk-ii.com', 'skii.com'],
  },
  {
    brand: 'Skin1004',
    aliases: ['SKIN1004'],
    hostPatterns: ['skin1004.com', 'skin1004com.com'],
  },
  {
    brand: 'Some By Mi',
    aliases: ['SOME BY MI', 'Somebymi'],
    hostPatterns: ['some-by-mi.com', 'somebymi.com'],
  },
  {
    brand: 'Sulwhasoo',
    hostPatterns: ['sulwhasoo.com'],
  },
  {
    brand: 'Sunday Riley',
    hostPatterns: ['sundayriley.com'],
  },
  {
    brand: 'Supergoop!',
    aliases: ['Supergoop'],
    hostPatterns: ['supergoop.com'],
  },
  {
    brand: 'Tatcha',
    hostPatterns: ['tatcha.com'],
  },
  {
    brand: 'The Ordinary',
    hostPatterns: ['theordinary.com'],
  },
  {
    brand: 'Torriden',
    hostPatterns: ['torriden.com', 'torriden.us'],
  },
  {
    brand: 'Vanicream',
    hostPatterns: ['vanicream.com'],
  },
  {
    brand: 'Vichy',
    hostPatterns: ['vichyusa.com', 'vichy.ca', 'vichy.co.uk'],
  },
  {
    brand: 'Youth To The People',
    aliases: ['Youth to the People'],
    hostPatterns: ['youthtothepeople.com'],
  },
  {
    brand: 'Anua',
    hostPatterns: ['anua.kr', 'anuaus.com', 'anuausa.us'],
  },
];

function normalizeBrandKey(value: string): string {
  return normalizeSearchValue(value)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const INDEXED_BRAND_ENTRIES: readonly IndexedBrandEntry[] =
  BRAND_HOST_ENTRIES.flatMap((entry) => {
    return [entry.brand, ...(entry.aliases ?? [])].map((candidate) => ({
      key: normalizeBrandKey(candidate),
      entry,
    }));
  })
    .filter((entry) => entry.key.length > 0)
    .sort((left, right) => right.key.length - left.key.length);

function hostnameMatchesPattern(hostname: string, pattern: string): boolean {
  return hostname === pattern || hostname.endsWith(`.${pattern}`);
}

function findIndexedEntryByExactBrand(
  brand: string | null | undefined,
): IndexedBrandEntry | null {
  const key = normalizeBrandKey(brand ?? '');
  if (!key) {
    return null;
  }

  return INDEXED_BRAND_ENTRIES.find((entry) => entry.key === key) ?? null;
}

export function inferKnownBrandFromQuery(
  query: string | null | undefined,
): BrandHostEntry | null {
  const normalizedQuery = normalizeBrandKey(query ?? '');
  if (!normalizedQuery) {
    return null;
  }

  const paddedQuery = ` ${normalizedQuery} `;
  return (
    INDEXED_BRAND_ENTRIES.find((entry) =>
      paddedQuery.includes(` ${entry.key} `),
    )?.entry ?? null
  );
}

export function getKnownBrandHostPatterns(
  input: string | null | undefined,
): string[] {
  const directMatch = findIndexedEntryByExactBrand(input);
  return directMatch ? [...directMatch.entry.hostPatterns] : [];
}

export function getPreferredBrandHostPatterns(options: {
  brand?: string | null;
  query?: string | null;
}): string[] {
  const patterns = new Set<string>();

  for (const pattern of getKnownBrandHostPatterns(options.brand)) {
    patterns.add(pattern);
  }

  const inferredFromQuery = inferKnownBrandFromQuery(options.query);
  for (const pattern of inferredFromQuery?.hostPatterns ?? []) {
    patterns.add(pattern);
  }

  return Array.from(patterns);
}

export function urlMatchesKnownBrandHost(
  url: string,
  brand: string | null | undefined,
): boolean | null {
  const patterns = getKnownBrandHostPatterns(brand);
  if (patterns.length === 0) {
    return null;
  }

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return patterns.some((pattern) =>
      hostnameMatchesPattern(hostname, pattern),
    );
  } catch {
    return false;
  }
}

export function urlMatchesHostPatterns(
  url: string,
  patterns: Iterable<string>,
): boolean {
  const normalizedPatterns = Array.from(
    new Set(
      Array.from(patterns)
        .map((pattern) => pattern.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  if (normalizedPatterns.length === 0) {
    return false;
  }

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return normalizedPatterns.some((pattern) =>
      hostnameMatchesPattern(hostname, pattern),
    );
  } catch {
    return false;
  }
}

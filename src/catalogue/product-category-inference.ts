import { ProductCategory } from '../shelf/shelf.types';

type CategoryRule = {
  pattern: RegExp;
  weight: number;
  strong?: boolean;
};

type CategoryInference = {
  category: ProductCategory;
  score: number;
  strong: boolean;
};

const CATEGORY_KEYWORDS: Array<{
  category: ProductCategory;
  patterns: CategoryRule[];
}> = [
  {
    category: ProductCategory.Cleanser,
    patterns: [
      { pattern: /\bcleanser\b/i, weight: 8, strong: true },
      { pattern: /\bface wash\b/i, weight: 8, strong: true },
      { pattern: /\bbody wash\b/i, weight: 8, strong: true },
      { pattern: /\bmicellar water\b/i, weight: 8, strong: true },
      { pattern: /\brengoring\b/i, weight: 8, strong: true },
      {
        pattern: /\b(?:nettoyant|limpiador|reiniger)\b/i,
        weight: 8,
        strong: true,
      },
      {
        pattern: /\bcleansing (?:balm|oil|gel|milk|cream|foam)\b/i,
        weight: 8,
        strong: true,
      },
      { pattern: /\bcleansing\b/i, weight: 5 },
    ],
  },
  {
    category: ProductCategory.Toner,
    patterns: [
      { pattern: /\btoner\b/i, weight: 8, strong: true },
      { pattern: /\btoning\b/i, weight: 6 },
      { pattern: /\bskin tonic\b/i, weight: 8, strong: true },
      {
        pattern: /\b(?:ansiktsvatten|tonique|tonico|gesichtswasser)\b/i,
        weight: 8,
        strong: true,
      },
      { pattern: /\bmist\b/i, weight: 4 },
    ],
  },
  {
    category: ProductCategory.Essence,
    patterns: [
      { pattern: /\bessence\b/i, weight: 8, strong: true },
      { pattern: /\btreatment essence\b/i, weight: 10, strong: true },
    ],
  },
  {
    category: ProductCategory.Serum,
    patterns: [
      { pattern: /\bserum\b/i, weight: 8, strong: true },
      { pattern: /\bampoule\b/i, weight: 8, strong: true },
      { pattern: /\bbooster\b/i, weight: 7, strong: true },
      { pattern: /\bconcentrate\b/i, weight: 7, strong: true },
    ],
  },
  {
    category: ProductCategory.SunProtection,
    patterns: [
      { pattern: /\bspf\s*\d*\+?\b/i, weight: 12, strong: true },
      { pattern: /\bsun\s*protection\b/i, weight: 12, strong: true },
      { pattern: /\bsunscreen\b/i, weight: 12, strong: true },
      {
        pattern:
          /\b(?:solskydd|solaire|protector solar|proteccion solar|sonnenschutz|crema solar)\b/i,
        weight: 12,
        strong: true,
      },
      { pattern: /\b(?:uva|uvb|uva\/uvb|uv)\b/i, weight: 10, strong: true },
      { pattern: /\bbroad\s+spectrum\b/i, weight: 10, strong: true },
      { pattern: /\bpa\+{2,4}\b/i, weight: 10, strong: true },
      {
        pattern: /\bsun\s+(?:cream|gel|fluid|stick)\b/i,
        weight: 8,
        strong: true,
      },
      { pattern: /\bvery\s+high\s+protection\b/i, weight: 8, strong: true },
    ],
  },
  {
    category: ProductCategory.Moisturizer,
    patterns: [
      { pattern: /\bmoisturi[sz]er\b/i, weight: 8, strong: true },
      { pattern: /\bmoisturi[sz]ing\b/i, weight: 5 },
      {
        pattern:
          /\b(?:fuktkram|creme hydratante|hidratante|feuchtigkeitscreme)\b/i,
        weight: 8,
        strong: true,
      },
      { pattern: /\bcream\b/i, weight: 3 },
      { pattern: /\blotion\b/i, weight: 3 },
      { pattern: /\bgel[- ]cream\b/i, weight: 3 },
      { pattern: /\bemulsion\b/i, weight: 4 },
    ],
  },
  {
    category: ProductCategory.Mask,
    patterns: [
      { pattern: /\bmask\b/i, weight: 8, strong: true },
      { pattern: /\b(?:masque|mascarilla|maske)\b/i, weight: 8, strong: true },
      { pattern: /\bsleeping pack\b/i, weight: 8, strong: true },
      { pattern: /\bsheet mask\b/i, weight: 8, strong: true },
    ],
  },
  {
    category: ProductCategory.Exfoliant,
    patterns: [
      { pattern: /\bexfoli/i, weight: 8, strong: true },
      {
        pattern: /\b(?:exfoliering|exfoliante|peeling|peel)\b/i,
        weight: 8,
        strong: true,
      },
      { pattern: /\bexfoliator\b/i, weight: 8, strong: true },
      {
        pattern: /\bexfoliating (?:toner|solution|gel|mask)\b/i,
        weight: 9,
        strong: true,
      },
      { pattern: /\baha\b/i, weight: 7, strong: true },
      { pattern: /\bbha\b/i, weight: 7, strong: true },
      { pattern: /\bpha\b/i, weight: 7, strong: true },
      { pattern: /\bpeel\b/i, weight: 6 },
    ],
  },
  {
    category: ProductCategory.EyeCare,
    patterns: [
      { pattern: /\beye cream\b/i, weight: 9, strong: true },
      { pattern: /\beye serum\b/i, weight: 9, strong: true },
      { pattern: /\beye gel\b/i, weight: 9, strong: true },
      {
        pattern:
          /\b(?:ogonkram|contour des yeux|contorno de ojos|augencreme)\b/i,
        weight: 9,
        strong: true,
      },
    ],
  },
  {
    category: ProductCategory.LipCare,
    patterns: [
      { pattern: /\blip balm\b/i, weight: 9, strong: true },
      { pattern: /\blip mask\b/i, weight: 9, strong: true },
      { pattern: /\blip sleeping mask\b/i, weight: 10, strong: true },
      { pattern: /\blip treatment\b/i, weight: 9, strong: true },
      {
        pattern:
          /\b(?:lappbalsam|baume (?:a|aux )?levres|balsamo labial|lippenbalsam)\b/i,
        weight: 9,
        strong: true,
      },
    ],
  },
  {
    category: ProductCategory.Treatment,
    patterns: [
      { pattern: /\btreatment\b/i, weight: 6 },
      { pattern: /\b(?:behandling|traitement|tratamiento)\b/i, weight: 6 },
      { pattern: /\bspot treatment\b/i, weight: 9, strong: true },
      { pattern: /\bacne treatment\b/i, weight: 9, strong: true },
      { pattern: /\bblemish treatment\b/i, weight: 9, strong: true },
      { pattern: /\bretinoid treatment\b/i, weight: 8, strong: true },
      { pattern: /\bretinol\b/i, weight: 5 },
      { pattern: /\bspot\b/i, weight: 5 },
    ],
  },
];

export function inferCategoryFromText(
  ...values: Array<string | null | undefined>
): ProductCategory {
  return inferCategoryDetails(values).category;
}

export function refineCategoryFromText(
  category: ProductCategory | null | undefined,
  ...values: Array<string | string[] | null | undefined>
): ProductCategory | undefined {
  const inferred = inferCategoryDetails(
    values.flatMap((value) => (Array.isArray(value) ? value : [value])),
  );

  if (inferred.category === ProductCategory.Other) {
    return category ?? undefined;
  }

  if (!category || category === ProductCategory.Other) {
    return inferred.category;
  }

  if (
    inferred.category === ProductCategory.SunProtection &&
    inferred.strong &&
    category !== ProductCategory.SunProtection
  ) {
    return ProductCategory.SunProtection;
  }

  if (
    inferred.strong &&
    inferred.score >= 8 &&
    inferred.category !== category
  ) {
    return inferred.category;
  }

  return category;
}

function inferCategoryDetails(
  values: Array<string | null | undefined>,
): CategoryInference {
  const haystack = normalizeForMatching(values.filter(Boolean).join(' '));

  if (!haystack.trim()) {
    return {
      category: ProductCategory.Other,
      score: 0,
      strong: false,
    };
  }

  const scores = new Map<ProductCategory, CategoryInference>();

  for (const entry of CATEGORY_KEYWORDS) {
    for (const rule of entry.patterns) {
      if (!rule.pattern.test(haystack)) {
        continue;
      }

      const current = scores.get(entry.category) ?? {
        category: entry.category,
        score: 0,
        strong: false,
      };
      current.score += rule.weight;
      current.strong = current.strong || Boolean(rule.strong);
      scores.set(entry.category, current);
    }
  }

  return (
    Array.from(scores.values()).sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return categoryOrder(left.category) - categoryOrder(right.category);
    })[0] ?? {
      category: ProductCategory.Other,
      score: 0,
      strong: false,
    }
  );
}

function categoryOrder(category: ProductCategory): number {
  return CATEGORY_KEYWORDS.findIndex((entry) => entry.category === category);
}

function normalizeForMatching(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

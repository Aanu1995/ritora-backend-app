import { normalizeImportedTextList } from '../common/utils/imported-text';

const MAX_CLAIM_ITEMS = 6;

type ClaimRule = {
  pattern: RegExp;
  label: string;
};

const NOISY_CLAIM_PATTERNS = [
  /\b(?:view|shop|buy|add to bag|add to cart)\b/i,
  /\b(?:cookie|privacy|terms|policy|faq|contact us)\b/i,
  /\b(?:ingredients?|how to use|directions?|warnings?|cautions?)\b/i,
  /\b(?:barcode|batch|lot|expires?|manufactured|distributed)\b/i,
  /\b\d+(?:[.,]\d+)?\s*(?:ml|fl\.?\s*oz|g)\b/i,
];

const BENEFIT_LABELS = [
  'benefits?',
  'what it does',
  'how does it help\\??',
  'helps? (?:to )?',
  'skin concerns?',
  'targets?',
  'hudproblem',
  'effekt',
  'bienfaits',
  'beneficios',
  'vorteile',
];

const SUITED_FOR_LABELS = [
  'suited for',
  'suitable for',
  'best for',
  'ideal for',
  'good for',
  'for',
  'skin types?',
  'who is it for\\??',
  'passar for',
  'hudtyp',
  'apto para',
  'convient aux',
  'geeignet fur',
];

const BENEFIT_RULES: ClaimRule[] = [
  { pattern: /\banti[-\s]?age(?:ing|ing)?\b/i, label: 'anti-aging' },
  { pattern: /\bwrinkles?\b|\bfine lines?\b/i, label: 'anti-aging' },
  { pattern: /\bpore[-\s]?minimi[sz](?:e|ing)\b/i, label: 'pore-minimizing' },
  { pattern: /\bminimi[sz](?:es?|ing)\s+pores?\b/i, label: 'pore-minimizing' },
  { pattern: /\bskin[-\s]?firm(?:ing)?\b|\bfirm(?:ing)?\b/i, label: 'firming' },
  {
    pattern: /\bbright(?:en|ening)?\b|\bradiance\b|\bglow\b/i,
    label: 'brightening',
  },
  {
    pattern: /\bhydrat(?:e|es|ing|ion|ante?|ants?)?\b/i,
    label: 'hydrating',
  },
  {
    pattern: /\b(?:aterfukt|fuktgiv|hidrat|feuchtigkeit)\b/i,
    label: 'hydrating',
  },
  { pattern: /\bmoisturi[sz](?:e|es|ing|ation)?\b/i, label: 'moisturizing' },
  { pattern: /\bcalm(?:s|ing)?\b/i, label: 'calming' },
  { pattern: /\b(?:lugnande|calmant|beruhig)\b/i, label: 'calming' },
  { pattern: /\bsooth(?:e|es|ing)?\b/i, label: 'soothing' },
  { pattern: /\bapais/i, label: 'soothing' },
  {
    pattern: /\boil[-\s]?control\b|\bcontrols?\s+oil\b/i,
    label: 'oil control',
  },
  { pattern: /\b(?:talg|sebum|grasa)\b/i, label: 'oil control' },
  { pattern: /\bmatte\b|\bmattify(?:ing)?\b/i, label: 'mattifying' },
  { pattern: /\bmatt(?:e|ifying)?\b|\bmattier/i, label: 'mattifying' },
  { pattern: /\bexfoliat(?:e|es|ing|ion)?\b/i, label: 'exfoliating' },
  { pattern: /\bsmooth(?:s|ing)?\b/i, label: 'smoothing' },
  {
    pattern: /\bclarif(?:y|ies|ying)\b|\bclear(?:ing)?\b/i,
    label: 'clarifying',
  },
  { pattern: /\bbarrier\b/i, label: 'barrier support' },
  { pattern: /\brepair(?:s|ing)?\b/i, label: 'repairing' },
  { pattern: /\bnourish(?:es|ing)?\b/i, label: 'nourishing' },
  {
    pattern: /\bprotect(?:s|ing|ion)?\b|\bspf\b|\buva\b|\buvb\b/i,
    label: 'protective',
  },
  { pattern: /\bredness\b/i, label: 'redness relief' },
  {
    pattern: /\b(?:rodnad|rougeurs|rojeces|rotung)\b/i,
    label: 'redness relief',
  },
  { pattern: /\bblemish(?:es)?\b|\bacne\b/i, label: 'blemish care' },
];

const SUITED_FOR_RULES: ClaimRule[] = [
  { pattern: /\ball\s+skin\s+types?\b/i, label: 'all skin types' },
  {
    pattern:
      /\b(?:alla hudtyper|tous types de peaux?|todo tipo de piel|alle hauttypen)\b/i,
    label: 'all skin types',
  },
  { pattern: /\bnormal(?:\s+skin)?\b/i, label: 'normal skin' },
  {
    pattern: /\b(?:normal hud|peaux? normales?|piel normal|normale haut)\b/i,
    label: 'normal skin',
  },
  { pattern: /\bdry(?:\s+skin)?\b/i, label: 'dry skin' },
  {
    pattern: /\b(?:torr hud|peaux? seches?|piel seca|trockene haut)\b/i,
    label: 'dry skin',
  },
  { pattern: /\boily(?:\s+skin)?\b/i, label: 'oily skin' },
  {
    pattern: /\b(?:fet hud|peaux? grasses?|piel grasa|fettige haut)\b/i,
    label: 'oily skin',
  },
  { pattern: /\bcombination(?:\s+skin)?\b/i, label: 'combination skin' },
  {
    pattern: /\b(?:blandhy|peaux? mixtes?|piel mixta|mischhaut)\b/i,
    label: 'combination skin',
  },
  { pattern: /\bsensitive(?:\s+skin)?\b/i, label: 'sensitive skin' },
  {
    pattern:
      /\b(?:kanslig hud|peaux? sensibles?|piel sensible|empfindliche haut)\b/i,
    label: 'sensitive skin',
  },
  { pattern: /\breactive(?:\s+skin)?\b/i, label: 'reactive skin' },
  { pattern: /\bstressed(?:\s+skin)?\b/i, label: 'stressed skin' },
  { pattern: /\bdehydrated(?:\s+skin)?\b/i, label: 'dehydrated skin' },
  {
    pattern: /\b(?:uttorkad hud|peaux? deshydratees?|piel deshidratada)\b/i,
    label: 'dehydrated skin',
  },
  { pattern: /\bmature(?:\s+skin)?\b/i, label: 'mature skin' },
  {
    pattern: /\b(?:mogen hud|peaux? matures?|piel madura|reife haut)\b/i,
    label: 'mature skin',
  },
  { pattern: /\bacne[-\s]?prone(?:\s+skin)?\b/i, label: 'acne-prone skin' },
  {
    pattern:
      /\b(?:aknebenagen hud|peaux? a tendance acneique|piel acneica|zu akne neigende haut)\b/i,
    label: 'acne-prone skin',
  },
  {
    pattern: /\bblemish[-\s]?prone(?:\s+skin)?\b/i,
    label: 'blemish-prone skin',
  },
  {
    pattern: /\bredness[-\s]?prone(?:\s+skin)?\b/i,
    label: 'redness-prone skin',
  },
  { pattern: /\bdull(?:\s+skin)?\b/i, label: 'dull skin' },
  {
    pattern: /\brough(?:\s+skin)?\b|\bbumpy(?:\s+skin)?\b/i,
    label: 'rough skin',
  },
  { pattern: /\buneven\s+(?:tone|skin tone)\b/i, label: 'uneven skin tone' },
  { pattern: /\bcongested(?:\s+skin)?\b/i, label: 'congested skin' },
  {
    pattern: /\blarge\s+pores?\b|\bvisible\s+pores?\b/i,
    label: 'visible pores',
  },
];

const BENEFIT_AS_SKIN_TYPE = new RegExp(
  SUITED_FOR_RULES.map((rule) => rule.pattern.source).join('|'),
  'i',
);
const SUITED_FOR_AS_BENEFIT = new RegExp(
  BENEFIT_RULES.map((rule) => rule.pattern.source).join('|'),
  'i',
);

export function sanitizeBenefitList(value: unknown): string[] {
  return sanitizeClaimList(value, {
    labelPrefixes: BENEFIT_LABELS,
    rules: BENEFIT_RULES,
    normalize: normalizeBenefit,
  });
}

export function sanitizeSuitedForList(value: unknown): string[] {
  return sanitizeClaimList(value, {
    labelPrefixes: SUITED_FOR_LABELS,
    rules: SUITED_FOR_RULES,
    normalize: normalizeSuitedFor,
  });
}

function sanitizeClaimList(
  value: unknown,
  options: {
    labelPrefixes: string[];
    rules: ClaimRule[];
    normalize: (value: string, rules: ClaimRule[]) => string | null;
  },
): string[] {
  const sourceItems = normalizeImportedTextList(
    Array.isArray(value)
      ? value.map((item) => (typeof item === 'string' ? item : null))
      : [],
  );
  const splitCandidates = sourceItems.flatMap((item) =>
    splitClaimCandidate(stripLabelPrefix(item, options.labelPrefixes)),
  );
  const normalizedCandidates = splitCandidates.flatMap((item) => {
    const normalized = options.normalize(item, options.rules);
    return normalized
      ? [normalized]
      : extractRuleLabelsInTextOrder(item, options.rules);
  });

  return uniqueClaims(normalizedCandidates).slice(0, MAX_CLAIM_ITEMS);
}

function normalizeBenefit(value: string, rules: ClaimRule[]): string | null {
  const candidate = cleanClaimText(value, BENEFIT_LABELS);
  if (
    !candidate ||
    isNoisyClaim(candidate) ||
    BENEFIT_AS_SKIN_TYPE.test(normalizeForMatching(candidate))
  ) {
    return null;
  }

  const exactRule = rules.find((rule) => isExactRuleMatch(candidate, rule));
  if (exactRule) {
    return exactRule.label;
  }

  const ruleLabels = uniqueClaims(
    extractRuleLabelsInTextOrder(candidate, rules),
  );
  if (ruleLabels.length === 1) {
    return ruleLabels[0];
  }

  if (ruleLabels.length > 1) {
    return null;
  }

  return normalizeShortPhrase(candidate, 5);
}

function normalizeSuitedFor(value: string, rules: ClaimRule[]): string | null {
  const candidate = cleanClaimText(value, SUITED_FOR_LABELS);
  if (!candidate || isNoisyClaim(candidate)) {
    return null;
  }

  const exactRule = rules.find((rule) => isExactRuleMatch(candidate, rule));
  if (exactRule) {
    return exactRule.label;
  }

  if (SUITED_FOR_AS_BENEFIT.test(normalizeForMatching(candidate))) {
    return null;
  }

  const ruleLabels = uniqueClaims(
    extractRuleLabelsInTextOrder(candidate, rules),
  );
  if (ruleLabels.length === 1) {
    return ruleLabels[0];
  }

  if (ruleLabels.length > 1) {
    return null;
  }

  const normalized = normalizeShortPhrase(candidate, 5);
  if (!normalized) {
    return null;
  }

  return /\bskin\b/i.test(normalized) ? normalized : `${normalized} skin`;
}

function cleanClaimText(value: string, labelPrefixes: string[]): string | null {
  const cleaned = stripLabelPrefix(value, labelPrefixes)
    .replace(/[\u2713\u2714\u2611\u25cb\u25ef]+/g, ' ')
    .replace(/^[\u2022\u00b7\-\u2013\u2014:;,.()\d\s]+/g, '')
    .replace(/[.;:,()[\]\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.length > 0 ? cleaned : null;
}

function stripLabelPrefix(value: string, labels: string[]): string {
  const labelPattern = labels.join('|');
  return normalizeForMatching(value)
    .replace(
      new RegExp(`^(?:${labelPattern})\\s*[:?\\-\\u2013\\u2014]*\\s*`, 'i'),
      '',
    )
    .trim();
}

function splitClaimCandidate(value: string): string[] {
  return value
    .replace(/[\u2713\u2714\u2611\u25cb\u25ef]+/g, ',')
    .split(/\s*(?:[\u2022\u00b7]|\n+|;|\||,(?!\s*(?:inc|ltd|llc)\b))\s*/i)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isNoisyClaim(value: string): boolean {
  return NOISY_CLAIM_PATTERNS.some((pattern) => pattern.test(value));
}

function isExactRuleMatch(value: string, rule: ClaimRule): boolean {
  const normalized = normalizeRuleComparable(value);
  const match = normalized.match(rule.pattern);

  return Boolean(match && match[0].trim() === normalized);
}

function extractRuleLabelsInTextOrder(
  value: string,
  rules: ClaimRule[],
): string[] {
  const normalizedValue = normalizeForMatching(value);

  return rules
    .map((rule) => {
      const match = normalizedValue.match(rule.pattern);
      return match?.index === undefined
        ? null
        : { index: match.index, label: rule.label };
    })
    .filter((match): match is { index: number; label: string } =>
      Boolean(match),
    )
    .sort((left, right) => left.index - right.index)
    .map((match) => match.label);
}

function normalizeShortPhrase(value: string, maxWords: number): string | null {
  const normalized = value
    .replace(/\band\/or\b/gi, 'and')
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const words = normalized.split(/\s+/);

  if (normalized.length > 56 || words.length > maxWords) {
    return null;
  }

  return normalized;
}

function normalizeRuleComparable(value: string): string {
  return normalizeForMatching(value)
    .replace(/[-\u2013\u2014]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeForMatching(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function uniqueClaims(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const key = normalizeRuleComparable(value);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(value);
  }

  return output;
}

export interface SourceReferenceInput {
  text: string;
  urls: string[];
  organizations: string[];
}

export interface AllowlistedSource {
  id: string;
  organization: string;
  url: string;
}

export interface SourceReferenceValidation {
  ok: boolean;
  reason: string | null;
}

const UNSAFE_LANGUAGE =
  /\b(causes?|caused|leads?\s+to|results?\s+in|diagnose|diagnosis|treat|treatment|cure|prescribe)\b/i;
const AI_STYLE_PUNCTUATION = /[-—–]/;
const VAGUE_AUTHORITY =
  /\b(research\s+shows|studies\s+show|doctors?\s+recommend|clinically\s+proven|dermatologists?\s+recommend)\b/i;
const KNOWN_MEDICAL_SOURCE_ORGANIZATIONS = [
  'American Academy of Dermatology',
  'AAD',
  'PubMed',
  'Mayo Clinic',
  'Cleveland Clinic',
  'NHS',
  'WebMD',
  'Healthline',
  'National Eczema Association',
  'American Cancer Society',
] as const;
const SOURCE_ORGANIZATION_ALIASES: Record<string, readonly string[]> = {
  'American Academy of Dermatology': ['AAD'],
};

export function containsUnsafeInsightLanguage(text: string): boolean {
  return UNSAFE_LANGUAGE.test(text) || AI_STYLE_PUNCTUATION.test(text);
}

export function containsUnsupportedAuthorityClaim(
  text: string,
  allowlistedSources: readonly AllowlistedSource[],
): boolean {
  return allowlistedSources.length === 0 && VAGUE_AUTHORITY.test(text);
}

export function validateInsightSourceReferences(
  input: SourceReferenceInput,
  allowlistedSources: readonly AllowlistedSource[],
): SourceReferenceValidation {
  const urls = new Set(allowlistedSources.map((source) => source.url));
  const organizations = new Set(
    allowlistedSources.flatMap((source) => [
      source.organization.toLowerCase(),
      ...(SOURCE_ORGANIZATION_ALIASES[source.organization] ?? []).map((alias) =>
        alias.toLowerCase(),
      ),
    ]),
  );
  const mentionedKnownOrganizations = KNOWN_MEDICAL_SOURCE_ORGANIZATIONS.filter(
    (organization) => textIncludesOrganization(input.text, organization),
  );

  for (const url of input.urls) {
    if (!urls.has(url)) {
      return {
        ok: false,
        reason: `Source URL is not allowlisted: ${url}`,
      };
    }
  }

  for (const organization of input.organizations) {
    if (!organizations.has(organization.toLowerCase())) {
      return {
        ok: false,
        reason: `Source organization is not allowlisted: ${organization}`,
      };
    }
  }

  for (const organization of mentionedKnownOrganizations) {
    if (!organizations.has(organization.toLowerCase())) {
      return {
        ok: false,
        reason: `Source organization is not allowlisted: ${organization}`,
      };
    }
  }

  if (containsUnsafeInsightLanguage(input.text)) {
    return {
      ok: false,
      reason: 'Insight output contains unsafe medical or causal language.',
    };
  }

  if (containsUnsupportedAuthorityClaim(input.text, allowlistedSources)) {
    return {
      ok: false,
      reason: 'Insight output contains unsupported authority language.',
    };
  }

  return { ok: true, reason: null };
}

function textIncludesOrganization(text: string, organization: string): boolean {
  const escaped = organization.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

import type { InsightCandidate, InsightSourceCitation } from '../insight-types';

export function buildInsightsPolishPrompt(input: {
  locale: string;
  candidates: InsightCandidate[];
  sourcesByInsight: Record<string, InsightSourceCitation[]>;
}): string {
  return JSON.stringify(
    {
      task: 'Polish Ritora Skin Journal insight headlines and text blocks using only supplied facts and sources. Return strict JSON only.',
      locale: input.locale,
      rules: [
        'Use calm and supportive language. Do not diagnose or sound certain.',
        'Write like a careful human specialist using plain human words.',
        'Do not use hyphens or em dashes in user visible wording.',
        'Avoid the clipped, overly polished style common in AI text.',
        'Prefer short natural sentences over polished marketing copy.',
        'Never claim causation. Prefer "tracks with", "appears alongside", "tends to follow", or "is consistent with".',
        'Do not use diagnose, treat, cure, prescribe, causes, leads to, or results in.',
        'Do not invent numbers, sources, organizations, URLs, products, or dates.',
        'Only reference organizations present in sourcesByInsight for that facts_hash.',
        'Do not include user identifiers, names, emails, or photo data.',
      ],
      insights: input.candidates.map((candidate) => ({
        facts_hash: candidate.metadata.facts_hash,
        kind: candidate.kind,
        severity: candidate.severity,
        confidence: candidate.confidence,
        headline: candidate.headline,
        text_blocks: candidate.blocks
          .map((block, index) =>
            block.type === 'text'
              ? {
                  index,
                  key: block.key,
                  values: block.values ?? {},
                  tone: block.tone ?? 'neutral',
                }
              : null,
          )
          .filter((block) => block !== null),
        caveat_keys: candidate.caveats.map((caveat) => caveat.key),
        time_window: candidate.time_window,
        referenced_sources:
          input.sourcesByInsight[candidate.metadata.facts_hash] ?? [],
      })),
    },
    null,
    2,
  );
}

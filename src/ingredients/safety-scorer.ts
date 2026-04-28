import type { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { AnalysisSeverity } from './ingredients.types';
import type { AnalysisConflict, AnalysisOverlap } from './ingredients.types';

const CONFLICT_PENALTIES: Record<AnalysisSeverity, number> = {
  [AnalysisSeverity.High]: 25,
  [AnalysisSeverity.Medium]: 15,
  [AnalysisSeverity.Low]: 8,
};

const OVERLAP_PENALTIES: Record<AnalysisSeverity, number> = {
  [AnalysisSeverity.High]: 15,
  [AnalysisSeverity.Medium]: 8,
  [AnalysisSeverity.Low]: 3,
};

const SEVERITY_ORDER = [
  AnalysisSeverity.Low,
  AnalysisSeverity.Medium,
  AnalysisSeverity.High,
];

function normalizeValue(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function bumpSeverity(severity: AnalysisSeverity): AnalysisSeverity {
  const index = SEVERITY_ORDER.indexOf(severity);
  return SEVERITY_ORDER[Math.min(index + 1, SEVERITY_ORDER.length - 1)];
}

export function maybeAdjustSeverity(
  severity: AnalysisSeverity,
  skinProfile: SkinProfile | null | undefined,
  tags: string[],
): AnalysisSeverity {
  if (!skinProfile) {
    return severity;
  }

  if (normalizeValue(skinProfile.skin_type ?? '') === 'sensitive') {
    return bumpSeverity(severity);
  }

  const normalizedReactionTriggers = new Set(
    (skinProfile.reaction_history?.entries ?? [])
      .map((entry) => normalizeValue(entry.trigger))
      .filter(Boolean),
  );

  if (normalizedReactionTriggers.size === 0) {
    return severity;
  }

  for (const tag of tags
    .map((value) => normalizeValue(value))
    .filter(Boolean)) {
    if (normalizedReactionTriggers.has(tag)) {
      return bumpSeverity(severity);
    }

    for (const trigger of normalizedReactionTriggers) {
      if (trigger.includes(tag) || tag.includes(trigger)) {
        return bumpSeverity(severity);
      }
    }
  }

  return severity;
}

export function scoreAnalysis(input: {
  conflicts: AnalysisConflict[];
  overlaps: AnalysisOverlap[];
}): number {
  let score = 100;

  for (const conflict of input.conflicts) {
    score -= CONFLICT_PENALTIES[conflict.severity];
  }

  for (const overlap of input.overlaps) {
    score -= OVERLAP_PENALTIES[overlap.severity];
  }

  return Math.max(0, score);
}

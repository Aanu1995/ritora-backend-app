import type { SkinJournalEntry } from '../../skin-journal/entities/skin-journal-entry.entity';
import type {
  AnalysisChangeDirection,
  AnalysisObservations,
  PhotoAnalysisTextRef,
} from '../../skin-journal/skin-journal.constants';
import type { SuggestionContextSummary } from '../suggestion-context.types';

type JournalSignals = NonNullable<SuggestionContextSummary['journalSignals']>;

export type DetectedConcernAggregate = {
  count: number;
  severities: Set<string>;
  locations: Set<string>;
  confidenceTotal: number;
  confidenceCount: number;
  maxConfidence: number | null;
  changeDirections: Set<string>;
};

export type VisualChangeAggregate = {
  directions: Set<string>;
  count: number;
  confidenceTotal: number;
  confidenceCount: number;
  latestDirection: string | null;
  latestEntryDate: string | null;
};

export type InterpretationAggregate = {
  severity: string;
  count: number;
  latestEntryDate: string | null;
  sourceIds: Set<string>;
};

export type ConcernGuidanceAggregate = {
  severity: string;
  count: number;
  locations: Set<string>;
  confidenceLabels: Set<string>;
  actionKeys: Set<string>;
  avoidKeys: Set<string>;
  factorKeys: Set<string>;
  escalationKeys: Set<string>;
  sourceIds: Set<string>;
};

export function hasNeedsRetake(
  entry: SkinJournalEntry,
  observations: AnalysisObservations | null,
): boolean {
  return Boolean(
    entry.needs_retake ||
    observations?.image_quality?.needs_retake ||
    (observations?.per_angle_quality ?? []).some(
      (quality) => quality.needs_retake,
    ),
  );
}

export function createDetectedConcernAggregate(): DetectedConcernAggregate {
  return {
    count: 0,
    severities: new Set<string>(),
    locations: new Set<string>(),
    confidenceTotal: 0,
    confidenceCount: 0,
    maxConfidence: null,
    changeDirections: new Set<string>(),
  };
}

export function createVisualChangeAggregate(): VisualChangeAggregate {
  return {
    directions: new Set<string>(),
    count: 0,
    confidenceTotal: 0,
    confidenceCount: 0,
    latestDirection: null,
    latestEntryDate: null,
  };
}

export function createInterpretationAggregate(
  severity: string,
): InterpretationAggregate {
  return {
    severity,
    count: 0,
    latestEntryDate: null,
    sourceIds: new Set<string>(),
  };
}

export function createConcernGuidanceAggregate(
  severity: string,
): ConcernGuidanceAggregate {
  return {
    severity,
    count: 0,
    locations: new Set<string>(),
    confidenceLabels: new Set<string>(),
    actionKeys: new Set<string>(),
    avoidKeys: new Set<string>(),
    factorKeys: new Set<string>(),
    escalationKeys: new Set<string>(),
    sourceIds: new Set<string>(),
  };
}

export function addTextRefKeys(
  target: Set<string>,
  refs: PhotoAnalysisTextRef[] | undefined,
): void {
  for (const ref of refs ?? []) target.add(ref.key);
}

export function buildDetectedConcerns(
  map: Map<string, DetectedConcernAggregate>,
): JournalSignals['detectedConcerns'] {
  return Array.from(map.entries())
    .map(([concern, aggregate]) => ({
      concern,
      count: aggregate.count,
      severities: Array.from(aggregate.severities),
      locations: Array.from(aggregate.locations),
      averageConfidence: roundedAverage(
        aggregate.confidenceTotal,
        aggregate.confidenceCount,
      ),
      maxConfidence: roundedNumber(aggregate.maxConfidence),
      changeDirections: Array.from(aggregate.changeDirections),
    }))
    .sort(
      (first, second) =>
        second.count - first.count ||
        first.concern.localeCompare(second.concern),
    );
}

export function buildInterpretationSignals(
  map: Map<string, InterpretationAggregate>,
  sourceIds: Set<string>,
  guidanceKeys: Set<string>,
  caveatKeys: Set<string>,
): JournalSignals['interpretationSignals'] {
  return {
    codes: Array.from(map.entries())
      .map(([code, aggregate]) => ({
        code,
        severity: aggregate.severity,
        count: aggregate.count,
        latestEntryDate: aggregate.latestEntryDate,
        sourceIds: Array.from(aggregate.sourceIds).sort(),
      }))
      .sort(
        (first, second) =>
          binnedSeverity(second.severity) - binnedSeverity(first.severity) ||
          second.count - first.count ||
          (second.latestEntryDate ?? '').localeCompare(
            first.latestEntryDate ?? '',
          ) ||
          first.code.localeCompare(second.code),
      ),
    sourceIds: Array.from(sourceIds).sort(),
    guidanceKeys: Array.from(guidanceKeys).sort(),
    caveatKeys: Array.from(caveatKeys).sort(),
  };
}

export function buildConcernGuidance(
  map: Map<string, ConcernGuidanceAggregate>,
): JournalSignals['concernGuidance'] {
  return Array.from(map.entries())
    .map(([concern, aggregate]) => ({
      concern,
      severity: aggregate.severity,
      count: aggregate.count,
      locations: Array.from(aggregate.locations).sort(),
      confidenceLabels: Array.from(aggregate.confidenceLabels).sort(),
      actionKeys: Array.from(aggregate.actionKeys).sort(),
      avoidKeys: Array.from(aggregate.avoidKeys).sort(),
      factorKeys: Array.from(aggregate.factorKeys).sort(),
      escalationKeys: Array.from(aggregate.escalationKeys).sort(),
      sourceIds: Array.from(aggregate.sourceIds).sort(),
    }))
    .sort(
      (first, second) =>
        binnedSeverity(second.severity) - binnedSeverity(first.severity) ||
        second.count - first.count ||
        first.concern.localeCompare(second.concern),
    );
}

export function buildVisualChanges(
  map: Map<string, VisualChangeAggregate>,
): JournalSignals['visualChanges'] {
  return Array.from(map.entries())
    .map(([concern, aggregate]) => ({
      concern,
      directions: Array.from(aggregate.directions),
      count: aggregate.count,
      averageConfidence: roundedAverage(
        aggregate.confidenceTotal,
        aggregate.confidenceCount,
      ),
      latestDirection: aggregate.latestDirection,
    }))
    .sort(
      (first, second) =>
        second.count - first.count ||
        first.concern.localeCompare(second.concern),
    );
}

export function isComparableChange(
  direction: AnalysisChangeDirection | undefined,
): direction is Exclude<AnalysisChangeDirection, 'not_comparable' | 'unknown'> {
  return Boolean(
    direction && direction !== 'not_comparable' && direction !== 'unknown',
  );
}

export function roundedAverage(total: number, count: number): number | null {
  if (count <= 0) return null;
  return roundedNumber(total / count);
}

export function roundedNumber(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

export function strongestSeverity(first: string, second: string): string {
  return binnedSeverity(second) > binnedSeverity(first) ? second : first;
}

export function binnedSeverity(severity: string): number {
  switch (severity) {
    case 'critical':
    case 'severe':
      return 4;
    case 'warning':
    case 'moderate':
      return 3;
    case 'mild':
      return 2;
    case 'info':
      return 1;
    default:
      return 0;
  }
}

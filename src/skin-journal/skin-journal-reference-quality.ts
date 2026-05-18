import { SkinJournalEntry } from './entities/skin-journal-entry.entity';
import {
  AnalysisComparisonReference,
  AnalysisObservations,
  PhotoReferenceQuality,
  PhotoReferenceQualityReason,
  PhotoReferenceQualityStatusValue,
} from './skin-journal.constants';

const GOOD_REFERENCE_MIN_SCORE = 0.75;
const TREND_SAFE_MIN_SCORE = 0.55;

export function buildPhotoReferenceQuality(
  entry: Pick<
    SkinJournalEntry,
    | 'photo_object_key'
    | 'analysis_status'
    | 'analysis_observations'
    | 'has_reaction_signal'
  >,
): PhotoReferenceQuality {
  if (!entry.photo_object_key) {
    return notTrendSafe(['no_photo'], null);
  }

  if (
    entry.analysis_status === 'pending' ||
    entry.analysis_status === 'queued' ||
    entry.analysis_status === 'running'
  ) {
    return notTrendSafe(['analysis_pending'], null);
  }

  if (entry.analysis_status === 'failed') {
    return notTrendSafe(['analysis_failed'], null);
  }

  const observations = entry.analysis_observations;
  if (!observations) {
    return notTrendSafe(['analysis_unavailable'], null);
  }

  const quality = observations.image_quality;
  const score =
    typeof quality.quality_score === 'number' ? quality.quality_score : null;
  const blockingReasons: PhotoReferenceQualityReason[] = [];

  if (quality.excluded_from_trends_reason) {
    blockingReasons.push(
      mapTrendExclusionReason(quality.excluded_from_trends_reason),
    );
  }
  if (!quality.face_detected) {
    blockingReasons.push('face_missing');
  }
  if (quality.blur_detected) {
    blockingReasons.push('blur');
  }
  if (quality.lighting_quality === 'poor') {
    blockingReasons.push('poor_lighting');
  }
  if (quality.framing_quality === 'poor') {
    blockingReasons.push('poor_framing');
  }
  if (quality.needs_retake) {
    blockingReasons.push('needs_retake');
  }
  if (typeof score === 'number' && score < TREND_SAFE_MIN_SCORE) {
    blockingReasons.push('quality_limited');
  }

  if (blockingReasons.length > 0) {
    return notTrendSafe(uniqueReasons(blockingReasons), score);
  }

  const limitingReasons: PhotoReferenceQualityReason[] = [];
  if (quality.lighting_quality === 'fair') {
    limitingReasons.push('poor_lighting');
  }
  if (quality.framing_quality === 'fair') {
    limitingReasons.push('poor_framing');
  }
  if (typeof score === 'number' && score < GOOD_REFERENCE_MIN_SCORE) {
    limitingReasons.push('quality_limited');
  }
  if (
    entry.has_reaction_signal ||
    observations.reaction_signals.reaction_detected
  ) {
    limitingReasons.push('reaction_day');
  }

  return {
    status:
      limitingReasons.length > 0
        ? PhotoReferenceQualityStatusValue.LimitedReference
        : PhotoReferenceQualityStatusValue.GoodReference,
    reasons: uniqueReasons(limitingReasons),
    quality_score: score,
  };
}

export function buildAnalysisComparisonReference(
  entry: Pick<
    SkinJournalEntry,
    | 'id'
    | 'entry_date'
    | 'photo_object_key'
    | 'analysis_status'
    | 'analysis_observations'
    | 'has_reaction_signal'
  >,
): AnalysisComparisonReference {
  return {
    entry_id: entry.id,
    entry_date: entry.entry_date,
    quality: buildPhotoReferenceQuality(entry),
  };
}

export function withAnalysisComparisonReference(
  observations: AnalysisObservations,
  reference: AnalysisComparisonReference | null,
): AnalysisObservations {
  return {
    ...observations,
    comparison_reference: reference,
  };
}

export function selectAnalysisReferenceEntry(
  candidates: SkinJournalEntry[],
  currentEntry: SkinJournalEntry,
): SkinJournalEntry | null {
  const viable = candidates.filter((candidate) =>
    isNormalAnalysisReferenceCandidate(candidate),
  );
  if (viable.length === 0) {
    return null;
  }

  const sameRoutineTiming = viable.filter(
    (candidate) => candidate.is_pre_routine === currentEntry.is_pre_routine,
  );
  return chooseReference(sameRoutineTiming) ?? chooseReference(viable);
}

export function isTrendSafeReference(entry: SkinJournalEntry): boolean {
  return (
    buildPhotoReferenceQuality(entry).status !==
    PhotoReferenceQualityStatusValue.NotTrendSafe
  );
}

function isNormalAnalysisReferenceCandidate(entry: SkinJournalEntry): boolean {
  const quality = buildPhotoReferenceQuality(entry);
  return (
    quality.status !== PhotoReferenceQualityStatusValue.NotTrendSafe &&
    !quality.reasons.includes('reaction_day')
  );
}

function chooseReference(
  candidates: SkinJournalEntry[],
): SkinJournalEntry | null {
  if (candidates.length === 0) {
    return null;
  }
  const goodReferences = candidates.filter(
    (candidate) =>
      buildPhotoReferenceQuality(candidate).status ===
      PhotoReferenceQualityStatusValue.GoodReference,
  );
  return mostRecent(goodReferences.length > 0 ? goodReferences : candidates);
}

function mostRecent(candidates: SkinJournalEntry[]): SkinJournalEntry | null {
  return (
    [...candidates].sort((left, right) =>
      right.entry_date.localeCompare(left.entry_date),
    )[0] ?? null
  );
}

function notTrendSafe(
  reasons: PhotoReferenceQualityReason[],
  qualityScore: number | null,
): PhotoReferenceQuality {
  return {
    status: PhotoReferenceQualityStatusValue.NotTrendSafe,
    reasons: uniqueReasons(reasons),
    quality_score: qualityScore,
  };
}

function uniqueReasons(
  reasons: PhotoReferenceQualityReason[],
): PhotoReferenceQualityReason[] {
  return Array.from(new Set(reasons));
}

function mapTrendExclusionReason(
  reason: NonNullable<
    AnalysisObservations['image_quality']['excluded_from_trends_reason']
  >,
): PhotoReferenceQualityReason {
  if (reason === 'poor_lighting') return 'poor_lighting';
  if (reason === 'poor_framing') return 'poor_framing';
  if (reason === 'blur') return 'blur';
  if (reason === 'no_face_detected') return 'face_missing';
  return 'not_comparable';
}

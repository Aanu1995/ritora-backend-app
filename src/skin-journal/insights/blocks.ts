import type {
  InsightAction,
  InsightBlock,
  InsightMetricUnit,
  InsightTone,
  InsightValues,
  LocalizedInsightText,
} from './insight-types';
import type { InsightEvidenceGrade } from '../skin-journal.constants';

export function textBlock(
  key: string,
  values?: InsightValues,
  tone: InsightTone = 'neutral',
): InsightBlock {
  return { type: 'text', key, values, tone };
}

export function metricDeltaBlock(params: {
  value: number;
  previous: number;
  direction: 'down_is_good' | 'up_is_good' | 'neutral';
  unit?: InsightMetricUnit;
  precision?: number;
}): InsightBlock {
  return { type: 'metric_delta', ...params };
}

export function sparklineBlock(
  series: Array<{ x: string; y: number }>,
  baseline?: number,
): InsightBlock {
  return {
    type: 'sparkline',
    series,
    baseline,
    y_domain: [1, 5],
  };
}

export function barStripBlock(
  bars: Array<{ x: string; y: number; tone?: InsightTone }>,
): InsightBlock {
  return { type: 'bar_strip', bars };
}

export function dotStripBlock(
  dots: Array<{ x: string; tone: InsightTone; label?: string }>,
): InsightBlock {
  return { type: 'dot_strip', dots };
}

export function eventStudyBlock(params: {
  before: Array<{ x: string; y: number }>;
  after: Array<{ x: string; y: number }>;
  marker: { x: string; label: LocalizedInsightText };
}): InsightBlock {
  return { type: 'event_study', ...params };
}

export function factorTableBlock(
  rows: Array<{
    factor: LocalizedInsightText;
    effect: number;
    n: number;
    tone?: InsightTone;
  }>,
  effectUnit?: InsightMetricUnit,
): InsightBlock {
  return { type: 'factor_table', rows, effect_unit: effectUnit };
}

export function faceHeatmapBlock(
  zones: Extract<InsightBlock, { type: 'face_heatmap' }>['zones'],
): InsightBlock {
  return { type: 'face_heatmap', zones };
}

export function entryThumbsBlock(entryIds: string[], max = 6): InsightBlock {
  return { type: 'entry_thumbs', entry_ids: entryIds, max };
}

export function disclaimerBlock(
  key: string,
  tone: InsightTone = 'neutral',
  values?: InsightValues,
): InsightBlock {
  return { type: 'disclaimer', key, tone, values };
}

export function ctaLinkBlock(
  key: string,
  action: InsightAction,
  values?: InsightValues,
): InsightBlock {
  return { type: 'cta_link', key, action, values };
}

export function sourceLinkBlock(kbId: string): InsightBlock {
  return { type: 'source_link', kb_id: kbId };
}

export function evidenceGradeBlock(
  grade: InsightEvidenceGrade,
  basis: LocalizedInsightText,
): InsightBlock {
  return { type: 'evidence_grade', grade, basis };
}

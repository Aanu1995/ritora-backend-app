import type {
  AnalysisConcern,
  ConcernKey,
  EventSeverity,
  InsightEvidenceGrade,
  InsightGenerationTrigger,
  InsightKind,
  InsightSourceType,
} from '../skin-journal.constants';

export type InsightValue = string | number | boolean | null;
export type InsightValues = Record<string, InsightValue>;
export type InsightMetricUnit = 'entries' | 'rating';
export const InsightToneValue = {
  Neutral: 'neutral',
  Positive: 'positive',
  Concern: 'concern',
  Warning: 'warning',
  Critical: 'critical',
  Ai: 'ai',
} as const;

export type InsightTone =
  (typeof InsightToneValue)[keyof typeof InsightToneValue];

export interface LocalizedInsightText {
  key: string;
  values?: InsightValues;
  text?: string | null;
}

export interface InsightTimeWindow {
  start: string;
  end: string;
}

export interface InsightSourceCitation {
  id: string;
  title_key: string;
  organization: string;
  summary_key: string;
  url: string;
  evidence_grade: Exclude<InsightEvidenceGrade, 'anecdotal'>;
  last_verified: string;
}

export type InsightAction =
  | { kind: 'view_entries'; entry_ids: string[] }
  | { kind: 'open_compare'; from_date: string; to_date: string }
  | { kind: 'open_product'; inventory_product_id: string }
  | { kind: 'open_today_upload' }
  | { kind: 'dismiss' }
  | { kind: 'open_settings'; tab: string };

export type InsightBlock =
  | {
      type: 'text';
      key: string;
      values?: InsightValues;
      text?: string | null;
      tone?: InsightTone;
    }
  | {
      type: 'metric_delta';
      value: number;
      previous: number;
      unit?: InsightMetricUnit;
      direction: 'down_is_good' | 'up_is_good' | 'neutral';
      precision?: number;
    }
  | {
      type: 'sparkline';
      series: Array<{ x: string; y: number }>;
      baseline?: number;
      markers?: Array<{ x: string; label?: LocalizedInsightText }>;
      y_domain?: [number, number];
    }
  | {
      type: 'bar_strip';
      bars: Array<{ x: string; y: number; tone?: InsightTone }>;
      y_label?: LocalizedInsightText;
    }
  | {
      type: 'dot_strip';
      dots: Array<{ x: string; tone: InsightTone; label?: string }>;
    }
  | {
      type: 'regression';
      series: Array<{ x: string; y: number }>;
      slope: number;
      intercept: number;
      r2: number;
      ci_band?: number;
    }
  | {
      type: 'event_study';
      before: Array<{ x: string; y: number }>;
      after: Array<{ x: string; y: number }>;
      marker: { x: string; label: LocalizedInsightText };
    }
  | {
      type: 'face_heatmap';
      zones: Array<{
        location: string;
        weight: number;
        concern: AnalysisConcern;
      }>;
    }
  | {
      type: 'factor_table';
      rows: Array<{
        factor: LocalizedInsightText;
        effect: number;
        n: number;
        tone?: InsightTone;
      }>;
      effect_unit?: InsightMetricUnit;
    }
  | {
      type: 'entry_thumbs';
      entry_ids: string[];
      max?: number;
      entries?: Array<{
        entry_id: string;
        date: string;
        photo_url: string | null;
      }>;
    }
  | {
      type: 'disclaimer';
      key: string;
      values?: InsightValues;
      tone: InsightTone;
    }
  | {
      type: 'cta_link';
      key: string;
      values?: InsightValues;
      action: InsightAction;
    }
  | { type: 'source_link'; kb_id: string }
  | {
      type: 'evidence_grade';
      grade: InsightEvidenceGrade;
      basis: LocalizedInsightText;
    };

export interface InsightMetadata {
  source: InsightSourceType;
  model: string | null;
  prompt_version: string | null;
  facts_hash: string;
  cache_hit: boolean;
  duration_ms: number;
}

export interface InsightCandidate {
  kind: InsightKind;
  severity: EventSeverity;
  confidence: number;
  headline: LocalizedInsightText;
  blocks: InsightBlock[];
  actions: InsightAction[];
  caveats: LocalizedInsightText[];
  source_entry_ids: string[];
  time_window: InsightTimeWindow;
  data_cutoff_at: string;
  generation_trigger: InsightGenerationTrigger;
  metadata: InsightMetadata;
  referenced_kb_ids: string[];
  insight_signature: string;
}

export interface InsightEnvelope extends InsightCandidate {
  id: string;
  generated_at: Date;
  seen_at: Date | null;
  dismissed_at: Date | null;
  sources: InsightSourceCitation[];
}

export type ConcernTrendFacts = {
  concern: ConcernKey;
  first_avg: number;
  second_avg: number;
  delta: number;
};

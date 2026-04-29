import { SkinJournalEntry } from './entities/skin-journal-entry.entity';
import {
  AnalysisObservations,
  CONCERN_KEYS,
  ConcernKey,
  EventSeverity,
  InsightKind,
} from './skin-journal.constants';

export type DeterministicInsightCandidate = {
  kind: InsightKind;
  severity: EventSeverity;
  summary: string;
  supporting_data: Record<string, unknown>;
  related_entry_ids: string[];
};

export function isModerateOrSevereReaction(
  obs: AnalysisObservations | null,
): boolean {
  return (
    obs?.reaction_signals.reaction_detected === true &&
    ['moderate', 'severe'].includes(obs.reaction_signals.reaction_severity) &&
    obs.reaction_signals.confidence >= 0.6
  );
}

export function buildDeterministicInsights(
  entriesDesc: SkinJournalEntry[],
): DeterministicInsightCandidate[] {
  const entries = [...entriesDesc].sort((a, b) =>
    a.entry_date.localeCompare(b.entry_date),
  );
  const latest = entries.at(-1);
  if (!latest) {
    return [];
  }

  const candidates: DeterministicInsightCandidate[] = [];
  if (latest.analysis_summary) {
    candidates.push({
      kind: 'daily',
      severity:
        Object.prototype.hasOwnProperty.call(latest, 'analysis_observations') &&
        latest.analysis_observations?.reaction_signals.reaction_detected
          ? 'warning'
          : 'info',
      summary: latest.analysis_summary,
      supporting_data: {
        entry_date: latest.entry_date,
        analysis_status: latest.analysis_status,
      },
      related_entry_ids: [latest.id],
    });
  }

  const weekly = entries.slice(-7);
  if (weekly.length >= 3) {
    const reactionCount = weekly.filter((entry) =>
      isModerateOrSevereReaction(entry.analysis_observations),
    ).length;
    candidates.push({
      kind: 'weekly',
      severity: reactionCount > 0 ? 'warning' : 'info',
      summary:
        reactionCount > 0
          ? `${reactionCount} recent entries show moderate or stronger irritation signals.`
          : 'Your recent journal entries look stable this week.',
      supporting_data: {
        reaction_count: reactionCount,
        entries_count: weekly.length,
      },
      related_entry_ids: weekly.map((entry) => entry.id),
    });
  }

  if (entries.length >= 8) {
    const firstHalf = entries.slice(0, Math.floor(entries.length / 2));
    const secondHalf = entries.slice(Math.floor(entries.length / 2));
    const trend = strongestConcernTrend(firstHalf, secondHalf);
    if (trend) {
      candidates.push({
        kind: 'trend',
        severity: trend.delta > 0 ? 'warning' : 'info',
        summary: `${capitalize(trend.concern)} ${trend.delta > 0 ? 'increased' : 'improved'} over the latest journal window.`,
        supporting_data: trend,
        related_entry_ids: entries.map((entry) => entry.id),
      });
    }
  }

  if (entries.length >= 14) {
    candidates.push({
      kind: 'monthly',
      severity: 'info',
      summary: `You have ${entries.length} skin journal entries in the latest 30-day window.`,
      supporting_data: {
        entries_count: entries.length,
        photos_count: entries.filter((entry) => entry.photo_object_key).length,
      },
      related_entry_ids: entries.map((entry) => entry.id),
    });
  }

  const recentReactionIndex = entries
    .slice(0, -1)
    .findLastIndex((entry) =>
      isModerateOrSevereReaction(entry.analysis_observations),
    );
  if (
    recentReactionIndex >= 0 &&
    latest.analysis_observations?.reaction_signals.reaction_detected === false
  ) {
    candidates.push({
      kind: 'reaction_recovery',
      severity: 'info',
      summary:
        'Recent reaction signals appear to have returned toward baseline.',
      supporting_data: {
        recovered_on: latest.entry_date,
      },
      related_entry_ids: [entries[recentReactionIndex].id, latest.id],
    });
  }

  const referralCount = entries
    .slice(-7)
    .filter((entry) =>
      isModerateOrSevereReaction(entry.analysis_observations),
    ).length;
  if (referralCount >= 5) {
    candidates.push({
      kind: 'referral',
      severity: 'critical',
      summary:
        'Several recent entries show moderate or severe irritation signals. Consider contacting a dermatologist.',
      supporting_data: { moderate_or_severe_count_7d: referralCount },
      related_entry_ids: entries.slice(-7).map((entry) => entry.id),
    });
  }

  const productChange = entries.find(
    (entry) => entry.recent_change?.kind === 'started_new_product',
  );
  if (productChange && entries.length >= 8) {
    const before = entries.filter(
      (entry) => entry.entry_date < productChange.entry_date,
    );
    const after = entries.filter(
      (entry) => entry.entry_date >= productChange.entry_date,
    );
    const trend = strongestConcernTrend(before, after);
    if (trend && Math.abs(trend.delta) >= 0.75) {
      candidates.push({
        kind: 'effectiveness',
        severity: trend.delta > 0 ? 'warning' : 'info',
        summary: `${capitalize(trend.concern)} ${trend.delta > 0 ? 'increased' : 'improved'} after a recorded product change.`,
        supporting_data: {
          ...trend,
          change_entry_date: productChange.entry_date,
          related_inventory_product_id:
            productChange.recent_change?.related_inventory_product_id ?? null,
        },
        related_entry_ids: after.map((entry) => entry.id),
      });
    }
  }

  return candidates;
}

export function strongestWorsening(
  previous: SkinJournalEntry,
  current: SkinJournalEntry,
): {
  concern: ConcernKey;
  previous: number;
  current: number;
  delta: number;
} | null {
  let strongest: {
    concern: ConcernKey;
    previous: number;
    current: number;
    delta: number;
  } | null = null;
  for (const concern of CONCERN_KEYS) {
    const previousValue = previous.ratings?.[concern];
    const currentValue = current.ratings?.[concern];
    if (typeof previousValue !== 'number' || typeof currentValue !== 'number') {
      continue;
    }
    const delta = currentValue - previousValue;
    if (delta < 2) {
      continue;
    }
    if (!strongest || delta > strongest.delta) {
      strongest = {
        concern,
        previous: previousValue,
        current: currentValue,
        delta,
      };
    }
  }
  return strongest;
}

function strongestConcernTrend(
  firstWindow: SkinJournalEntry[],
  secondWindow: SkinJournalEntry[],
): {
  concern: ConcernKey;
  first_avg: number;
  second_avg: number;
  delta: number;
} | null {
  let strongest: {
    concern: ConcernKey;
    first_avg: number;
    second_avg: number;
    delta: number;
  } | null = null;
  for (const concern of CONCERN_KEYS) {
    const firstAvg = averageRating(firstWindow, concern);
    const secondAvg = averageRating(secondWindow, concern);
    if (firstAvg === null || secondAvg === null) {
      continue;
    }
    const delta = Number((secondAvg - firstAvg).toFixed(2));
    if (!strongest || Math.abs(delta) > Math.abs(strongest.delta)) {
      strongest = {
        concern,
        first_avg: firstAvg,
        second_avg: secondAvg,
        delta,
      };
    }
  }
  return strongest && Math.abs(strongest.delta) >= 0.5 ? strongest : null;
}

function averageRating(
  entries: SkinJournalEntry[],
  concern: ConcernKey,
): number | null {
  const values: number[] = [];
  for (const entry of entries) {
    const value = entry.ratings?.[concern];
    if (typeof value === 'number') {
      values.push(value);
    }
  }
  if (values.length === 0) {
    return null;
  }
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Number(average.toFixed(2));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

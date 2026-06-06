import { createHash } from 'crypto';
import {
  ApplicationItemSource,
  ApplicationItemStatus,
} from '../application-tracking/application-tracking.constants';
import { ProductCategory } from '../shelf/shelf.types';
import { SkinJournalEntry } from './entities/skin-journal-entry.entity';
import {
  ANALYSIS_CONCERNS,
  AnalysisConcern,
  AnalysisObservations,
  CONCERN_KEYS,
  ConcernKey,
  EventSeverity,
  InsightGenerationTrigger,
  InsightKind,
} from './skin-journal.constants';
import {
  barStripBlock,
  ctaLinkBlock,
  disclaimerBlock,
  dotStripBlock,
  entryThumbsBlock,
  eventStudyBlock,
  evidenceGradeBlock,
  faceHeatmapBlock,
  factorTableBlock,
  metricDeltaBlock,
  sourceLinkBlock,
  sparklineBlock,
  textBlock,
} from './insights/blocks';
import {
  InsightToneValue,
  type ConcernTrendFacts,
  type InsightCandidate,
  type InsightValue,
  type InsightValues,
} from './insights/insight-types';

export type DeterministicInsightCandidate = InsightCandidate;

interface BuildInsightsOptions {
  trigger?: InsightGenerationTrigger;
  generatedAt?: Date;
  aiSummaryEnabled?: boolean;
  aiPatternEnabled?: boolean;
  routineApplications?: RoutineApplicationEvidence[];
}

export interface RoutineApplicationEvidenceItem {
  step_order: number;
  suggestion_step_id: string | null;
  status: ApplicationItemStatus;
  step_label: string | null;
  inventory_product_id: string | null;
  substituted_with_product_id: string | null;
  applied_at: string | null;
  item_source: ApplicationItemSource;
  is_ad_hoc: boolean;
}

export interface RoutineApplicationEvidence {
  id: string;
  suggestion_instance_id: string | null;
  slot_id: string | null;
  target_date: string;
  target_time: string | null;
  daypart: string | null;
  updated_at: string | null;
  has_been_edited: boolean;
  items: RoutineApplicationEvidenceItem[];
}

interface CandidateInput {
  kind: InsightKind;
  severity: EventSeverity;
  confidence: number;
  headlineKey: string;
  headlineValues?: InsightValues;
  blocks: InsightCandidate['blocks'];
  actions?: InsightCandidate['actions'];
  caveats?: InsightCandidate['caveats'];
  sourceEntryIds: string[];
  timeWindow: { start: string; end: string };
  dataCutoffAt: string;
  trigger: InsightGenerationTrigger;
  referencedKbIds?: string[];
  facts: Record<
    string,
    InsightValue | InsightValue[] | Record<string, unknown>
  >;
  source?: InsightCandidate['metadata']['source'];
}

interface TrendInsightFacts {
  concern: ConcernKey | AnalysisConcern;
  first_avg: number;
  second_avg: number;
  delta: number;
  series: Array<{ x: string; y: number }>;
  evidence_source: 'rating' | 'photo_analysis';
  referenced_kb_ids: string[];
}

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
  options: BuildInsightsOptions = {},
): DeterministicInsightCandidate[] {
  const entries = [...entriesDesc].sort((a, b) =>
    a.entry_date.localeCompare(b.entry_date),
  );
  const latest = entries.at(-1);
  if (!latest) {
    return [];
  }

  const trigger = options.trigger ?? 'scheduled_refresh';
  const dataCutoffAt = (options.generatedAt ?? new Date()).toISOString();
  const timeWindow = {
    start: entries[0].entry_date,
    end: latest.entry_date,
  };
  const candidates: DeterministicInsightCandidate[] = [];

  candidates.push(
    onboardingProgressInsight(entries, timeWindow, dataCutoffAt, trigger),
  );

  if (latest.analysis_summary || latest.analysis_observations) {
    candidates.push(dailyInsight(latest, dataCutoffAt, trigger));
  }

  const weekly = entries.slice(-7);
  if (weekly.length >= 3) {
    candidates.push(weeklyInsight(weekly, dataCutoffAt, trigger));
  }

  if (entries.length >= 8) {
    const firstHalf = entries.slice(0, Math.floor(entries.length / 2));
    const secondHalf = entries.slice(Math.floor(entries.length / 2));
    const ratingTrend = strongestConcernTrend(firstHalf, secondHalf);
    const trend = ratingTrend
      ? ratingTrendInsightFacts(entries, ratingTrend)
      : strongestAnalysisConcernTrend(firstHalf, secondHalf, entries);
    if (trend) {
      candidates.push(
        trendInsight(entries, trend, timeWindow, dataCutoffAt, trigger),
      );
    }
  }

  if (entries.length >= 14) {
    candidates.push(monthlyInsight(entries, timeWindow, dataCutoffAt, trigger));
    const faceZone = faceZoneInsight(
      entries,
      timeWindow,
      dataCutoffAt,
      trigger,
    );
    if (faceZone) candidates.push(faceZone);
    const quality = photoQualityInsight(
      entries,
      timeWindow,
      dataCutoffAt,
      trigger,
    );
    if (quality) candidates.push(quality);
    const correlation = correlationInsight(
      entries,
      timeWindow,
      dataCutoffAt,
      trigger,
    );
    if (correlation) candidates.push(correlation);
    const cycle = cycleInsight(entries, timeWindow, dataCutoffAt, trigger);
    if (cycle) candidates.push(cycle);
  }

  const recovery = reactionRecoveryInsight(entries, dataCutoffAt, trigger);
  if (recovery) candidates.push(recovery);

  const routineAdherence = routineAdherenceInsight(
    entries,
    options.routineApplications ?? [],
    timeWindow,
    dataCutoffAt,
    trigger,
  );
  if (routineAdherence) candidates.push(routineAdherence);

  const referral = referralInsight(entries, dataCutoffAt, trigger);
  if (referral) candidates.push(referral);

  const effectiveness = effectivenessInsight(
    entries,
    options.routineApplications ?? [],
    timeWindow,
    dataCutoffAt,
    trigger,
  );
  if (effectiveness) candidates.push(effectiveness);

  const aiSummaryEnabled = options.aiSummaryEnabled ?? true;
  const aiPatternEnabled = options.aiPatternEnabled ?? true;
  if (entries.length >= 14 && (aiSummaryEnabled || aiPatternEnabled)) {
    if (aiSummaryEnabled) {
      candidates.push(
        aiSummaryInsight(entries, timeWindow, dataCutoffAt, trigger),
      );
    }
    if (aiPatternEnabled) {
      const aiPattern = aiPatternInsight(
        entries,
        timeWindow,
        dataCutoffAt,
        trigger,
      );
      if (aiPattern) candidates.push(aiPattern);
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

function onboardingProgressInsight(
  entries: SkinJournalEntry[],
  timeWindow: { start: string; end: string },
  dataCutoffAt: string,
  trigger: InsightGenerationTrigger,
): InsightCandidate {
  const nextUnlock = entries.length < 7 ? 7 : entries.length < 14 ? 14 : 30;
  const remaining = Math.max(nextUnlock - entries.length, 0);
  return candidate({
    kind: 'onboarding_progress',
    severity: 'info',
    confidence: 1,
    headlineKey: 'journal.insightsTab.headlines.onboarding_progress',
    headlineValues: { count: entries.length, nextUnlock },
    blocks: [
      textBlock('journal.insightsTab.blocks.onboarding_progress.text', {
        count: entries.length,
        remaining,
        nextUnlock,
      }),
      metricDeltaBlock({
        value: entries.length,
        previous: nextUnlock,
        direction: 'up_is_good',
        unit: 'entries',
        precision: 0,
      }),
      ctaLinkBlock('journal.insightsTab.actions.openTodayUpload', {
        kind: 'open_today_upload',
      }),
    ],
    sourceEntryIds: entries.map((entry) => entry.id),
    timeWindow,
    dataCutoffAt,
    trigger,
    facts: { count: entries.length, nextUnlock },
  });
}

function dailyInsight(
  latest: SkinJournalEntry,
  dataCutoffAt: string,
  trigger: InsightGenerationTrigger,
): InsightCandidate {
  const reaction = latest.analysis_observations?.reaction_signals;
  const hasReaction = reaction?.reaction_detected === true;
  return candidate({
    kind: 'daily',
    severity: hasReaction ? 'warning' : 'info',
    confidence: reaction?.confidence ?? 0.7,
    headlineKey: 'journal.insightsTab.headlines.daily',
    headlineValues: { date: latest.entry_date },
    blocks: [
      textBlock('journal.insightsTab.blocks.daily.analysis', {
        date: latest.entry_date,
        status: latest.analysis_status,
      }),
      ...(latest.analysis_observations
        ? [
            dotStripBlock([
              {
                x: latest.entry_date,
                tone: hasReaction ? 'warning' : 'positive',
                label: reaction?.reaction_severity ?? 'none',
              },
            ]),
          ]
        : []),
      entryThumbsBlock([latest.id], 1),
    ],
    sourceEntryIds: [latest.id],
    timeWindow: { start: latest.entry_date, end: latest.entry_date },
    dataCutoffAt,
    trigger,
    referencedKbIds: ['derm_acne_types'],
    facts: {
      entryDate: latest.entry_date,
      status: latest.analysis_status,
      reactionDetected: hasReaction,
      reactionSeverity: reaction?.reaction_severity ?? 'none',
    },
  });
}

function weeklyInsight(
  weekly: SkinJournalEntry[],
  dataCutoffAt: string,
  trigger: InsightGenerationTrigger,
): InsightCandidate {
  const reactionCount = weekly.filter((entry) =>
    isModerateOrSevereReaction(entry.analysis_observations),
  ).length;
  return candidate({
    kind: 'weekly',
    severity: reactionCount > 0 ? 'warning' : 'info',
    confidence: weekly.length / 7,
    headlineKey: 'journal.insightsTab.headlines.weekly',
    headlineValues: {
      entriesCount: weekly.length,
      reactionCount,
    },
    blocks: [
      textBlock('journal.insightsTab.blocks.weekly.recap', {
        entriesCount: weekly.length,
        reactionCount,
      }),
      barStripBlock(
        weekly.map((entry) => ({
          x: entry.entry_date,
          y: isModerateOrSevereReaction(entry.analysis_observations) ? 1 : 0,
          tone: isModerateOrSevereReaction(entry.analysis_observations)
            ? 'warning'
            : 'positive',
        })),
      ),
      entryThumbsBlock(weekly.map((entry) => entry.id)),
    ],
    sourceEntryIds: weekly.map((entry) => entry.id),
    timeWindow: {
      start: weekly[0].entry_date,
      end: weekly.at(-1)?.entry_date ?? weekly[0].entry_date,
    },
    dataCutoffAt,
    trigger,
    facts: {
      entriesCount: weekly.length,
      reactionCount,
    },
  });
}

function trendInsight(
  entries: SkinJournalEntry[],
  trend: TrendInsightFacts,
  timeWindow: { start: string; end: string },
  dataCutoffAt: string,
  trigger: InsightGenerationTrigger,
): InsightCandidate {
  const improved = trend.delta < 0;
  return candidate({
    kind: 'trend',
    severity: improved ? 'info' : 'warning',
    confidence: 0.78,
    headlineKey: 'journal.insightsTab.headlines.trend',
    headlineValues: {
      concern: trend.concern,
      direction: improved ? 'improved' : 'increased',
      delta: Math.abs(trend.delta),
    },
    blocks: [
      evidenceGradeBlock('moderate', {
        key: 'journal.insightsTab.evidenceGrade.basis.trend',
        values: { windowDays: entries.length },
      }),
      textBlock('journal.insightsTab.blocks.trend.explanation', {
        concern: trend.concern,
        direction: improved ? 'improved' : 'increased',
      }),
      sparklineBlock(trend.series, trend.first_avg),
      metricDeltaBlock({
        value: trend.second_avg,
        previous: trend.first_avg,
        direction: 'down_is_good',
      }),
      entryThumbsBlock(entries.slice(-6).map((entry) => entry.id)),
      ...trend.referenced_kb_ids.map((kbId) => sourceLinkBlock(kbId)),
    ],
    sourceEntryIds: entries.map((entry) => entry.id),
    timeWindow,
    dataCutoffAt,
    trigger,
    referencedKbIds: trend.referenced_kb_ids,
    facts: {
      concern: trend.concern,
      first_avg: trend.first_avg,
      second_avg: trend.second_avg,
      delta: trend.delta,
      evidence_source: trend.evidence_source,
    },
  });
}

function monthlyInsight(
  entries: SkinJournalEntry[],
  timeWindow: { start: string; end: string },
  dataCutoffAt: string,
  trigger: InsightGenerationTrigger,
): InsightCandidate {
  const photosCount = entries.filter((entry) => entry.photo_object_key).length;
  return candidate({
    kind: 'monthly',
    severity: 'info',
    confidence: Math.min(entries.length / 30, 1),
    headlineKey: 'journal.insightsTab.headlines.monthly',
    headlineValues: { entriesCount: entries.length, photosCount },
    blocks: [
      textBlock('journal.insightsTab.blocks.monthly.recap', {
        entriesCount: entries.length,
        photosCount,
      }),
      barStripBlock(
        entries.map((entry) => ({
          x: entry.entry_date,
          y: entry.photo_object_key ? 1 : 0,
          tone: entry.photo_object_key ? 'positive' : 'neutral',
        })),
      ),
    ],
    sourceEntryIds: entries.map((entry) => entry.id),
    timeWindow,
    dataCutoffAt,
    trigger,
    facts: { entriesCount: entries.length, photosCount },
  });
}

function reactionRecoveryInsight(
  entries: SkinJournalEntry[],
  dataCutoffAt: string,
  trigger: InsightGenerationTrigger,
): InsightCandidate | null {
  const latest = entries.at(-1);
  if (!latest) return null;
  const recentReactionIndex = entries
    .slice(0, -1)
    .findLastIndex((entry) =>
      isModerateOrSevereReaction(entry.analysis_observations),
    );
  if (
    recentReactionIndex < 0 ||
    latest.analysis_observations?.reaction_signals.reaction_detected !== false
  ) {
    return null;
  }
  const reactionEntry = entries[recentReactionIndex];
  const window = entries.slice(recentReactionIndex);
  return candidate({
    kind: 'reaction_recovery',
    severity: 'info',
    confidence: 0.72,
    headlineKey: 'journal.insightsTab.headlines.reaction_recovery',
    headlineValues: {
      recoveredOn: latest.entry_date,
      days: window.length,
    },
    blocks: [
      evidenceGradeBlock('moderate', {
        key: 'journal.insightsTab.evidenceGrade.basis.reaction_recovery',
      }),
      textBlock('journal.insightsTab.blocks.reaction_recovery.text', {
        days: window.length,
      }),
      dotStripBlock(
        window.map((entry) => ({
          x: entry.entry_date,
          tone: isModerateOrSevereReaction(entry.analysis_observations)
            ? 'warning'
            : 'positive',
        })),
      ),
      entryThumbsBlock([reactionEntry.id, latest.id]),
      sourceLinkBlock('derm_dry_skin_relief'),
    ],
    sourceEntryIds: [reactionEntry.id, latest.id],
    timeWindow: {
      start: reactionEntry.entry_date,
      end: latest.entry_date,
    },
    dataCutoffAt,
    trigger,
    referencedKbIds: ['derm_dry_skin_relief'],
    facts: {
      reactionEntryDate: reactionEntry.entry_date,
      recoveredOn: latest.entry_date,
      days: window.length,
    },
  });
}

function referralInsight(
  entries: SkinJournalEntry[],
  dataCutoffAt: string,
  trigger: InsightGenerationTrigger,
): InsightCandidate | null {
  const trailing = entries.slice(-7);
  const referralCount = trailing.filter((entry) =>
    isModerateOrSevereReaction(entry.analysis_observations),
  ).length;
  const doctorFlags = trailing.filter(
    (entry) => entry.analysis_observations?.should_flag_for_doctor === true,
  ).length;
  if (referralCount < 5 && doctorFlags < 3) {
    return null;
  }
  return candidate({
    kind: 'referral',
    severity: 'critical',
    confidence: 0.88,
    headlineKey: 'journal.insightsTab.headlines.referral',
    headlineValues: { referralCount, doctorFlags },
    blocks: [
      evidenceGradeBlock('strong', {
        key: 'journal.insightsTab.evidenceGrade.basis.referral',
      }),
      textBlock('journal.insightsTab.blocks.referral.text', {
        referralCount,
        doctorFlags,
      }),
      dotStripBlock(
        trailing.map((entry) => ({
          x: entry.entry_date,
          tone: isModerateOrSevereReaction(entry.analysis_observations)
            ? 'critical'
            : 'neutral',
        })),
      ),
      disclaimerBlock('journal.insightsTab.disclaimers.medical', 'critical'),
      sourceLinkBlock('derm_hives_emergency'),
      sourceLinkBlock('derm_contact_dermatitis_patch_testing'),
    ],
    actions: [
      {
        kind: 'view_entries',
        entry_ids: trailing.map((entry) => entry.id),
      },
    ],
    sourceEntryIds: trailing.map((entry) => entry.id),
    timeWindow: {
      start: trailing[0].entry_date,
      end: trailing.at(-1)?.entry_date ?? trailing[0].entry_date,
    },
    dataCutoffAt,
    trigger,
    referencedKbIds: [
      'derm_hives_emergency',
      'derm_contact_dermatitis_patch_testing',
    ],
    facts: { referralCount, doctorFlags },
  });
}

function effectivenessInsight(
  entries: SkinJournalEntry[],
  routineApplications: RoutineApplicationEvidence[],
  timeWindow: { start: string; end: string },
  dataCutoffAt: string,
  trigger: InsightGenerationTrigger,
): InsightCandidate | null {
  const productChange = entries.find((entry) =>
    ['started_new_product', 'stopped_a_product', 'changed_frequency'].includes(
      entry.recent_change?.kind ?? '',
    ),
  );
  if (!productChange || entries.length < 8) {
    return null;
  }
  const before = entries.filter(
    (entry) => entry.entry_date < productChange.entry_date,
  );
  const after = entries.filter(
    (entry) => entry.entry_date >= productChange.entry_date,
  );
  const trend = strongestConcernTrend(before, after);
  if (!trend || Math.abs(trend.delta) < 0.75) {
    return null;
  }
  const improved = trend.delta < 0;
  const productId =
    productChange.recent_change?.related_inventory_product_id ?? null;
  const applicationEvidence = productId
    ? productApplicationEvidence(
        routineApplications,
        productId,
        productChange.entry_date,
      )
    : null;
  if (productId && (!applicationEvidence || applicationEvidence.applied < 2)) {
    return null;
  }
  return candidate({
    kind: 'effectiveness',
    severity: improved ? 'info' : 'warning',
    confidence: 0.62,
    headlineKey: 'journal.insightsTab.headlines.effectiveness',
    headlineValues: {
      concern: trend.concern,
      direction: improved ? 'improved' : 'increased',
    },
    blocks: [
      evidenceGradeBlock('limited', {
        key: 'journal.insightsTab.evidenceGrade.basis.effectiveness',
      }),
      textBlock('journal.insightsTab.blocks.effectiveness.text', {
        concern: trend.concern,
      }),
      eventStudyBlock({
        before: ratingSeries(before, trend.concern),
        after: ratingSeries(after, trend.concern),
        marker: {
          x: productChange.entry_date,
          label: {
            key: 'journal.insightsTab.blocks.effectiveness.marker',
          },
        },
      }),
      metricDeltaBlock({
        value: trend.second_avg,
        previous: trend.first_avg,
        direction: 'down_is_good',
      }),
      ...(productId
        ? [
            ctaLinkBlock('journal.insightsTab.actions.openProduct', {
              kind: 'open_product',
              inventory_product_id: productId,
            }),
          ]
        : []),
      sourceLinkBlock('derm_6_8_week_acne_window'),
      disclaimerBlock('journal.insightsTab.disclaimers.correlation', 'neutral'),
    ],
    sourceEntryIds: after.map((entry) => entry.id),
    timeWindow,
    dataCutoffAt,
    trigger,
    referencedKbIds: ['derm_6_8_week_acne_window'],
    facts: {
      ...trend,
      productId,
      changeKind: productChange.recent_change?.kind ?? 'product_change',
      changeEntryDate: productChange.entry_date,
      routineAppliedCount: applicationEvidence?.applied ?? null,
      routineLoggedCount: applicationEvidence?.logged ?? null,
    },
  });
}

function routineAdherenceInsight(
  entries: SkinJournalEntry[],
  routineApplications: RoutineApplicationEvidence[],
  timeWindow: { start: string; end: string },
  dataCutoffAt: string,
  trigger: InsightGenerationTrigger,
): InsightCandidate | null {
  if (routineApplications.length < 5) {
    return null;
  }
  const rows = skippedCategoryRows(routineApplications);
  const sunProtectionCategory: string = ProductCategory.SunProtection;
  const top =
    rows.find((row) => row.category === sunProtectionCategory) ?? rows[0];
  if (!top || top.skipped < 2 || top.skipRate < 0.3) {
    return null;
  }
  const entryIds = entries
    .filter((entry) => top.dates.includes(entry.entry_date))
    .map((entry) => entry.id);
  return candidate({
    kind: 'routine_adherence',
    severity: 'warning',
    confidence: Math.min(0.78, 0.5 + top.skipRate / 2),
    headlineKey: 'journal.insightsTab.headlines.routine_adherence',
    headlineValues: {
      category: top.category,
      skippedCount: top.skipped,
    },
    blocks: [
      evidenceGradeBlock('anecdotal', {
        key: 'journal.insightsTab.evidenceGrade.basis.routine_adherence',
        values: { loggedCount: top.logged },
      }),
      textBlock('journal.insightsTab.blocks.routine_adherence.text', {
        category: top.category,
        skippedCount: top.skipped,
        loggedCount: top.logged,
      }),
      factorTableBlock(
        [
          {
            factor: {
              key: `journal.insightsTab.categories.${top.category}`,
            },
            effect: top.skipped,
            n: top.logged,
            tone: 'warning',
          },
        ],
        'entries',
      ),
      disclaimerBlock('journal.insightsTab.disclaimers.correlation', 'neutral'),
    ],
    sourceEntryIds: entryIds,
    timeWindow,
    dataCutoffAt,
    trigger,
    facts: {
      category: top.category,
      skippedCount: top.skipped,
      loggedCount: top.logged,
      skipRate: Number(top.skipRate.toFixed(2)),
    },
  });
}

function skippedCategoryRows(
  routineApplications: RoutineApplicationEvidence[],
): Array<{
  category: string;
  skipped: number;
  logged: number;
  skipRate: number;
  dates: string[];
}> {
  const byCategory = new Map<
    string,
    { skipped: number; logged: number; dates: Set<string> }
  >();
  for (const application of routineApplications) {
    for (const item of application.items) {
      if (
        item.is_ad_hoc ||
        item.item_source !== ApplicationItemSource.Recommended
      ) {
        continue;
      }
      const category = item.step_label;
      if (!category) {
        continue;
      }
      const row = byCategory.get(category) ?? {
        skipped: 0,
        logged: 0,
        dates: new Set<string>(),
      };
      row.logged += 1;
      if (item.status === ApplicationItemStatus.Skipped) {
        row.skipped += 1;
        row.dates.add(application.target_date);
      }
      byCategory.set(category, row);
    }
  }

  return [...byCategory.entries()]
    .map(([category, row]) => ({
      category,
      skipped: row.skipped,
      logged: row.logged,
      skipRate: row.logged > 0 ? row.skipped / row.logged : 0,
      dates: [...row.dates].sort(),
    }))
    .sort((left, right) => {
      if (right.skipped !== left.skipped) {
        return right.skipped - left.skipped;
      }
      return right.skipRate - left.skipRate;
    });
}

function productApplicationEvidence(
  routineApplications: RoutineApplicationEvidence[],
  productId: string,
  startDate: string,
): { applied: number; logged: number } | null {
  let applied = 0;
  let logged = 0;
  for (const application of routineApplications) {
    if (application.target_date < startDate) {
      continue;
    }
    for (const item of application.items) {
      const matchedProduct =
        item.inventory_product_id === productId ||
        item.substituted_with_product_id === productId;
      if (!matchedProduct) {
        continue;
      }
      logged += 1;
      if (
        item.status === ApplicationItemStatus.Applied ||
        item.status === ApplicationItemStatus.Substituted
      ) {
        applied += 1;
      }
    }
  }
  return logged > 0 ? { applied, logged } : null;
}

function faceZoneInsight(
  entries: SkinJournalEntry[],
  timeWindow: { start: string; end: string },
  dataCutoffAt: string,
  trigger: InsightGenerationTrigger,
): InsightCandidate | null {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const concern of entry.analysis_observations?.detected_concerns ??
      []) {
      if (concern.confidence < 0.55) continue;
      for (const location of concern.locations) {
        const key = `${concern.concern}:${location}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top || top[1] < 3) {
    return null;
  }
  const [concern, location] = top[0].split(':');
  const zones = [...counts.entries()]
    .filter(([key]) => key.startsWith(`${concern}:`))
    .map(([key, count]) => ({
      location: key.split(':')[1],
      concern: concern as Parameters<
        typeof faceHeatmapBlock
      >[0][number]['concern'],
      weight: Number(Math.min(count / top[1], 1).toFixed(2)),
    }));
  return candidate({
    kind: 'face_zone_pattern',
    severity: 'info',
    confidence: 0.68,
    headlineKey: 'journal.insightsTab.headlines.face_zone_pattern',
    headlineValues: { concern, location, count: top[1] },
    blocks: [
      evidenceGradeBlock('anecdotal', {
        key: 'journal.insightsTab.evidenceGrade.basis.ownLogs',
      }),
      textBlock('journal.insightsTab.blocks.face_zone_pattern.text', {
        concern,
        location,
      }),
      faceHeatmapBlock(zones),
      metricDeltaBlock({
        value: top[1],
        previous: entries.length,
        direction: 'neutral',
        unit: 'entries',
        precision: 0,
      }),
    ],
    sourceEntryIds: entries.map((entry) => entry.id),
    timeWindow,
    dataCutoffAt,
    trigger,
    referencedKbIds: ['derm_acne_types'],
    facts: { concern, location, count: top[1] },
  });
}

function photoQualityInsight(
  entries: SkinJournalEntry[],
  timeWindow: { start: string; end: string },
  dataCutoffAt: string,
  trigger: InsightGenerationTrigger,
): InsightCandidate | null {
  const withAnalysis = entries.filter((entry) => entry.analysis_observations);
  if (withAnalysis.length < 5) return null;
  const poor = withAnalysis.filter(
    (entry) =>
      entry.analysis_observations?.image_quality.needs_retake === true ||
      entry.analysis_observations?.image_quality.lighting_quality === 'poor',
  );
  if (poor.length < 3) return null;
  return candidate({
    kind: 'photo_quality_drift',
    severity: 'info',
    confidence: 0.74,
    headlineKey: 'journal.insightsTab.headlines.photo_quality_drift',
    headlineValues: { poorCount: poor.length },
    blocks: [
      textBlock('journal.insightsTab.blocks.photo_quality_drift.text', {
        poorCount: poor.length,
      }),
      barStripBlock(
        withAnalysis.slice(-7).map((entry) => ({
          x: entry.entry_date,
          y: entry.analysis_observations?.image_quality.quality_score ?? 0.5,
          tone:
            entry.analysis_observations?.image_quality.needs_retake === true
              ? 'warning'
              : 'positive',
        })),
      ),
      ctaLinkBlock('journal.insightsTab.actions.openTodayUpload', {
        kind: 'open_today_upload',
      }),
    ],
    sourceEntryIds: poor.map((entry) => entry.id),
    timeWindow,
    dataCutoffAt,
    trigger,
    referencedKbIds: ['derm_dry_skin_relief'],
    facts: { poorCount: poor.length },
  });
}

function correlationInsight(
  entries: SkinJournalEntry[],
  timeWindow: { start: string; end: string },
  dataCutoffAt: string,
  trigger: InsightGenerationTrigger,
): InsightCandidate | null {
  const highStress = entries.filter((entry) => entry.stress_today === 'high');
  const other = entries.filter((entry) => entry.stress_today !== 'high');
  const highStressRedness = averageRating(highStress, 'redness');
  const baselineRedness = averageRating(other, 'redness');
  if (
    highStress.length < 3 ||
    highStressRedness === null ||
    baselineRedness === null
  ) {
    return null;
  }
  const effect = Number((highStressRedness - baselineRedness).toFixed(2));
  if (Math.abs(effect) < 0.5) return null;
  return candidate({
    kind: 'correlation',
    severity: effect > 0 ? 'warning' : 'info',
    confidence: 0.58,
    headlineKey: 'journal.insightsTab.headlines.correlation',
    headlineValues: { factor: 'stress_today', concern: 'redness' },
    blocks: [
      evidenceGradeBlock('anecdotal', {
        key: 'journal.insightsTab.evidenceGrade.basis.ownLogs',
      }),
      textBlock('journal.insightsTab.blocks.correlation.text', {
        factor: 'stress_today',
        concern: 'redness',
      }),
      factorTableBlock(
        [
          {
            factor: { key: 'journal.insightsTab.factors.highStress' },
            effect,
            n: highStress.length,
            tone: effect > 0 ? 'warning' : 'positive',
          },
        ],
        'rating',
      ),
      disclaimerBlock('journal.insightsTab.disclaimers.correlation', 'neutral'),
    ],
    sourceEntryIds: highStress.map((entry) => entry.id),
    timeWindow,
    dataCutoffAt,
    trigger,
    referencedKbIds: ['derm_contact_dermatitis_patch_testing'],
    facts: { factor: 'stress_today', concern: 'redness', effect },
  });
}

function cycleInsight(
  entries: SkinJournalEntry[],
  timeWindow: { start: string; end: string },
  dataCutoffAt: string,
  trigger: InsightGenerationTrigger,
): InsightCandidate | null {
  const phaseEntries = entries.filter(
    (entry) => entry.cycle_marker && entry.cycle_marker !== 'dont_track',
  );
  if (phaseEntries.length < 6) return null;
  const phaseRows = ['day_1_3', 'day_4_7', 'late_cycle']
    .map((phase) => {
      const entriesInPhase = phaseEntries.filter(
        (entry) => entry.cycle_marker === phase,
      );
      return {
        phase,
        avg: averageRating(entriesInPhase, 'breakouts'),
        n: entriesInPhase.length,
      };
    })
    .filter((row): row is { phase: string; avg: number; n: number } => {
      return row.avg !== null && row.n > 0;
    })
    .sort((a, b) => b.avg - a.avg);
  const top = phaseRows[0];
  if (!top || top.n < 2) return null;
  return candidate({
    kind: 'cycle',
    severity: 'info',
    confidence: 0.54,
    headlineKey: 'journal.insightsTab.headlines.cycle',
    headlineValues: { phase: top.phase, concern: 'breakouts' },
    blocks: [
      evidenceGradeBlock('moderate', {
        key: 'journal.insightsTab.evidenceGrade.basis.cycle',
      }),
      textBlock('journal.insightsTab.blocks.cycle.text', {
        phase: top.phase,
      }),
      factorTableBlock(
        phaseRows.map((row) => ({
          factor: { key: `journal.checkIn.cycle.${row.phase}` },
          effect: row.avg,
          n: row.n,
          tone: row.phase === top.phase ? 'warning' : 'neutral',
        })),
        'rating',
      ),
      sourceLinkBlock('derm_hormonal_acne_therapy'),
      sourceLinkBlock('pubmed_menstrual_cycle_acne'),
    ],
    sourceEntryIds: phaseEntries.map((entry) => entry.id),
    timeWindow,
    dataCutoffAt,
    trigger,
    referencedKbIds: [
      'derm_hormonal_acne_therapy',
      'pubmed_menstrual_cycle_acne',
    ],
    facts: { phase: top.phase, avg: top.avg, n: top.n },
  });
}

function aiSummaryInsight(
  entries: SkinJournalEntry[],
  timeWindow: { start: string; end: string },
  dataCutoffAt: string,
  trigger: InsightGenerationTrigger,
): InsightCandidate {
  const reactionCount = entries.filter((entry) =>
    isModerateOrSevereReaction(entry.analysis_observations),
  ).length;
  return candidate({
    kind: 'ai_summary',
    severity: reactionCount >= 3 ? 'warning' : 'info',
    confidence: 0.66,
    headlineKey: 'journal.insightsTab.headlines.ai_summary',
    headlineValues: { entriesCount: entries.length, reactionCount },
    blocks: [
      textBlock(
        'journal.insightsTab.blocks.ai_summary.text',
        {
          entriesCount: entries.length,
          reactionCount,
        },
        InsightToneValue.Ai,
      ),
      disclaimerBlock('journal.insightsTab.ai.provenance', InsightToneValue.Ai),
    ],
    sourceEntryIds: entries.slice(-14).map((entry) => entry.id),
    timeWindow,
    dataCutoffAt,
    trigger,
    referencedKbIds: ['derm_6_8_week_acne_window'],
    facts: { entriesCount: entries.length, reactionCount },
    source: 'ai_sourced',
  });
}

function aiPatternInsight(
  entries: SkinJournalEntry[],
  timeWindow: { start: string; end: string },
  dataCutoffAt: string,
  trigger: InsightGenerationTrigger,
): InsightCandidate | null {
  const travelEntries = entries.filter(
    (entry) => entry.recent_change?.kind === 'travelled',
  );
  if (travelEntries.length < 2) return null;
  return candidate({
    kind: 'ai_pattern',
    severity: 'info',
    confidence: 0.52,
    headlineKey: 'journal.insightsTab.headlines.ai_pattern',
    headlineValues: { factor: 'travelled' },
    blocks: [
      evidenceGradeBlock('anecdotal', {
        key: 'journal.insightsTab.evidenceGrade.basis.ownLogs',
      }),
      textBlock(
        'journal.insightsTab.blocks.ai_pattern.text',
        {
          factor: 'travelled',
        },
        InsightToneValue.Ai,
      ),
      factorTableBlock([
        {
          factor: { key: 'journal.insightsTab.factors.travelled' },
          effect: travelEntries.length,
          n: travelEntries.length,
          tone: 'neutral',
        },
      ]),
      disclaimerBlock('journal.insightsTab.ai.provenance', InsightToneValue.Ai),
    ],
    sourceEntryIds: travelEntries.map((entry) => entry.id),
    timeWindow,
    dataCutoffAt,
    trigger,
    facts: { factor: 'travelled', n: travelEntries.length },
    source: 'ai_sourced',
  });
}

function strongestConcernTrend(
  firstWindow: SkinJournalEntry[],
  secondWindow: SkinJournalEntry[],
): ConcernTrendFacts | null {
  let strongest: ConcernTrendFacts | null = null;
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

function ratingTrendInsightFacts(
  entries: SkinJournalEntry[],
  trend: ConcernTrendFacts,
): TrendInsightFacts {
  return {
    ...trend,
    series: ratingSeries(entries, trend.concern),
    evidence_source: 'rating',
    referenced_kb_ids: ['derm_6_8_week_acne_window'],
  };
}

function strongestAnalysisConcernTrend(
  firstWindow: SkinJournalEntry[],
  secondWindow: SkinJournalEntry[],
  entries: SkinJournalEntry[],
): TrendInsightFacts | null {
  let strongest: TrendInsightFacts | null = null;
  for (const concern of ANALYSIS_CONCERNS) {
    const firstAvg = averageAnalysisConcernSeverity(firstWindow, concern);
    const secondAvg = averageAnalysisConcernSeverity(secondWindow, concern);
    if (firstAvg === null || secondAvg === null) {
      continue;
    }
    const delta = Number((secondAvg - firstAvg).toFixed(2));
    if (Math.abs(delta) < 0.5) {
      continue;
    }
    const candidateTrend: TrendInsightFacts = {
      concern,
      first_avg: firstAvg,
      second_avg: secondAvg,
      delta,
      series: analysisConcernSeveritySeries(entries, concern),
      evidence_source: 'photo_analysis',
      referenced_kb_ids: analysisConcernKnowledgeBaseIds(concern),
    };
    if (
      !strongest ||
      Math.abs(candidateTrend.delta) > Math.abs(strongest.delta)
    ) {
      strongest = candidateTrend;
    }
  }
  return strongest;
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

function averageAnalysisConcernSeverity(
  entries: SkinJournalEntry[],
  concern: AnalysisConcern,
): number | null {
  const series = analysisConcernSeveritySeries(entries, concern);
  if (series.length < Math.max(2, Math.ceil(entries.length / 2))) {
    return null;
  }
  const total = series.reduce((sum, point) => sum + point.y, 0);
  return Number((total / series.length).toFixed(2));
}

function ratingSeries(
  entries: SkinJournalEntry[],
  concern: ConcernKey,
): Array<{ x: string; y: number }> {
  const series: Array<{ x: string; y: number }> = [];
  for (const entry of entries) {
    const value = entry.ratings?.[concern];
    if (typeof value === 'number') {
      series.push({ x: entry.entry_date, y: value });
    }
  }
  return series;
}

function analysisConcernSeveritySeries(
  entries: SkinJournalEntry[],
  concern: AnalysisConcern,
): Array<{ x: string; y: number }> {
  return entries.flatMap((entry) => {
    if (!isTrendEligibleObservation(entry.analysis_observations)) {
      return [];
    }
    return [
      {
        x: entry.entry_date,
        y: maxAnalysisConcernSeverity(entry.analysis_observations, concern),
      },
    ];
  });
}

function isTrendEligibleObservation(
  observations: AnalysisObservations | null,
): observations is AnalysisObservations {
  return (
    observations?.image_quality.face_detected === true &&
    observations.image_quality.lighting_quality !== 'poor' &&
    observations.image_quality.framing_quality !== 'poor' &&
    observations.image_quality.blur_detected !== true
  );
}

function maxAnalysisConcernSeverity(
  observations: AnalysisObservations,
  concern: AnalysisConcern,
): number {
  const scores = observations.detected_concerns
    .filter((item) => item.concern === concern && item.confidence >= 0.55)
    .map((item) => analysisConcernSeverityScore(item.severity));
  return scores.length > 0 ? Math.max(...scores) : 0;
}

function analysisConcernSeverityScore(severity: string): number {
  if (severity === 'severe') return 3;
  if (severity === 'moderate') return 2;
  if (severity === 'mild') return 1;
  return 0;
}

function analysisConcernKnowledgeBaseIds(concern: AnalysisConcern): string[] {
  if (concern === 'hyperpigmentation' || concern === 'uneven_tone') {
    return ['derm_skin_of_color_acne'];
  }
  if (concern === 'acne') {
    return ['derm_6_8_week_acne_window'];
  }
  if (concern === 'skin_barrier_damage' || concern === 'dryness') {
    return ['derm_dry_skin_relief'];
  }
  return [];
}

function candidate(input: CandidateInput): InsightCandidate {
  const factsHash = hashFacts(input.kind, input.facts);
  const referencedKbIds = input.referencedKbIds ?? [];
  return {
    kind: input.kind,
    severity: input.severity,
    confidence: Number(input.confidence.toFixed(2)),
    headline: {
      key: input.headlineKey,
      values: input.headlineValues,
      text: null,
    },
    blocks: [
      ...input.blocks,
      ...referencedKbIds
        .filter((kbId) =>
          input.blocks.every(
            (block) => block.type !== 'source_link' || block.kb_id !== kbId,
          ),
        )
        .map((kbId) => sourceLinkBlock(kbId)),
    ],
    actions: input.actions ?? [
      { kind: 'view_entries', entry_ids: input.sourceEntryIds },
      { kind: 'dismiss' },
    ],
    caveats: input.caveats ?? [],
    source_entry_ids: input.sourceEntryIds,
    time_window: input.timeWindow,
    data_cutoff_at: input.dataCutoffAt,
    generation_trigger: input.trigger,
    metadata: {
      source: input.source ?? 'deterministic',
      model: null,
      prompt_version: null,
      facts_hash: factsHash,
      cache_hit: false,
      duration_ms: 0,
    },
    referenced_kb_ids: referencedKbIds,
    insight_signature: `${input.kind}:${factsHash}`,
  };
}

function hashFacts(
  kind: InsightKind,
  facts: Record<
    string,
    InsightValue | InsightValue[] | Record<string, unknown>
  >,
): string {
  return createHash('sha256')
    .update(stableStringify({ kind, facts }))
    .digest('hex')
    .slice(0, 24);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

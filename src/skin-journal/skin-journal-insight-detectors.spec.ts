import { SkinJournalEntry } from './entities/skin-journal-entry.entity';
import { AnalysisObservations } from './skin-journal.constants';
import {
  buildDeterministicInsights,
  isModerateOrSevereReaction,
  strongestWorsening,
  type RoutineApplicationEvidence,
} from './skin-journal-insight-detectors';

function observations(
  overrides: Partial<AnalysisObservations['reaction_signals']> = {},
): AnalysisObservations {
  return {
    schema_version: '1.0',
    model_version: 'test',
    image_quality: {
      face_detected: true,
      lighting_quality: 'good',
      framing_quality: 'good',
      blur_detected: false,
      issues: [],
    },
    detected_concerns: [],
    reaction_signals: {
      reaction_detected: false,
      reaction_severity: 'none',
      indicators: [],
      confidence: 0.1,
      ...overrides,
    },
    barrier_signs: { barrier_compromise: false, indicators: [] },
    overall_assessment: 'Stable.',
    should_flag_for_doctor: false,
  };
}

function observationsWith(
  overrides: Partial<AnalysisObservations> = {},
): AnalysisObservations {
  const base = observations();
  return {
    ...base,
    ...overrides,
    image_quality: {
      ...base.image_quality,
      ...overrides.image_quality,
    },
    reaction_signals: {
      ...base.reaction_signals,
      ...overrides.reaction_signals,
    },
    barrier_signs: {
      ...base.barrier_signs,
      ...overrides.barrier_signs,
    },
  };
}

function entry(
  id: string,
  entryDate: string,
  overrides: Partial<SkinJournalEntry> = {},
): SkinJournalEntry {
  return {
    id,
    entry_date: entryDate,
    analysis_status: 'completed',
    analysis_observations: observations(),
    analysis_summary: null,
    photo_object_key: null,
    ratings: null,
    recent_change: null,
    ...overrides,
  } as SkinJournalEntry;
}

function routineApplication(
  targetDate: string,
  overrides: Partial<RoutineApplicationEvidence> = {},
): RoutineApplicationEvidence {
  return {
    id: `application-${targetDate}`,
    suggestion_instance_id: `suggestion-${targetDate}`,
    slot_id: null,
    target_date: targetDate,
    target_time: '08:00',
    daypart: 'morning',
    updated_at: `${targetDate}T09:00:00.000Z`,
    has_been_edited: false,
    items: [
      {
        step_order: 0,
        suggestion_step_id: null,
        status: 'applied',
        step_label: 'moisturizer',
        inventory_product_id: 'moisturizer-1',
        substituted_with_product_id: null,
        applied_at: `${targetDate}T07:30:00.000Z`,
        item_source: 'recommended',
        is_ad_hoc: false,
      },
    ],
    ...overrides,
  };
}

describe('skin journal insight detectors', () => {
  it('detects moderate or severe reactions only above the confidence threshold', () => {
    expect(
      isModerateOrSevereReaction(
        observations({
          reaction_detected: true,
          reaction_severity: 'moderate',
          confidence: 0.6,
        }),
      ),
    ).toBe(true);
    expect(
      isModerateOrSevereReaction(
        observations({
          reaction_detected: true,
          reaction_severity: 'moderate',
          confidence: 0.59,
        }),
      ),
    ).toBe(false);
  });

  it('builds daily and weekly candidates from recent entries', () => {
    const entries = [
      entry('entry-1', '2026-04-01'),
      entry('entry-2', '2026-04-02'),
      entry('entry-3', '2026-04-03', {
        analysis_summary: 'Looks calmer today.',
      }),
    ];

    const candidates = buildDeterministicInsights(entries.reverse());

    expect(candidates.map((candidate) => candidate.kind)).toEqual([
      'onboarding_progress',
      'daily',
      'weekly',
    ]);
    expect(candidates[1]).toMatchObject({
      kind: 'daily',
      source_entry_ids: ['entry-3'],
      headline: {
        key: 'journal.insightsTab.headlines.daily',
      },
    });
    expect(candidates[1]).toHaveProperty('blocks');
    expect(candidates[1]).not.toHaveProperty('summary');
    expect(candidates[1]).not.toHaveProperty('supporting_data');
  });

  it('returns no deterministic insights before the first entry exists', () => {
    expect(buildDeterministicInsights([])).toEqual([]);
  });

  it('emits trusted-source citations and evidence blocks for claim-bearing insights', () => {
    const entries = Array.from({ length: 8 }, (_, index) =>
      entry(
        `entry-${index + 1}`,
        `2026-04-${String(index + 1).padStart(2, '0')}`,
        {
          ratings: {
            breakouts: index < 4 ? 4 : 2,
            redness: 2,
          },
        },
      ),
    );

    const candidates = buildDeterministicInsights(entries.reverse());
    const trend = candidates.find((candidate) => candidate.kind === 'trend');

    expect(trend).toBeDefined();
    expect(trend?.referenced_kb_ids).toContain('derm_6_8_week_acne_window');
    expect(trend?.blocks.map((block) => block.type)).toEqual(
      expect.arrayContaining(['evidence_grade', 'sparkline', 'metric_delta']),
    );
    expect(trend?.insight_signature).toMatch(/^trend:/);
    expect(trend?.headline.values).toMatchObject({ concern: 'breakouts' });
  });

  it('builds trend insights from repeated photo analysis concern severity', () => {
    const severities: ReadonlyArray<'mild' | 'moderate' | 'severe' | null> = [
      'severe',
      'severe',
      'moderate',
      'moderate',
      'mild',
      'mild',
      null,
      null,
    ];
    const entries = severities.map((severity, index) =>
      entry(
        `entry-${index + 1}`,
        `2026-04-${String(index + 1).padStart(2, '0')}`,
        {
          analysis_observations: observationsWith({
            detected_concerns: severity
              ? [
                  {
                    concern: 'hyperpigmentation',
                    severity,
                    locations: ['cheek'],
                    confidence: 0.82,
                  },
                ]
              : [],
          }),
        },
      ),
    );

    const trend = buildDeterministicInsights(entries.reverse(), {
      aiSummaryEnabled: false,
      aiPatternEnabled: false,
    }).find((candidate) => candidate.kind === 'trend');

    expect(trend).toMatchObject({
      kind: 'trend',
      severity: 'info',
      headline: {
        values: expect.objectContaining({
          concern: 'hyperpigmentation',
          direction: 'improved',
        }),
      },
      metadata: expect.objectContaining({ source: 'deterministic' }),
    });
    expect(trend?.referenced_kb_ids).toContain('derm_skin_of_color_acne');
    expect(trend?.blocks.map((block) => block.type)).toContain('sparkline');
  });

  it('can disable AI sourced summary and pattern candidates', () => {
    const entries = Array.from({ length: 14 }, (_, index) =>
      entry(
        `entry-${index + 1}`,
        `2026-04-${String(index + 1).padStart(2, '0')}`,
        {
          ratings: {
            breakouts: 2,
            redness: 2,
          },
          recent_change:
            index === 3 || index === 9 ? { kind: 'travelled' } : null,
        },
      ),
    );

    const candidates = buildDeterministicInsights(entries.reverse(), {
      aiSummaryEnabled: false,
      aiPatternEnabled: false,
    });
    const kinds = candidates.map((candidate) => candidate.kind);

    expect(kinds).not.toContain('ai_summary');
    expect(kinds).not.toContain('ai_pattern');
  });

  it('builds long-window insights from trend, quality, cycle, factor, and product evidence', () => {
    const entries = Array.from({ length: 14 }, (_, index) => {
      const day = index + 1;
      const highStress = [1, 4, 7].includes(day);
      const cycleMarker =
        day <= 3 ? 'day_1_3' : day <= 7 ? 'day_4_7' : 'late_cycle';
      const recentChange =
        day === 4 || day === 10
          ? { kind: 'travelled' as const }
          : day === 8
            ? {
                kind: 'started_new_product' as const,
                related_inventory_product_id: 'product-1',
              }
            : null;

      return entry(`entry-${day}`, `2026-04-${String(day).padStart(2, '0')}`, {
        analysis_observations: observationsWith({
          image_quality: {
            face_detected: true,
            lighting_quality: day <= 3 ? 'poor' : 'good',
            framing_quality: 'good',
            blur_detected: false,
            issues: [],
            quality_score: day <= 3 ? 0.2 : 0.9,
            needs_retake: day <= 3,
          },
          detected_concerns: [
            {
              concern: 'acne',
              severity: 'moderate',
              locations: ['chin'],
              confidence: 0.8,
            },
          ],
        }),
        photo_object_key: day % 2 === 0 ? `photo-${day}.jpg` : null,
        ratings: {
          breakouts: day < 8 ? 4 : 2,
          redness: highStress ? 5 : 2,
          dryness: 2,
        },
        stress_today: highStress ? 'high' : 'low',
        cycle_marker: cycleMarker,
        recent_change: recentChange,
      });
    });

    const kinds = buildDeterministicInsights(entries.reverse(), {
      generatedAt: new Date('2026-05-04T10:00:00.000Z'),
      routineApplications: [
        routineApplication('2026-04-08', {
          items: [
            {
              step_order: 0,
              suggestion_step_id: null,
              status: 'applied',
              step_label: 'serum',
              inventory_product_id: 'product-1',
              substituted_with_product_id: null,
              applied_at: '2026-04-08T08:00:00.000Z',
              item_source: 'recommended',
              is_ad_hoc: false,
            },
          ],
        }),
        routineApplication('2026-04-10', {
          items: [
            {
              step_order: 0,
              suggestion_step_id: null,
              status: 'applied',
              step_label: 'serum',
              inventory_product_id: 'product-1',
              substituted_with_product_id: null,
              applied_at: '2026-04-10T08:00:00.000Z',
              item_source: 'recommended',
              is_ad_hoc: false,
            },
          ],
        }),
      ],
    }).map((candidate) => candidate.kind);

    expect(kinds).toEqual(
      expect.arrayContaining([
        'monthly',
        'trend',
        'face_zone_pattern',
        'photo_quality_drift',
        'correlation',
        'cycle',
        'effectiveness',
        'ai_summary',
        'ai_pattern',
      ]),
    );
  });

  it('detects recovery after a reaction and escalates repeated referral signals', () => {
    const entries = Array.from({ length: 8 }, (_, index) => {
      const day = index + 1;
      const reactionDetected = day >= 2 && day <= 6;
      return entry(`entry-${day}`, `2026-04-${String(day).padStart(2, '0')}`, {
        analysis_observations: observationsWith({
          reaction_signals: {
            reaction_detected: reactionDetected,
            reaction_severity: reactionDetected ? 'moderate' : 'none',
            indicators: reactionDetected ? ['redness'] : [],
            confidence: reactionDetected ? 0.8 : 0.8,
          },
          should_flag_for_doctor: day >= 4 && day <= 6,
        }),
      });
    });

    const candidates = buildDeterministicInsights(entries.reverse());
    const kinds = candidates.map((candidate) => candidate.kind);

    expect(kinds).toContain('reaction_recovery');
    expect(kinds).toContain('referral');
  });

  it('keeps optional insights quiet when evidence is too thin', () => {
    const entries = Array.from({ length: 14 }, (_, index) =>
      entry(
        `entry-${index + 1}`,
        `2026-04-${String(index + 1).padStart(2, '0')}`,
        {
          analysis_observations: observationsWith({
            detected_concerns: [
              {
                concern: 'acne',
                severity: 'mild',
                locations: ['forehead'],
                confidence: 0.4,
              },
            ],
          }),
          ratings: { breakouts: 2, redness: 2 },
          stress_today: 'low',
          cycle_marker: index % 2 === 0 ? 'dont_track' : null,
        },
      ),
    );

    const kinds = buildDeterministicInsights(entries.reverse(), {
      aiSummaryEnabled: false,
      aiPatternEnabled: false,
    }).map((candidate) => candidate.kind);

    expect(kinds).not.toContain('face_zone_pattern');
    expect(kinds).not.toContain('photo_quality_drift');
    expect(kinds).not.toContain('correlation');
    expect(kinds).not.toContain('cycle');
    expect(kinds).not.toContain('effectiveness');
  });

  it('builds a routine adherence insight from repeated recorded sunscreen skips', () => {
    const entries = Array.from({ length: 10 }, (_, index) => {
      const day = index + 1;
      return entry(`entry-${day}`, `2026-04-${String(day).padStart(2, '0')}`, {
        ratings: { breakouts: 2, redness: 2 },
        sun_exposure_today: day <= 4 ? 'lots' : 'brief',
      });
    });
    const routineApplications = entries.map((item, index) => {
      const skippedSunProtection = index < 4;
      return routineApplication(item.entry_date, {
        items: [
          {
            step_order: 0,
            suggestion_step_id: null,
            status: skippedSunProtection ? 'skipped' : 'applied',
            step_label: 'sun-protection',
            inventory_product_id: 'spf-1',
            substituted_with_product_id: null,
            applied_at: skippedSunProtection
              ? null
              : `${item.entry_date}T07:30:00.000Z`,
            item_source: 'recommended',
            is_ad_hoc: false,
          },
        ],
      });
    });

    const routineInsight = buildDeterministicInsights(entries.reverse(), {
      routineApplications,
      aiSummaryEnabled: false,
      aiPatternEnabled: false,
    }).find((candidate) => candidate.kind === 'routine_adherence');

    expect(routineInsight).toMatchObject({
      severity: 'warning',
      confidence: expect.any(Number),
      headline: {
        key: 'journal.insightsTab.headlines.routine_adherence',
        values: {
          category: 'sun-protection',
          skippedCount: 4,
        },
      },
      metadata: expect.objectContaining({ source: 'deterministic' }),
    });
    expect(routineInsight?.blocks.map((block) => block.type)).toEqual(
      expect.arrayContaining(['evidence_grade', 'factor_table', 'disclaimer']),
    );
    expect(routineInsight?.source_entry_ids).toEqual([
      'entry-1',
      'entry-2',
      'entry-3',
      'entry-4',
    ]);
  });

  it('does not build routine adherence from skipped ad-hoc application items', () => {
    const entries = Array.from({ length: 10 }, (_, index) => {
      const day = index + 1;
      return entry(`entry-${day}`, `2026-04-${String(day).padStart(2, '0')}`, {
        ratings: { breakouts: 2, redness: 2 },
      });
    });
    const routineApplications = entries.map((item, index) =>
      routineApplication(item.entry_date, {
        items: [
          {
            step_order: 0,
            suggestion_step_id: null,
            status: index < 4 ? 'skipped' : 'applied',
            step_label: 'sun-protection',
            inventory_product_id: 'spf-1',
            substituted_with_product_id: null,
            applied_at: index < 4 ? null : `${item.entry_date}T07:30:00.000Z`,
            item_source: 'added_shelf',
            is_ad_hoc: true,
          },
        ],
      }),
    );

    const kinds = buildDeterministicInsights(entries.reverse(), {
      routineApplications,
      aiSummaryEnabled: false,
      aiPatternEnabled: false,
    }).map((candidate) => candidate.kind);

    expect(kinds).not.toContain('routine_adherence');
  });

  it('requires recorded application evidence before emitting product-specific effectiveness', () => {
    const entries = Array.from({ length: 10 }, (_, index) => {
      const day = index + 1;
      return entry(`entry-${day}`, `2026-04-${String(day).padStart(2, '0')}`, {
        ratings: { redness: day < 6 ? 5 : 2 },
        recent_change:
          day === 6
            ? {
                kind: 'started_new_product' as const,
                related_inventory_product_id: 'product-1',
              }
            : null,
      });
    });

    const withoutUsage = buildDeterministicInsights(entries.reverse(), {
      routineApplications: [],
    });
    const withUsage = buildDeterministicInsights(entries.reverse(), {
      routineApplications: [
        routineApplication('2026-04-06', {
          items: [
            {
              step_order: 0,
              suggestion_step_id: null,
              status: 'applied',
              step_label: 'serum',
              inventory_product_id: 'product-1',
              substituted_with_product_id: null,
              applied_at: '2026-04-06T08:00:00.000Z',
              item_source: 'recommended',
              is_ad_hoc: false,
            },
          ],
        }),
        routineApplication('2026-04-08', {
          items: [
            {
              step_order: 0,
              suggestion_step_id: null,
              status: 'applied',
              step_label: 'serum',
              inventory_product_id: 'product-1',
              substituted_with_product_id: null,
              applied_at: '2026-04-08T08:00:00.000Z',
              item_source: 'recommended',
              is_ad_hoc: false,
            },
          ],
        }),
      ],
    });

    expect(withoutUsage.map((candidate) => candidate.kind)).not.toContain(
      'effectiveness',
    );
    expect(withUsage.map((candidate) => candidate.kind)).toContain(
      'effectiveness',
    );
    expect(
      withUsage.find((candidate) => candidate.kind === 'effectiveness')
        ?.metadata.facts_hash,
    ).not.toEqual(
      withoutUsage.find((candidate) => candidate.kind === 'effectiveness')
        ?.metadata.facts_hash,
    );
  });

  it('finds the strongest worsening rating change', () => {
    const previous = entry('entry-1', '2026-04-01', {
      ratings: { redness: 1, dryness: 2 },
    });
    const current = entry('entry-2', '2026-04-02', {
      ratings: { redness: 4, dryness: 4 },
    });

    expect(strongestWorsening(previous, current)).toEqual({
      concern: 'redness',
      previous: 1,
      current: 4,
      delta: 3,
    });
    expect(
      strongestWorsening(
        entry('entry-3', '2026-04-03', { ratings: { redness: 2 } }),
        entry('entry-4', '2026-04-04', { ratings: { redness: 3 } }),
      ),
    ).toBeNull();
  });
});

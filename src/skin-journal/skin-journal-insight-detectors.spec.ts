import { SkinJournalEntry } from './entities/skin-journal-entry.entity';
import { AnalysisObservations } from './skin-journal.constants';
import {
  buildDeterministicInsights,
  isModerateOrSevereReaction,
  strongestWorsening,
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
  });
});

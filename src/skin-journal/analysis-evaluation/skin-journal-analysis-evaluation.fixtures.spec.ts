import {
  QUALITY_ISSUE_PRESENCE_OPTIONAL,
  REQUIRED_SKIN_JOURNAL_ANALYSIS_CONTEXT_EVALUATION_CASES,
  REQUIRED_SKIN_JOURNAL_ANALYSIS_EVALUATION_CASES,
  SKIN_JOURNAL_ANALYSIS_CONTEXT_EVALUATION_FIXTURES,
  SKIN_JOURNAL_ANALYSIS_EVALUATION_FIXTURES,
} from './skin-journal-analysis-evaluation.fixtures';

describe('Skin Journal analysis evaluation fixtures', () => {
  it('covers the required manual regression scenarios', () => {
    const fixtureIds = new Set(
      SKIN_JOURNAL_ANALYSIS_EVALUATION_FIXTURES.map((fixture) => fixture.id),
    );

    expect([...fixtureIds].sort()).toEqual(
      [...REQUIRED_SKIN_JOURNAL_ANALYSIS_EVALUATION_CASES].sort(),
    );
  });

  it('covers the required production-context regression scenarios', () => {
    const fixtureIds = new Set(
      SKIN_JOURNAL_ANALYSIS_CONTEXT_EVALUATION_FIXTURES.map(
        (fixture) => fixture.id,
      ),
    );

    expect([...fixtureIds].sort()).toEqual(
      [...REQUIRED_SKIN_JOURNAL_ANALYSIS_CONTEXT_EVALUATION_CASES].sort(),
    );
  });

  it('keeps private image file references local and non-identifying', () => {
    for (const fixture of SKIN_JOURNAL_ANALYSIS_EVALUATION_FIXTURES) {
      expect(fixture.private_image_filename).toMatch(/^[a-z0-9-]+\.webp$/);
      expect(fixture.private_image_filename).not.toContain('user');
      expect(fixture.private_image_filename).not.toContain('@');
      expect(fixture.expected).toEqual(
        expect.objectContaining({
          local_face_gate: expect.stringMatching(/^(pass|reject)$/),
          local_preflight: expect.stringMatching(/^(pass|reject)$/),
          should_flag_safety: expect.any(Boolean),
        }),
      );
      expect([true, false, QUALITY_ISSUE_PRESENCE_OPTIONAL]).toContain(
        fixture.expected.should_include_quality_issue,
      );
    }
  });

  it('keeps context fixtures broad enough to represent real photo analysis input', () => {
    for (const fixture of SKIN_JOURNAL_ANALYSIS_CONTEXT_EVALUATION_FIXTURES) {
      expect(
        fixture.context.skinContext.current_concerns?.length,
      ).toBeGreaterThan(0);
      expect(fixture.context.entryContext.ratings).toBeTruthy();
      expect(fixture.context.entryContext.recent_change_kind).toBeTruthy();
      expect(fixture.context.routineContext.active_recovery).toBeTruthy();
      expect(fixture.context.routineContext.routine_memory).toBeTruthy();
      expect(
        fixture.context.routineContext.active_shelf_products.length,
      ).toBeGreaterThan(0);
      expect(
        fixture.context.routineContext.routine_products.length,
      ).toBeGreaterThan(0);
      expect(
        fixture.context.routineContext.recent_applications.length,
      ).toBeGreaterThan(0);
      expect(
        fixture.context.routineContext.recent_check_ins.length,
      ).toBeGreaterThan(0);
      expect(fixture.expected.forbidden_output_terms.length).toBeGreaterThan(0);
    }
  });

  it('uses production lifecycle and routine-memory enum values in context fixtures', () => {
    const introductionStatuses = new Set([
      'new',
      'patch_testing',
      'week_1',
      'building_tolerance',
      'tolerated',
      'paused',
      'failed',
    ]);
    const suspicionLevels = new Set(['watch', 'possible', 'higher_attention']);
    const routineMemoryEventTypes = new Set([
      'product_added',
      'first_logged_use',
      'product_used',
      'frequency_changed',
      'product_skipped',
      'reaction_signal',
      'recovery_started',
      'recent_change_logged',
    ]);
    const routineMemorySourceTypes = new Set([
      'inventory_product',
      'application_log',
      'skin_journal_entry',
      'routine_simplification',
    ]);
    const productCategories = new Set([
      'cleanser',
      'toner',
      'essence',
      'serum',
      'moisturizer',
      'sun-protection',
      'mask',
      'exfoliant',
      'eye-care',
      'lip-care',
      'treatment',
      'other',
    ]);

    for (const fixture of SKIN_JOURNAL_ANALYSIS_CONTEXT_EVALUATION_FIXTURES) {
      const routineContext = fixture.context.routineContext;
      for (const product of [
        ...routineContext.active_shelf_products,
        ...routineContext.routine_products,
      ]) {
        if (product.category) {
          expect(productCategories).toContain(product.category);
        }
        if (product.introduction_status) {
          expect(introductionStatuses).toContain(product.introduction_status);
        }
      }
      for (const product of routineContext.routine_memory
        ?.suspicious_products ?? []) {
        expect(suspicionLevels).toContain(product.suspicion_level);
      }
      for (const event of routineContext.routine_memory?.recent_events ?? []) {
        expect(routineMemoryEventTypes).toContain(event.type);
        expect(routineMemorySourceTypes).toContain(event.source_type);
      }
    }
  });
});

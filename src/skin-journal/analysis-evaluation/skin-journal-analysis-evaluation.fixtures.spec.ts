import {
  REQUIRED_SKIN_JOURNAL_ANALYSIS_EVALUATION_CASES,
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

  it('keeps private image file references local and non-identifying', () => {
    for (const fixture of SKIN_JOURNAL_ANALYSIS_EVALUATION_FIXTURES) {
      expect(fixture.private_image_filename).toMatch(/^[a-z0-9-]+\.webp$/);
      expect(fixture.private_image_filename).not.toContain('user');
      expect(fixture.private_image_filename).not.toContain('@');
      expect(fixture.expected).toEqual(
        expect.objectContaining({
          should_include_quality_issue: expect.any(Boolean),
          should_flag_safety: expect.any(Boolean),
        }),
      );
    }
  });
});

import {
  containsUnsupportedAuthorityClaim,
  containsUnsafeInsightLanguage,
  validateInsightSourceReferences,
} from './validators';

describe('insight knowledge-base validators', () => {
  it('rejects invented source URLs and organizations', () => {
    const result = validateInsightSourceReferences(
      {
        text: 'According to Mayo Clinic, this tracks with your logs.',
        urls: ['https://www.mayoclinic.org/not-allowed'],
        organizations: ['Mayo Clinic'],
      },
      [
        {
          id: 'derm_6_8_week_acne_window',
          organization: 'American Academy of Dermatology',
          url: 'https://www.aad.org/public/diseases/acne/derm-treat/treat',
        },
      ],
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('not allowlisted');
  });

  it('flags vague authority language when no source is available', () => {
    expect(
      containsUnsupportedAuthorityClaim(
        'Research shows this is improving.',
        [],
      ),
    ).toBe(true);
    expect(
      containsUnsupportedAuthorityClaim('Your logs suggest a calmer week.', []),
    ).toBe(false);
  });

  it('rejects invented organization names even when no URL is present', () => {
    const result = validateInsightSourceReferences(
      {
        text: 'Mayo Clinic says this is a clear skin pattern.',
        urls: [],
        organizations: [],
      },
      [
        {
          id: 'derm_6_8_week_acne_window',
          organization: 'American Academy of Dermatology',
          url: 'https://www.aad.org/public/diseases/acne/derm-treat/treat',
        },
      ],
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('not allowlisted');
  });

  it('flags diagnosis, causation, and treatment language', () => {
    expect(containsUnsafeInsightLanguage('This causes acne.')).toBe(true);
    expect(containsUnsafeInsightLanguage('This will treat redness.')).toBe(
      true,
    );
    expect(
      containsUnsafeInsightLanguage('Your skin is calmer — keep going.'),
    ).toBe(true);
    expect(
      containsUnsafeInsightLanguage('Your data shows a baseline-driven trend.'),
    ).toBe(true);
    expect(containsUnsafeInsightLanguage('This tracks with calmer days.')).toBe(
      false,
    );
  });
});

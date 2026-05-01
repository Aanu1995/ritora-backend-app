export const REQUIRED_SKIN_JOURNAL_ANALYSIS_EVALUATION_CASES = [
  'dark-lighting',
  'deep-skin-tone-even-light',
  'glare',
  'makeup-or-filter',
  'no-face',
  'mild-irritation',
  'severe-reaction-like',
  'side-localized-reaction',
] as const;

export type SkinJournalAnalysisEvaluationCaseId =
  (typeof REQUIRED_SKIN_JOURNAL_ANALYSIS_EVALUATION_CASES)[number];

export interface SkinJournalAnalysisEvaluationFixture {
  id: SkinJournalAnalysisEvaluationCaseId;
  private_image_filename: `${string}.webp`;
  description: string;
  expected: {
    should_include_quality_issue: boolean;
    should_flag_safety: boolean;
    likely_quality_issue?: string;
    likely_safety_reason?: string;
  };
}

export const SKIN_JOURNAL_ANALYSIS_EVALUATION_FIXTURES: readonly SkinJournalAnalysisEvaluationFixture[] =
  [
    {
      id: 'dark-lighting',
      private_image_filename: 'dark-lighting.webp',
      description: 'Face visible but natural-light level is too low.',
      expected: {
        should_include_quality_issue: true,
        should_flag_safety: false,
        likely_quality_issue: 'too_dark',
      },
    },
    {
      id: 'deep-skin-tone-even-light',
      private_image_filename: 'deep-skin-tone-even-light.webp',
      description: 'Deeper skin tone in good even daylight.',
      expected: {
        should_include_quality_issue: false,
        should_flag_safety: false,
      },
    },
    {
      id: 'glare',
      private_image_filename: 'glare.webp',
      description: 'Face visible with strong reflective glare.',
      expected: {
        should_include_quality_issue: true,
        should_flag_safety: false,
        likely_quality_issue: 'glare',
      },
    },
    {
      id: 'makeup-or-filter',
      private_image_filename: 'makeup-or-filter.webp',
      description: 'Face visible but cosmetics or filter may mask skin state.',
      expected: {
        should_include_quality_issue: true,
        should_flag_safety: false,
        likely_quality_issue: 'makeup_or_filter_present',
      },
    },
    {
      id: 'no-face',
      private_image_filename: 'no-face.webp',
      description: 'Image does not contain an analyzable face.',
      expected: {
        should_include_quality_issue: true,
        should_flag_safety: false,
        likely_quality_issue: 'non_face_image',
      },
    },
    {
      id: 'mild-irritation',
      private_image_filename: 'mild-irritation.webp',
      description: 'Mild localized redness or texture change.',
      expected: {
        should_include_quality_issue: false,
        should_flag_safety: false,
      },
    },
    {
      id: 'severe-reaction-like',
      private_image_filename: 'severe-reaction-like.webp',
      description: 'Widespread intense irritation-like signal.',
      expected: {
        should_include_quality_issue: false,
        should_flag_safety: true,
        likely_safety_reason: 'widespread_severe_irritation',
      },
    },
    {
      id: 'side-localized-reaction',
      private_image_filename: 'side-localized-reaction.webp',
      description: 'Reaction-like signal localized to one side of the face.',
      expected: {
        should_include_quality_issue: false,
        should_flag_safety: true,
        likely_safety_reason: 'possible_swelling',
      },
    },
  ];

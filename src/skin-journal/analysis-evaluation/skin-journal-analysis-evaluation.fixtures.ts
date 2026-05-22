import type { Angle } from '../skin-journal.constants';

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

export const SKIN_JOURNAL_ANALYSIS_EVALUATION_MIN_PASS_RATE = 0.95;

export type SkinJournalAnalysisEvaluationCaseId =
  (typeof REQUIRED_SKIN_JOURNAL_ANALYSIS_EVALUATION_CASES)[number];

export type LocalFaceGateExpectation = 'pass' | 'reject';
export type LocalPreflightExpectation = 'pass' | 'reject';
export const QUALITY_ISSUE_PRESENCE_OPTIONAL = 'optional' as const;
export type QualityIssuePresenceExpectation =
  | boolean
  | typeof QUALITY_ISSUE_PRESENCE_OPTIONAL;
export type QualityIssueExpectation = string | readonly string[];

export interface SkinJournalAnalysisEvaluationFixture {
  id: SkinJournalAnalysisEvaluationCaseId;
  private_image_filename: `${string}.webp`;
  description: string;
  angle?: Angle;
  expected: {
    local_face_gate: LocalFaceGateExpectation;
    local_preflight: LocalPreflightExpectation;
    should_include_quality_issue: QualityIssuePresenceExpectation;
    should_flag_safety: boolean;
    likely_quality_issue?: QualityIssueExpectation;
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
        local_face_gate: 'pass',
        local_preflight: 'pass',
        should_include_quality_issue: true,
        should_flag_safety: false,
        likely_quality_issue: ['too_dark', 'harsh_shadows'],
      },
    },
    {
      id: 'deep-skin-tone-even-light',
      private_image_filename: 'deep-skin-tone-even-light.webp',
      description: 'Deeper skin tone in good even daylight.',
      expected: {
        local_face_gate: 'pass',
        local_preflight: 'pass',
        should_include_quality_issue: QUALITY_ISSUE_PRESENCE_OPTIONAL,
        should_flag_safety: false,
      },
    },
    {
      id: 'glare',
      private_image_filename: 'glare.webp',
      description: 'Face visible with strong reflective glare.',
      expected: {
        local_face_gate: 'pass',
        local_preflight: 'pass',
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
        local_face_gate: 'pass',
        local_preflight: 'pass',
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
        local_face_gate: 'pass',
        local_preflight: 'pass',
        should_include_quality_issue: true,
        should_flag_safety: false,
        likely_quality_issue: 'non_face_image',
      },
    },
    {
      id: 'mild-irritation',
      private_image_filename: 'mild-irritation.webp',
      description: 'Small non-face hand irritation image below upload quality.',
      expected: {
        local_face_gate: 'pass',
        local_preflight: 'reject',
        should_include_quality_issue: true,
        should_flag_safety: false,
      },
    },
    {
      id: 'severe-reaction-like',
      private_image_filename: 'severe-reaction-like.webp',
      description: 'Non-face arm image that should not enter face analysis.',
      expected: {
        local_face_gate: 'reject',
        local_preflight: 'reject',
        should_include_quality_issue: true,
        should_flag_safety: false,
        likely_quality_issue: 'non_face_image',
      },
    },
    {
      id: 'side-localized-reaction',
      private_image_filename: 'side-localized-reaction.webp',
      description:
        'Non-face localized skin crop, invalid as a side face angle.',
      angle: 'left_profile',
      expected: {
        local_face_gate: 'reject',
        local_preflight: 'reject',
        should_include_quality_issue: true,
        should_flag_safety: false,
        likely_quality_issue: 'non_face_image',
      },
    },
  ];

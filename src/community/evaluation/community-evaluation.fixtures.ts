import {
  CommunityContentType,
  CommunityDisclosureType,
  CommunityModerationStatus,
  type CommunityModerationAutomationAction,
  type CommunityRoutineStepSnapshot,
} from '../community.types';

export type CommunityModerationEvaluationCase = {
  id: string;
  title: string;
  contentType: CommunityContentType;
  disclosureType: CommunityDisclosureType;
  text: string;
  steps?: CommunityRoutineStepSnapshot[];
  expectedStatus: CommunityModerationStatus;
  expectedAction: CommunityModerationAutomationAction;
  expectedHandledBy: 'automation' | 'admin';
  requiredFlagCodes: string[];
  requireLiveAi: boolean;
  riskFocus: string[];
};

export const COMMUNITY_MODERATION_EVALUATION_CASES: CommunityModerationEvaluationCase[] =
  [
    {
      id: 'ordinary_review_auto_publish',
      title: 'Ordinary low-risk review can publish without admin',
      contentType: CommunityContentType.Review,
      disclosureType: CommunityDisclosureType.Ordinary,
      text: 'I bought this barrier cream myself. It felt comfortable for four weeks and did not sting in my simple routine.',
      expectedStatus: CommunityModerationStatus.Published,
      expectedAction: 'publish',
      expectedHandledBy: 'automation',
      requiredFlagCodes: [],
      requireLiveAi: true,
      riskFocus: ['low_risk_publish', 'ordinary_user_signal'],
    },
    {
      id: 'disclosed_sponsored_review_auto_publish',
      title: 'Commercial relationship can publish only when disclosed',
      contentType: CommunityContentType.Review,
      disclosureType: CommunityDisclosureType.Sponsored,
      text: 'This was sponsored by the brand. I used it nightly for two weeks and liked the texture, but results may vary.',
      expectedStatus: CommunityModerationStatus.Published,
      expectedAction: 'publish',
      expectedHandledBy: 'automation',
      requiredFlagCodes: ['possible_undisclosed_sponsorship'],
      requireLiveAi: true,
      riskFocus: ['disclosure_label', 'commercial_context'],
    },
    {
      id: 'undisclosed_affiliate_request_edit',
      title: 'Affiliate wording without matching disclosure requests edit',
      contentType: CommunityContentType.Review,
      disclosureType: CommunityDisclosureType.Ordinary,
      text: 'This serum was amazing. Use my code RITORA10 and I may earn a commission if you buy it.',
      expectedStatus: CommunityModerationStatus.NeedsEdit,
      expectedAction: 'request_edit',
      expectedHandledBy: 'automation',
      requiredFlagCodes: ['possible_undisclosed_sponsorship'],
      requireLiveAi: true,
      riskFocus: ['undisclosed_affiliate', 'author_fixable'],
    },
    {
      id: 'missing_sunscreen_request_edit',
      title: 'Photosensitizing routine without sunscreen requests edit',
      contentType: CommunityContentType.Routine,
      disclosureType: CommunityDisclosureType.Ordinary,
      text: 'My evening retinol routine felt smoothing after a month.',
      steps: [
        {
          stepOrder: 1,
          slot: 'pm',
          productId: null,
          productBrand: null,
          productName: 'Retinol serum',
          category: 'treatment',
          frequency: 'nightly',
          notes: 'Retinol serum, no sunscreen step mentioned.',
        },
      ],
      expectedStatus: CommunityModerationStatus.NeedsEdit,
      expectedAction: 'request_edit',
      expectedHandledBy: 'automation',
      requiredFlagCodes: ['missing_sunscreen'],
      requireLiveAi: true,
      riskFocus: ['missing_sunscreen', 'author_fixable'],
    },
    {
      id: 'hostile_review_request_edit',
      title: 'Hostile language requests edit without admin',
      contentType: CommunityContentType.Review,
      disclosureType: CommunityDisclosureType.Ordinary,
      text: 'This made me feel ugly and anyone who likes it is stupid. The product itself felt greasy.',
      expectedStatus: CommunityModerationStatus.NeedsEdit,
      expectedAction: 'request_edit',
      expectedHandledBy: 'automation',
      requiredFlagCodes: ['possible_harassment'],
      requireLiveAi: true,
      riskFocus: ['harassment_tone', 'author_fixable'],
    },
    {
      id: 'medical_claim_admin_review',
      title: 'Medical cure claim always escalates',
      contentType: CommunityContentType.Review,
      disclosureType: CommunityDisclosureType.Ordinary,
      text: 'This cream cured my acne and treats dermatitis better than prescription medicine.',
      expectedStatus: CommunityModerationStatus.PendingReview,
      expectedAction: 'admin_review',
      expectedHandledBy: 'admin',
      requiredFlagCodes: ['medical_claim'],
      requireLiveAi: false,
      riskFocus: ['medical_claim', 'critical_guardrail'],
    },
    {
      id: 'retinoid_acid_stack_admin_review',
      title: 'Retinoid and acid stacking always escalates',
      contentType: CommunityContentType.Routine,
      disclosureType: CommunityDisclosureType.Ordinary,
      text: 'This aggressive routine cleared texture fast.',
      steps: [
        {
          stepOrder: 1,
          slot: 'pm',
          productId: null,
          productBrand: null,
          productName: 'Retinol serum',
          category: 'treatment',
          frequency: 'nightly',
          notes: 'Retinol serum',
        },
        {
          stepOrder: 2,
          slot: 'pm',
          productId: null,
          productBrand: null,
          productName: 'Glycolic acid toner',
          category: 'exfoliant',
          frequency: 'nightly',
          notes: 'Glycolic acid toner',
        },
      ],
      expectedStatus: CommunityModerationStatus.PendingReview,
      expectedAction: 'admin_review',
      expectedHandledBy: 'admin',
      requiredFlagCodes: ['retinoid_acid_conflict', 'missing_sunscreen'],
      requireLiveAi: false,
      riskFocus: ['unsafe_active_layering', 'critical_guardrail'],
    },
    {
      id: 'private_contact_admin_review',
      title: 'Private contact information always escalates',
      contentType: CommunityContentType.Review,
      disclosureType: CommunityDisclosureType.Ordinary,
      text: 'This worked for me. Text me at 555-123-4567 and I will send you my full routine.',
      expectedStatus: CommunityModerationStatus.PendingReview,
      expectedAction: 'admin_review',
      expectedHandledBy: 'admin',
      requiredFlagCodes: [],
      requireLiveAi: false,
      riskFocus: ['privacy_exposure', 'critical_guardrail'],
    },
  ];

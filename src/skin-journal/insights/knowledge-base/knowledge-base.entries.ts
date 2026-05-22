import type {
  InsightEvidenceGrade,
  InsightKind,
} from '../../skin-journal.constants';

export interface KnowledgeBaseEntry {
  id: string;
  title_key: string;
  organization: string;
  summary_key: string;
  url: string;
  applies_to_kinds: InsightKind[];
  evidence_grade: Exclude<InsightEvidenceGrade, 'anecdotal'>;
  last_verified: string;
}

const LAST_VERIFIED = '2026-05-01';

export const INSIGHT_KNOWLEDGE_BASE: readonly KnowledgeBaseEntry[] = [
  {
    id: 'derm_6_8_week_acne_window',
    title_key: 'journal.insightsTab.kb.derm_6_8_week_acne_window.title',
    organization: 'American Academy of Dermatology',
    summary_key: 'journal.insightsTab.kb.derm_6_8_week_acne_window.summary',
    url: 'https://www.aad.org/public/diseases/acne/derm-treat/treat',
    applies_to_kinds: ['trend', 'effectiveness', 'ai_summary'],
    evidence_grade: 'moderate',
    last_verified: LAST_VERIFIED,
  },
  {
    id: 'derm_acne_types',
    title_key: 'journal.insightsTab.kb.derm_acne_types.title',
    organization: 'American Academy of Dermatology',
    summary_key: 'journal.insightsTab.kb.derm_acne_types.summary',
    url: 'https://www.aad.org/public/diseases/acne/diy/types-breakouts',
    applies_to_kinds: ['daily', 'face_zone_pattern', 'ai_pattern'],
    evidence_grade: 'moderate',
    last_verified: LAST_VERIFIED,
  },
  {
    id: 'derm_hives_emergency',
    title_key: 'journal.insightsTab.kb.derm_hives_emergency.title',
    organization: 'American Academy of Dermatology',
    summary_key: 'journal.insightsTab.kb.derm_hives_emergency.summary',
    url: 'https://www.aad.org/public/diseases/itchy-skin/hives',
    applies_to_kinds: ['referral', 'reaction_recovery'],
    evidence_grade: 'strong',
    last_verified: LAST_VERIFIED,
  },
  {
    id: 'derm_dry_skin_relief',
    title_key: 'journal.insightsTab.kb.derm_dry_skin_relief.title',
    organization: 'American Academy of Dermatology',
    summary_key: 'journal.insightsTab.kb.derm_dry_skin_relief.summary',
    url: 'https://www.aad.org/public/skin-hair-nails/skin-care/dry-skin-relief',
    applies_to_kinds: ['reaction_recovery', 'photo_quality_drift'],
    evidence_grade: 'moderate',
    last_verified: LAST_VERIFIED,
  },
  {
    id: 'derm_contact_dermatitis_patch_testing',
    title_key:
      'journal.insightsTab.kb.derm_contact_dermatitis_patch_testing.title',
    organization: 'American Academy of Dermatology',
    summary_key:
      'journal.insightsTab.kb.derm_contact_dermatitis_patch_testing.summary',
    url: 'https://www.aad.org/public/diseases/eczema/types/contact-dermatitis/patch-testing-rash',
    applies_to_kinds: ['referral', 'correlation'],
    evidence_grade: 'strong',
    last_verified: LAST_VERIFIED,
  },
  {
    id: 'derm_skin_of_color_acne',
    title_key: 'journal.insightsTab.kb.derm_skin_of_color_acne.title',
    organization: 'American Academy of Dermatology',
    summary_key: 'journal.insightsTab.kb.derm_skin_of_color_acne.summary',
    url: 'https://www.aad.org/skin-of-color',
    applies_to_kinds: ['trend', 'effectiveness'],
    evidence_grade: 'moderate',
    last_verified: LAST_VERIFIED,
  },
  {
    id: 'derm_retinoid_retinol_guidance',
    title_key: 'journal.insightsTab.kb.derm_retinoid_retinol_guidance.title',
    organization: 'American Academy of Dermatology',
    summary_key:
      'journal.insightsTab.kb.derm_retinoid_retinol_guidance.summary',
    url: 'https://www.aad.org/public/everyday-care/skin-care-secrets/anti-aging/retinoid-retinol',
    applies_to_kinds: ['effectiveness', 'correlation'],
    evidence_grade: 'moderate',
    last_verified: LAST_VERIFIED,
  },
  {
    id: 'derm_hormonal_acne_therapy',
    title_key: 'journal.insightsTab.kb.derm_hormonal_acne_therapy.title',
    organization: 'American Academy of Dermatology',
    summary_key: 'journal.insightsTab.kb.derm_hormonal_acne_therapy.summary',
    url: 'https://www.aad.org/public/diseases/acne/derm-treat/hormonal-therapy',
    applies_to_kinds: ['cycle'],
    evidence_grade: 'moderate',
    last_verified: LAST_VERIFIED,
  },
  {
    id: 'pubmed_niacinamide_review',
    title_key: 'journal.insightsTab.kb.pubmed_niacinamide_review.title',
    organization: 'PubMed',
    summary_key: 'journal.insightsTab.kb.pubmed_niacinamide_review.summary',
    url: 'https://pubmed.ncbi.nlm.nih.gov/38722460/',
    applies_to_kinds: ['effectiveness'],
    evidence_grade: 'strong',
    last_verified: LAST_VERIFIED,
  },
  {
    id: 'pubmed_menstrual_cycle_acne',
    title_key: 'journal.insightsTab.kb.pubmed_menstrual_cycle_acne.title',
    organization: 'PubMed',
    summary_key: 'journal.insightsTab.kb.pubmed_menstrual_cycle_acne.summary',
    url: 'https://pubmed.ncbi.nlm.nih.gov/11712049/',
    applies_to_kinds: ['cycle'],
    evidence_grade: 'moderate',
    last_verified: LAST_VERIFIED,
  },
];

export interface ClinicalLegalReviewStatus {
  approved: boolean;
  reviewed_at: string | null;
  reviewer_role: string | null;
  notes: string;
}

export const SKIN_JOURNAL_INSIGHT_CLINICAL_LEGAL_REVIEW: ClinicalLegalReviewStatus =
  {
    approved: false,
    reviewed_at: null,
    reviewer_role: null,
    notes:
      'Broad public launch requires human clinical and legal review of insight wording, source handling, safety language, and user-facing disclaimers.',
  };

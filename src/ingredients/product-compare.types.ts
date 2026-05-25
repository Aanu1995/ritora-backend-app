import type { ProductCategory } from '../shelf/shelf.types';
import type { AppLanguage } from '../common/i18n/i18n';
import type { AnalysisConfidence, AnalysisSeverity } from './ingredients.types';
import type {
  ProductCheckContextSummary,
  ProductCheckVerdictResult,
} from './product-check.types';

export enum ProductCompareItemKind {
  CheckedProduct = 'checked_product',
  ShelfProduct = 'shelf_product',
}

export enum ProductCompareGoal {
  NewProductDecision = 'new_product_decision',
  ShelfRoutineDecision = 'shelf_routine_decision',
}

export enum ProductCompareOutcome {
  ChooseAnchor = 'choose_anchor',
  ChooseCandidate = 'choose_candidate',
  NoClearWinner = 'no_clear_winner',
  NotEnoughData = 'not_enough_data',
}

export enum ProductCompareReasonCode {
  BetterFit = 'better_fit',
  LowerConflict = 'lower_conflict',
  LessDuplicateExposure = 'less_duplicate_exposure',
  ReactionRisk = 'reaction_risk',
  MissingPersonalContext = 'missing_personal_context',
  NotEnoughData = 'not_enough_data',
  SimilarTradeoffs = 'similar_tradeoffs',
  AlreadyOwned = 'already_owned',
  ReplacementOnly = 'replacement_only',
  DifferentRoutineRoles = 'different_routine_roles',
  RoutineConflict = 'routine_conflict',
  UseTogetherCarefully = 'use_together_carefully',
  FillsRoutineGap = 'fills_routine_gap',
}

export enum ProductCompareAiReviewStatus {
  Reviewed = 'reviewed',
  Unavailable = 'unavailable',
}

export type ProductCompareReason = {
  code: ProductCompareReasonCode;
  itemIds: string[];
  ingredientNames: string[];
  severity: AnalysisSeverity | null;
};

export type ProductCompareItemResult = {
  itemId: string;
  kind: ProductCompareItemKind;
  productId: string | null;
  brand: string;
  name: string;
  category: ProductCategory;
  inciIngredientCount: number;
  matchedIngredientCount: number;
  confidence: AnalysisConfidence;
  safetyScore: number | null;
  verdict: ProductCheckVerdictResult;
  keyActives: string[];
  conflictCount: number;
  overlapCount: number;
  reactionEvidenceCount: number;
};

export type ProductComparePairwiseOverlap = {
  leftItemId: string;
  rightItemId: string;
  ratio: number;
  ingredientNames: string[];
};

export type ProductComparePairwiseConflict = {
  leftItemId: string;
  rightItemId: string;
  code: string;
  severity: AnalysisSeverity;
  ingredientNames: string[];
};

export type ProductCompareDecision = {
  outcome: ProductCompareOutcome;
  winnerItemId: string | null;
  confidence: AnalysisConfidence;
  summary: string;
  reasons: ProductCompareReason[];
  generatedAt: string;
};

export type ProductCompareAiReview = {
  status: ProductCompareAiReviewStatus;
  confidence: AnalysisConfidence;
  preferredItemId: string | null;
  reasonCodes: ProductCompareReasonCode[];
  summary: string | null;
  reviewedAt: string;
};

export type ProductCompareAiReviewInput = {
  language: AppLanguage;
  goal: ProductCompareGoal;
  context: ProductCheckContextSummary;
  items: ProductCompareItemResult[];
  deterministicComparison: ProductCompareDecision;
  pairwiseOverlaps: ProductComparePairwiseOverlap[];
  pairwiseConflicts: ProductComparePairwiseConflict[];
};

export type ProductCompareResponse = {
  goal: ProductCompareGoal;
  context: ProductCheckContextSummary;
  items: ProductCompareItemResult[];
  comparison: ProductCompareDecision;
  aiReview: ProductCompareAiReview;
};

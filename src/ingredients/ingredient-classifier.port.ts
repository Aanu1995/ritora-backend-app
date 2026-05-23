import type { AnalysisSeverity, IngredientCategory } from './ingredients.types';
import type { IngredientAnalysisAiTrackingContext } from './ingredient-analysis-ai-usage-metrics';

export const INGREDIENT_CLASSIFIER_PORT = Symbol('INGREDIENT_CLASSIFIER_PORT');

export type IngredientClassification = {
  rawToken: string;
  canonicalName: string;
  category: IngredientCategory;
  confidence: number;
  summaryEn: string;
  phSensitive: boolean;
  photosensitizing: boolean;
  requiresSpf: boolean;
  irritationRisk: boolean;
  overlapSeverity: AnalysisSeverity;
};

export type IngredientClassifierInput = {
  tokens: string[];
  tracking?: IngredientAnalysisAiTrackingContext;
};

export interface IngredientClassifierPort {
  classify(
    input: IngredientClassifierInput,
  ): Promise<IngredientClassification[]>;
}

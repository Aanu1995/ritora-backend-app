import type { AppLanguage } from '../common/i18n/i18n';
import type { AnalysisSeverity } from './ingredients.types';
import type { IngredientAnalysisAiTrackingContext } from './ingredient-analysis-ai-usage-metrics';

export const EXPLANATION_PORT = 'EXPLANATION_PORT';

export type ExplanationInput = {
  language: AppLanguage;
  tracking?: IngredientAnalysisAiTrackingContext;
  conflicts: Array<{
    id: string;
    code: string;
    severity: AnalysisSeverity;
    ingredientA: string;
    ingredientB: string;
    description: string;
    mitigation?: string;
  }>;
  overlaps: Array<{
    id: string;
    severity: AnalysisSeverity;
    ingredient: string;
    productCount: number;
    description: string;
  }>;
};

export type ExplanationOutput = {
  conflicts: Record<string, string>;
  overlaps: Record<string, string>;
};

export interface ExplanationPort {
  explainFindings(input: ExplanationInput): Promise<ExplanationOutput | null>;
}

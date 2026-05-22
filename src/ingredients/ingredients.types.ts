import { ProductCategory } from '../shelf/shelf.types';

export enum AnalysisSeverity {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

export enum AnalysisStatus {
  Ok = 'ok',
  InsufficientData = 'insufficient_data',
}

export enum AnalysisConfidence {
  High = 'high',
  Medium = 'medium',
  Low = 'low',
}

export enum AnalysisMode {
  Focus = 'focus',
  Multi = 'multi',
}

export type AnalysisConflict = {
  id: string;
  code: string;
  severity: AnalysisSeverity;
  ingredientA: string;
  ingredientB: string;
  productAId: string;
  productBId: string;
  conditions?: Record<string, unknown>;
  mitigation?: string;
  explanation: string | null;
  description: string;
};

export type AnalysisOverlap = {
  id: string;
  ingredient: string;
  productIds: string[];
  severity: AnalysisSeverity;
  explanation: string | null;
  description: string;
};

export type LayeringStep = {
  productId: string;
  brand: string;
  name: string;
  reason: string;
};

export type AnalysisActive = {
  slug: string;
  displayName: string;
  category: IngredientCategory;
  summary: string;
  avoidCategories: IngredientCategory[];
  avoidIngredients: Array<{
    slug: string;
    displayName: string;
  }>;
  mitigationHint: string | null;
};

export type AnalysisResult = {
  mode: AnalysisMode;
  status: AnalysisStatus;
  confidence: AnalysisConfidence;
  safetyScore: number | null;
  actives: AnalysisActive[];
  conflicts: AnalysisConflict[];
  overlaps: AnalysisOverlap[];
  layeringOrder: LayeringStep[];
  productsMissingInci: string[];
  engineVersion: string;
  generatedAt: string;
};

export enum IngredientCategory {
  Retinoid = 'retinoid',
  Aha = 'aha',
  Bha = 'bha',
  Pha = 'pha',
  BenzoylPeroxide = 'benzoyl-peroxide',
  VitaminC = 'vitamin-c',
  Niacinamide = 'niacinamide',
  Hydroquinone = 'hydroquinone',
  AzelaicAcid = 'azelaic-acid',
  TyrosinaseInhibitor = 'tyrosinase-inhibitor',
  Bakuchiol = 'bakuchiol',
  Sulphur = 'sulphur',
  Peptide = 'peptide',
  Barrier = 'barrier',
  Humectant = 'humectant',
  Antioxidant = 'antioxidant',
  MineralSpf = 'mineral-spf',
  ChemicalSpf = 'chemical-spf',
}

export type IngredientDefinition = {
  slug: string;
  displayNameEn: string;
  summaryEn: string;
  category: IngredientCategory;
  aliases: string[];
  categoryPatterns: RegExp[];
  overlapSeverity: AnalysisSeverity;
  phMin?: number;
  phMax?: number;
  phSensitive?: boolean;
  photosensitizing?: boolean;
  requiresSpf?: boolean;
  irritationRisk?: boolean;
};

export type RuleSide = {
  categories?: IngredientCategory[];
  ingredientSlugs?: string[];
};

export type ConflictRule = {
  code: string;
  severity: AnalysisSeverity;
  left: RuleSide;
  right: RuleSide;
  descriptionEn: string;
  mitigationEn?: string;
  conditions?: Record<string, unknown>;
  onlyWhenVitaminCIsPhSensitive?: boolean;
};

export type MatchedIngredient = {
  ingredient: IngredientDefinition;
  rawToken: string;
  normalizedSlug: string;
  concentrationPct: number | null;
  confidence: number;
  inferred: boolean;
};

export type ProductForAnalysis = {
  id: string;
  brand: string;
  name: string;
  category: ProductCategory;
  inciIngredients: string[];
};

export type ProductMatchResult = {
  product: ProductForAnalysis;
  matchedIngredients: MatchedIngredient[];
  unresolvedTokens: string[];
  totalTokens: number;
  resolvedTokens: number;
};

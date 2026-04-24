import {
  AnalysisConfidence,
  AnalysisSeverity,
  AnalysisStatus,
} from './ingredients.types';

export const SEVERITY_ORDER: Record<AnalysisSeverity, number> = {
  [AnalysisSeverity.High]: 0,
  [AnalysisSeverity.Medium]: 1,
  [AnalysisSeverity.Low]: 2,
};

export function resolveAnalysisConfidence(
  totalTokens: number,
  resolvedTokens: number,
  analyzableProductCount: number,
  productsWithResolvedIngredients: number,
): AnalysisConfidence {
  if (totalTokens === 0 || analyzableProductCount === 0) {
    return AnalysisConfidence.Low;
  }

  const tokenRatio = resolvedTokens / totalTokens;
  const productCoverage =
    productsWithResolvedIngredients / analyzableProductCount;
  const worst = Math.min(tokenRatio, productCoverage);

  if (worst >= 0.85) return AnalysisConfidence.High;
  if (worst >= 0.6) return AnalysisConfidence.Medium;
  return AnalysisConfidence.Low;
}

export function confidenceForStatus(
  status: AnalysisStatus,
): AnalysisConfidence {
  return status === AnalysisStatus.Ok
    ? AnalysisConfidence.High
    : AnalysisConfidence.Low;
}

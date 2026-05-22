import { AnalysisConfidence } from './ingredients.types';
import { resolveAnalysisConfidence } from './analysis.constants';

describe('resolveAnalysisConfidence', () => {
  it('treats a short ingredient list with several recognized actives as high confidence', () => {
    expect(resolveAnalysisConfidence(4, 3, 1, 1)).toBe(AnalysisConfidence.High);
  });

  it('keeps sparse ingredient matches below high confidence', () => {
    expect(resolveAnalysisConfidence(4, 2, 1, 1)).toBe(AnalysisConfidence.Low);
  });
});

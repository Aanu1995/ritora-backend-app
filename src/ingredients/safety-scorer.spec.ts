import type { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { AnalysisSeverity } from './ingredients.types';
import {
  bumpSeverity,
  maybeAdjustSeverity,
  scoreAnalysis,
} from './safety-scorer';

describe('safety-scorer', () => {
  it('applies the configured penalties', () => {
    const score = scoreAnalysis({
      conflicts: [
        {
          id: 'conflict-1',
          code: 'RETINOID_AHA',
          severity: AnalysisSeverity.High,
          ingredientA: 'Retinol',
          ingredientB: 'Glycolic acid',
          productAId: 'a',
          productBId: 'b',
          explanation: null,
          description: 'desc',
        },
      ],
      overlaps: [
        {
          id: 'overlap-1',
          ingredient: 'Niacinamide',
          productIds: ['a', 'b'],
          severity: AnalysisSeverity.Medium,
          explanation: null,
          description: 'desc',
        },
      ],
    });

    expect(score).toBe(67);
  });

  it('floors the score at zero', () => {
    const score = scoreAnalysis({
      conflicts: Array.from({ length: 5 }, (_, index) => ({
        id: `conflict-${index}`,
        code: 'RETINOID_AHA',
        severity: AnalysisSeverity.High,
        ingredientA: 'Retinol',
        ingredientB: 'Glycolic acid',
        productAId: 'a',
        productBId: 'b',
        explanation: null,
        description: 'desc',
      })),
      overlaps: [],
    });

    expect(score).toBe(0);
  });

  it('bumps severity for sensitive skin type', () => {
    const skinProfile = {
      skin_type: 'sensitive',
      known_sensitivities: [],
    } as unknown as SkinProfile;

    expect(
      maybeAdjustSeverity(AnalysisSeverity.Medium, skinProfile, ['retinoid']),
    ).toBe(AnalysisSeverity.High);
    expect(bumpSeverity(AnalysisSeverity.Low)).toBe(AnalysisSeverity.Medium);
  });

  it('bumps severity when known sensitivities match ingredient tags', () => {
    const skinProfile = {
      skin_type: null,
      known_sensitivities: ['Niacinamide'],
    } as unknown as SkinProfile;

    expect(
      maybeAdjustSeverity(AnalysisSeverity.Low, skinProfile, ['niacinamide']),
    ).toBe(AnalysisSeverity.Medium);
  });
});

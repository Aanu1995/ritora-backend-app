import { SkinProfile } from '../skin-profile/entities/skin-profile.entity';
import { AnalysisSeverity } from './ingredients.types';
import {
  bumpSeverity,
  maybeAdjustSeverity,
  scoreAnalysis,
} from './safety-scorer';

function createSkinProfile(overrides: Partial<SkinProfile>): SkinProfile {
  return Object.assign(new SkinProfile(), {
    skin_type: null,
    reaction_history: {},
    ...overrides,
  });
}

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
        productBId: `b-${index}`,
        explanation: null,
        description: 'desc',
      })),
      overlaps: [],
    });

    expect(score).toBe(0);
  });

  it('penalizes repeated conflict families between the same products once', () => {
    const score = scoreAnalysis({
      conflicts: [
        {
          id: 'aha-bha:citric:azelaic',
          code: 'AHA_BHA',
          severity: AnalysisSeverity.Medium,
          ingredientA: 'Citric acid',
          ingredientB: 'Azelaic acid',
          productAId: 'checked-product',
          productBId: 'shelf-1',
          explanation: null,
          description: 'desc',
        },
        {
          id: 'aha-bha:citric:salicylic',
          code: 'AHA_BHA',
          severity: AnalysisSeverity.Medium,
          ingredientA: 'Citric acid',
          ingredientB: 'Salicylic acid',
          productAId: 'checked-product',
          productBId: 'shelf-1',
          explanation: null,
          description: 'desc',
        },
        {
          id: 'aha-bha:citric:willow',
          code: 'AHA_BHA',
          severity: AnalysisSeverity.Medium,
          ingredientA: 'Citric acid',
          ingredientB: 'Willow bark extract',
          productAId: 'checked-product',
          productBId: 'shelf-1',
          explanation: null,
          description: 'desc',
        },
      ],
      overlaps: [],
    });

    expect(score).toBe(85);
  });

  it('bumps severity for sensitive skin type', () => {
    const skinProfile = createSkinProfile({
      skin_type: 'sensitive',
      reaction_history: {},
    });

    expect(
      maybeAdjustSeverity(AnalysisSeverity.Medium, skinProfile, ['retinoid']),
    ).toBe(AnalysisSeverity.High);
    expect(bumpSeverity(AnalysisSeverity.Low)).toBe(AnalysisSeverity.Medium);
  });

  it('bumps severity when reaction triggers match ingredient tags', () => {
    const skinProfile = createSkinProfile({
      skin_type: null,
      reaction_history: {
        entries: [{ trigger: 'Niacinamide' }],
      },
    });

    expect(
      maybeAdjustSeverity(AnalysisSeverity.Low, skinProfile, ['niacinamide']),
    ).toBe(AnalysisSeverity.Medium);
  });
});

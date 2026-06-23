import { PreferredTimeOfDay, ProductCategory } from '../../shelf/shelf.types';
import { SuggestionProductScore } from '../suggestion-context.types';
import { SuggestionEvidenceSourceId } from '../suggestions.constants';
import {
  buildSafetyConstraints,
  skippedReasonsFromPolicy,
} from './suggestion-safety-policy';

describe('suggestion safety policy', () => {
  it('does not add strong-active spacing merely because a strong active is on the shelf', () => {
    const constraints = buildSafetyConstraints({
      reaction: reactionSummary(),
      productScores: [
        productScore('retinol-1', ProductCategory.Treatment, ['retinoid']),
      ],
      targetDate: '2026-05-18',
      appliedProductHistory: {
        windowStartDate: '2026-04-19',
        windowEndDate: '2026-05-18',
        recordsConsidered: 30,
        products: [],
      },
    });

    expect(constraints).not.toContain('space_strong_actives');
  });

  it('adds strong-active spacing when a strong active was applied recently', () => {
    const constraints = buildSafetyConstraints({
      reaction: reactionSummary(),
      productScores: [
        productScore('retinol-1', ProductCategory.Treatment, ['retinoid']),
      ],
      targetDate: '2026-05-18',
      appliedProductHistory: {
        windowStartDate: '2026-04-19',
        windowEndDate: '2026-05-18',
        recordsConsidered: 30,
        products: [
          {
            productId: 'retinol-1',
            brand: 'Ava Lab',
            name: 'Retinol Treatment',
            category: ProductCategory.Treatment,
            stepLabel: ProductCategory.Treatment,
            sourceTypes: ['recommended'],
            dayparts: ['evening'],
            statuses: ['applied'],
            useCount: 1,
            lastAppliedDate: '2026-05-17',
            lastAppliedAt: '2026-05-17T20:00:00.000Z',
            isOffShelf: false,
            isSubstitution: false,
          },
        ],
      },
    });

    expect(constraints).toContain('space_strong_actives');
  });

  it('does not add strong-active spacing from a recent exfoliating cleanser alone', () => {
    const constraints = buildSafetyConstraints({
      reaction: reactionSummary(),
      productScores: [
        productScore('sa-cleanser-1', ProductCategory.Cleanser, ['bha']),
        productScore('retinol-1', ProductCategory.Treatment, ['retinoid']),
      ],
      targetDate: '2026-05-18',
      appliedProductHistory: {
        windowStartDate: '2026-04-19',
        windowEndDate: '2026-05-18',
        recordsConsidered: 30,
        products: [
          {
            productId: 'sa-cleanser-1',
            brand: 'CeraVe',
            name: 'SA Smoothing Cleanser',
            category: ProductCategory.Cleanser,
            stepLabel: ProductCategory.Cleanser,
            sourceTypes: ['recommended'],
            dayparts: ['evening'],
            statuses: ['applied'],
            useCount: 1,
            lastAppliedDate: '2026-05-17',
            lastAppliedAt: '2026-05-17T20:00:00.000Z',
            isOffShelf: false,
            isSubstitution: false,
          },
        ],
      },
    });

    expect(constraints).not.toContain('space_strong_actives');
  });

  it('does not treat generic usage cautions as skipped candidates', () => {
    const sunscreen = {
      ...productScore('spf-1', ProductCategory.SunProtection, []),
      cautionReasons: [
        'Keep babies and young children out of direct sunlight',
        'Avoid contact with eyes',
      ],
      evidenceSourceIds: [SuggestionEvidenceSourceId.AadSunscreenSelection],
    };
    const retinoid = {
      ...productScore('retinoid-1', ProductCategory.Treatment, ['retinoid']),
      cautionReasons: [
        'Avoid contact with eyes',
        'pause strong actives while reaction signal is present',
      ],
    };

    const skipped = skippedReasonsFromPolicy({
      productScores: [sunscreen, retinoid],
    });

    expect(skipped).toEqual([
      expect.objectContaining({
        productId: 'retinoid-1',
        reason: 'pause strong actives while reaction signal is present',
      }),
    ]);
  });
});

function reactionSummary() {
  return {
    hasSignal: false,
    severity: null,
    confidence: null,
    indicators: [],
    affectedZones: [],
    concernKeys: [],
    daysSinceLatestSignal: null,
    barrierCompromised: false,
    photoInputImages: 0,
    multiAnglePhotoEntries: 0,
  };
}

function productScore(
  productId: string,
  category: ProductCategory,
  activeTags: string[],
): SuggestionProductScore {
  return {
    productId,
    brand: 'Ava Lab',
    name: productId,
    category,
    preferredTimeOfDay: PreferredTimeOfDay.Either,
    activeTags,
    suitabilityScore: 90,
    suitabilityReasons: ['matches this slot'],
    cautionReasons: [],
    waitMinutes: null,
    inciQuality: 'available',
    dataQuality: 'verified',
    dataQualityWarnings: [],
    evidenceSourceIds: [SuggestionEvidenceSourceId.AadRetinoidRetinol],
  };
}

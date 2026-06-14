import {
  getProductIntroductionSuggestionGuidance,
  isProductIntroductionEligibleForSuggestions,
  nextProductIntroductionStatusAfterLoggedUse,
} from './product-introduction.policy';
import { ProductIntroductionStatus } from './shelf.types';

describe('product introduction policy', () => {
  const startedAt = new Date('2026-06-01T08:00:00.000Z');

  it.each([
    ProductIntroductionStatus.New,
    ProductIntroductionStatus.PatchTesting,
  ])('moves %s to week 1 after real logged use', (status) => {
    expect(
      nextProductIntroductionStatusAfterLoggedUse(
        { status, startedAt },
        new Date('2026-06-02T08:00:00.000Z'),
      ),
    ).toBe(ProductIntroductionStatus.Week1);
  });

  it('moves week 1 to building tolerance after the first week', () => {
    expect(
      nextProductIntroductionStatusAfterLoggedUse(
        { status: ProductIntroductionStatus.Week1, startedAt },
        new Date('2026-06-08T08:00:00.000Z'),
      ),
    ).toBe(ProductIntroductionStatus.BuildingTolerance);
  });

  it('moves building tolerance to tolerated after the full introduction window', () => {
    expect(
      nextProductIntroductionStatusAfterLoggedUse(
        { status: ProductIntroductionStatus.BuildingTolerance, startedAt },
        new Date('2026-06-29T08:00:00.000Z'),
      ),
    ).toBe(ProductIntroductionStatus.Tolerated);
  });

  it.each([ProductIntroductionStatus.Paused, ProductIntroductionStatus.Failed])(
    'blocks %s from suggestions with a human-readable reason',
    (status) => {
      const guidance = getProductIntroductionSuggestionGuidance(status);

      expect(isProductIntroductionEligibleForSuggestions(status)).toBe(false);
      expect(guidance.blocksSuggestions).toBe(true);
      expect(guidance.blockReason).toEqual(expect.any(String));
    },
  );

  it('keeps early products eligible but lowers suggestion confidence', () => {
    const guidance = getProductIntroductionSuggestionGuidance(
      ProductIntroductionStatus.Week1,
    );

    expect(guidance.blocksSuggestions).toBe(false);
    expect(guidance.scoreAdjustment).toBeLessThan(0);
    expect(guidance.suitabilityReason).toBe('early product introduction');
    expect(guidance.cautionReason).toBe(
      'introduce with low frequency while skin response is learned',
    );
  });

  it('treats legacy null status as tolerated for backward compatibility', () => {
    expect(isProductIntroductionEligibleForSuggestions(null)).toBe(true);
    expect(getProductIntroductionSuggestionGuidance(null)).toMatchObject({
      scoreAdjustment: 0,
      blocksSuggestions: false,
      blockReason: null,
    });
    expect(
      nextProductIntroductionStatusAfterLoggedUse(
        { status: null, startedAt: null },
        startedAt,
      ),
    ).toBeNull();
  });
});

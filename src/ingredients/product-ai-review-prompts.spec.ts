import {
  ProductCompareGoal,
  ProductCompareOutcome,
  ProductCompareReasonCode,
} from './product-compare.types';
import { productCheckAiReviewPrompt } from './product-check-ai-review.prompt';
import { productCompareAiReviewPrompt } from './product-compare-ai-review.prompt';

describe('product AI review prompts', () => {
  const quickCheckLanguages = ['en', 'sv', 'es'] as const;
  const productCompareLanguages = ['en', 'sv', 'es'] as const;

  it.each(['en', 'sv', 'es'] as const)(
    'keeps Quick Check schema and enum fields stable for %s',
    (language) => {
      const prompt = productCheckAiReviewPrompt(language);

      expect(prompt).toContain('Keep JSON keys');
      expect(prompt).toContain('enum values');
      expect(prompt).toContain('reasonCodes');
      expect(prompt).toContain('verdict values');
      expect(prompt).toContain('confidence values');
      expect(prompt).toContain('Translate only user-facing summary text');
    },
  );

  it('uses one canonical English Quick Check prompt with only the output language varied', () => {
    const prompts = quickCheckLanguages.map((language) =>
      productCheckAiReviewPrompt(language),
    );

    const canonicalBodies = prompts.map(stripQuickCheckOutputLanguage);

    expect(new Set(canonicalBodies).size).toBe(1);
    expect(productCheckAiReviewPrompt('en')).toContain(
      'Output language: English',
    );
    expect(productCheckAiReviewPrompt('sv')).toContain(
      'Output language: Swedish',
    );
    expect(productCheckAiReviewPrompt('es')).toContain(
      'Output language: Spanish',
    );
  });

  it('makes the Quick Check specialist prompt explicit and non-branded', () => {
    const prompt = productCheckAiReviewPrompt('en');

    expect(prompt).toContain('for Ritora Quick Check');
    expect(prompt).toContain(
      'Role: act as a skincare ingredient safety and compatibility specialist',
    );
    expect(prompt).toContain('Decision inputs:');
    expect(prompt).toContain('Hard rules:');
    expect(prompt).toContain('Review priority order:');
    expect(prompt).toContain('Verdict policy:');
    expect(prompt).toContain('Reason code policy:');
    expect(prompt).toContain('Confidence policy:');
    expect(prompt).toContain('Output format:');
    expect(prompt).toContain('Do not invent ingredients');
    expect(prompt).toContain('Do not diagnose');
    expect(prompt).toContain('Set suggestedVerdict to null');
    expect(prompt).toContain('only when supplied evidence supports it');
    expect(prompt).toContain(
      'Lower-priority signals must not override higher-priority evidence',
    );
  });

  it.each(['en', 'sv', 'es'] as const)(
    'keeps Product Compare schema and IDs stable for %s',
    (language) => {
      const prompt = productCompareAiReviewPrompt(
        language,
        ProductCompareGoal.NewProductDecision,
      );

      expect(prompt).toContain('Keep JSON keys');
      expect(prompt).toContain('enum values');
      expect(prompt).toContain('reasonCodes');
      expect(prompt).toContain('preferredItemId');
      expect(prompt).toContain('item IDs');
      expect(prompt).toContain('Translate only user-facing summary text');
    },
  );

  it.each([
    ProductCompareGoal.NewProductDecision,
    ProductCompareGoal.ShelfRoutineDecision,
  ])(
    'uses one canonical English Product Compare prompt with only the output language varied for %s',
    (goal) => {
      const prompts = productCompareLanguages.map((language) =>
        productCompareAiReviewPrompt(language, goal),
      );

      const canonicalBodies = prompts.map(stripProductCompareOutputLanguage);

      expect(new Set(canonicalBodies).size).toBe(1);
      expect(productCompareAiReviewPrompt('en', goal)).toContain(
        'Output language: English',
      );
      expect(productCompareAiReviewPrompt('sv', goal)).toContain(
        'Output language: Swedish',
      );
      expect(productCompareAiReviewPrompt('es', goal)).toContain(
        'Output language: Spanish',
      );
    },
  );

  it('makes the Product Compare specialist prompt explicit and deterministic-result-bound', () => {
    const prompt = productCompareAiReviewPrompt(
      'en',
      ProductCompareGoal.NewProductDecision,
    );

    expect(prompt).toContain('for Ritora Product Compare');
    expect(prompt).toContain(
      'Role: act as a skincare product comparison reviewer',
    );
    expect(prompt).toContain('Decision inputs:');
    expect(prompt).toContain('Hard rules:');
    expect(prompt).toContain('Goal policy:');
    expect(prompt).toContain('Preferred item policy:');
    expect(prompt).toContain('Reason code policy:');
    expect(prompt).toContain('Confidence policy:');
    expect(prompt).toContain('Summary policy:');
    expect(prompt).toContain('Output format:');
    expect(prompt).toContain('Do not invent ingredients');
    expect(prompt).toContain('Do not diagnose');
    expect(prompt).toContain(
      'Your role is review and explanation, not independent replacement of the deterministic comparison',
    );
    expect(prompt).toContain(
      'Use a reasonCode only when deterministicComparison.reasonCodes already contains that code or the exact gate for that code is true',
    );
    expect(prompt).toContain(
      `preferredItemId must be null when deterministicComparison.outcome is ${ProductCompareOutcome.NoClearWinner} or ${ProductCompareOutcome.NotEnoughData}`,
    );
    expect(prompt).toContain(
      `${ProductCompareReasonCode.LowerConflict}: use only when preferredItemId is non-null and the preferred item conflictCount is lower than every non-preferred item conflictCount`,
    );
    expect(prompt).toContain(
      `${ProductCompareReasonCode.LessDuplicateExposure}: use only when preferredItemId is non-null and the preferred item overlapCount is lower than every non-preferred item overlapCount`,
    );
    expect(prompt).toContain(
      `${ProductCompareReasonCode.AlreadyOwned}: use only when pairwiseOverlaps has ratio >= 0.75`,
    );
    expect(prompt).toContain(
      `${ProductCompareReasonCode.FillsRoutineGap}: use only for ${ProductCompareGoal.NewProductDecision} when anchor.category is absent from every candidate.category`,
    );
    expect(prompt).toContain(
      'Use high only when deterministicComparison.confidence is high, every item.confidence is high, and every item.matchedIngredientCount is greater than zero',
    );
    expect(prompt).toContain(
      'Do not use buying language for shelf_routine_decision',
    );
  });

  it('keeps Product Compare wording concrete instead of vague', () => {
    const prompt = productCompareAiReviewPrompt(
      'en',
      ProductCompareGoal.NewProductDecision,
    );

    expect(prompt).not.toContain('conflicts favor');
    expect(prompt).not.toContain('evidence is complete');
    expect(prompt).not.toContain('evidence is usable');
    expect(prompt).not.toContain('usable but partial');
    expect(prompt).not.toContain('better fit');
    expect(prompt).not.toContain('sounds more helpful');
    expect(prompt).not.toContain('may discuss');
    expect(prompt).not.toContain('supports that framing');
  });

  it('keeps Product Compare prompt compact enough for a synchronous review path', () => {
    expect(
      productCompareAiReviewPrompt('en', ProductCompareGoal.NewProductDecision)
        .length,
    ).toBeLessThan(6_000);
    expect(
      productCompareAiReviewPrompt(
        'en',
        ProductCompareGoal.ShelfRoutineDecision,
      ).length,
    ).toBeLessThan(6_000);
  });
});

function stripQuickCheckOutputLanguage(prompt: string): string {
  return prompt.replace(
    / Output language: (English|Swedish|Spanish)\. Write summary in (English|Swedish|Spanish)\./,
    '',
  );
}

function stripProductCompareOutputLanguage(prompt: string): string {
  return prompt.replace(
    / Output language: (English|Swedish|Spanish)\. Write summary in (English|Swedish|Spanish)\./,
    '',
  );
}

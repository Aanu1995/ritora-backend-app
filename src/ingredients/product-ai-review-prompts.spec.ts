import { ProductCompareGoal } from './product-compare.types';
import { productCheckAiReviewPrompt } from './product-check-ai-review.prompt';
import { productCompareAiReviewPrompt } from './product-compare-ai-review.prompt';

describe('product AI review prompts', () => {
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
});

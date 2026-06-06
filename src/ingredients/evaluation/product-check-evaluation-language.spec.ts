import { resolveProductCheckEvaluationLanguages } from './product-check-real-life-evaluation.runner';

describe('product check real-life evaluation languages', () => {
  it('defaults to English only for backward-compatible evaluations', () => {
    expect(resolveProductCheckEvaluationLanguages()).toEqual(['en']);
  });

  it('keeps requested supported languages in order and removes duplicates', () => {
    expect(resolveProductCheckEvaluationLanguages(['sv', 'en', 'sv'])).toEqual([
      'sv',
      'en',
    ]);
  });

  it('rejects unsupported languages instead of silently skipping them', () => {
    expect(() => resolveProductCheckEvaluationLanguages(['fr'])).toThrow(
      'Unsupported Quick Check evaluation language: fr',
    );
  });
});

import { ingredientClassificationSystemPrompt } from './ingredient-classifier-contract';
import { ingredientExplanationSystemPrompt } from './openai-explanation.provider';

describe('ingredient analysis AI prompts', () => {
  it('makes ingredient classification a precise source-grounded safety classification task', () => {
    const prompt = ingredientClassificationSystemPrompt();

    expect(prompt).toContain(
      'Role: act as a cosmetic INCI token safety classifier',
    );
    expect(prompt).toContain('Decision inputs:');
    expect(prompt).toContain('Hard rules:');
    expect(prompt).toContain('Category selection policy:');
    expect(prompt).toContain('Safety flag policy:');
    expect(prompt).toContain('Unknown policy:');
    expect(prompt).toContain('Output format:');
    expect(prompt).toContain(
      'Return exactly one classification object for every token',
    );
    expect(prompt).toContain(
      'High-overlap active categories are retinoid, aha, bha, benzoyl-peroxide, and hydroquinone',
    );
    expect(prompt).toContain(
      'Photosensitizing or SPF-support categories are retinoid, aha, bha, pha, and hydroquinone',
    );
    expect(prompt).toContain(
      'only when the token is an INCI name, common synonym, or unambiguous filter/active name',
    );
    expect(prompt).toContain(
      'when the token text itself names an allowed category or common synonym',
    );
    expect(prompt).toContain(
      'Never use user profile, product category, product marketing, routine goals, or assumed product type',
    );
    expect(prompt).toContain('Classify by cosmetic ingredient role');
    expect(prompt).toContain('Do not classify from marketing claims');
    expect(prompt).toContain('Do not invent ingredients');
  });

  it('uses one canonical English explanation prompt with only the output language varied', () => {
    const prompts = (['en', 'sv', 'es'] as const).map((language) =>
      ingredientExplanationSystemPrompt(language),
    );

    const canonicalBodies = prompts.map(stripExplanationOutputLanguage);

    expect(new Set(canonicalBodies).size).toBe(1);
    expect(ingredientExplanationSystemPrompt('en')).toContain(
      'Output language: English',
    );
    expect(ingredientExplanationSystemPrompt('sv')).toContain(
      'Output language: Swedish',
    );
    expect(ingredientExplanationSystemPrompt('es')).toContain(
      'Output language: Spanish',
    );
  });

  it('makes ingredient explanations explicit and non-diagnostic', () => {
    const prompt = ingredientExplanationSystemPrompt('en');

    expect(prompt).toContain(
      'Role: act as a non-diagnostic skincare ingredient explanation specialist',
    );
    expect(prompt).toContain('Decision inputs:');
    expect(prompt).toContain('Hard rules:');
    expect(prompt).toContain('Writing policy:');
    expect(prompt).toContain('Output format:');
    expect(prompt).toContain('Use only supplied conflicts and overlaps');
    expect(prompt).toContain('Do not add new ingredient pairings');
    expect(prompt).toContain('Do not diagnose');
    expect(prompt).toContain(
      'Do not create new advice such as patch testing, stopping a product, adding sunscreen, or seeing a doctor unless supplied in the finding',
    );
    expect(prompt).toContain(
      'Sentence structure: mention the supplied ingredient or pair, the supplied routine concern, and the supplied mitigation only when present',
    );
    expect(prompt).toContain('Keep ids exactly as provided');
    expect(prompt).toContain('Translate only explanation string values');
  });
});

function stripExplanationOutputLanguage(prompt: string): string {
  return prompt.replace(
    / Output language: (English|Swedish|Spanish)\. Write explanation values in (English|Swedish|Spanish)\./,
    '',
  );
}

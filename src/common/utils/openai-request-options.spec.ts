import {
  openAiRepeatabilityRequestOptions,
  supportsOpenAiTemperature,
} from './openai-request-options';

describe('openai request options', () => {
  it('keeps low-temperature sampling for models that support it', () => {
    expect(openAiRepeatabilityRequestOptions('gpt-4.1-mini')).toEqual({
      temperature: 0,
    });
    expect(supportsOpenAiTemperature('gpt-4o-mini')).toBe(true);
  });

  it('omits temperature for reasoning models that reject sampling controls', () => {
    expect(openAiRepeatabilityRequestOptions('gpt-5.5')).toEqual({});
    expect(openAiRepeatabilityRequestOptions(' GPT-5.2 ')).toEqual({});
    expect(openAiRepeatabilityRequestOptions('o4-mini')).toEqual({});
  });
});

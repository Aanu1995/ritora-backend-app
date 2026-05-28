import {
  OPENAI_REASONING_EFFORT,
  openAiRepeatabilityRequestOptions,
  supportsOpenAiTemperature,
} from './openai-request-options';

describe('openai request options', () => {
  it('keeps low-temperature sampling for models that support it', () => {
    expect(openAiRepeatabilityRequestOptions('gpt-4.1-mini')).toEqual({
      reasoning: { effort: OPENAI_REASONING_EFFORT },
      temperature: 0,
    });
    expect(supportsOpenAiTemperature('gpt-4o-mini')).toBe(true);
  });

  it('keeps shared reasoning while omitting temperature for models that reject sampling controls', () => {
    expect(openAiRepeatabilityRequestOptions('gpt-5.5')).toEqual({
      reasoning: { effort: OPENAI_REASONING_EFFORT },
    });
    expect(openAiRepeatabilityRequestOptions(' GPT-5.2 ')).toEqual({
      reasoning: { effort: OPENAI_REASONING_EFFORT },
    });
    expect(openAiRepeatabilityRequestOptions('o4-mini')).toEqual({
      reasoning: { effort: OPENAI_REASONING_EFFORT },
    });
  });
});

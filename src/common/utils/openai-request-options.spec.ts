import {
  OPENAI_REASONING_EFFORT,
  OPENAI_TODAYS_SUGGESTION_REASONING_EFFORT,
  OpenAiReasoningEffort,
  openAiRepeatabilityRequestOptions,
  supportsOpenAiTemperature,
} from './openai-request-options';

describe('openai request options', () => {
  it('uses medium reasoning as the shared default for OpenAI requests', () => {
    expect(OPENAI_REASONING_EFFORT).toBe(OpenAiReasoningEffort.Medium);
  });

  it("keeps a named high-effort exception for Today's Suggestion", () => {
    expect(OPENAI_TODAYS_SUGGESTION_REASONING_EFFORT).toBe(
      OpenAiReasoningEffort.High,
    );
  });

  it('keeps low-temperature sampling for models that support it', () => {
    expect(openAiRepeatabilityRequestOptions('gpt-4.1-mini')).toEqual({
      reasoning: { effort: OPENAI_REASONING_EFFORT },
      temperature: 0,
    });
    expect(supportsOpenAiTemperature('gpt-4o-mini')).toBe(true);
  });

  it('allows a feature to opt into high reasoning without hardcoding the string', () => {
    expect(
      openAiRepeatabilityRequestOptions(
        'gpt-4.1-mini',
        OPENAI_TODAYS_SUGGESTION_REASONING_EFFORT,
      ),
    ).toEqual({
      reasoning: { effort: OpenAiReasoningEffort.High },
      temperature: 0,
    });
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

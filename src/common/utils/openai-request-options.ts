export enum OpenAiReasoningEffort {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

export const OPENAI_REASONING_EFFORT = OpenAiReasoningEffort.Medium;
export const OPENAI_TODAYS_SUGGESTION_REASONING_EFFORT =
  OpenAiReasoningEffort.High;
export const OPENAI_SKIN_JOURNAL_ANALYSIS_REASONING_EFFORT =
  OpenAiReasoningEffort.High;
export const OPENAI_QUICK_SUGGESTION_REASONING_EFFORT =
  OpenAiReasoningEffort.Medium;
export const OPENAI_SMART_PICKS_REASONING_EFFORT = OpenAiReasoningEffort.Medium;
export const OPENAI_INGREDIENT_ANALYSIS_REASONING_EFFORT =
  OpenAiReasoningEffort.Medium;
export const OPENAI_PRODUCT_CHECK_REASONING_EFFORT =
  OpenAiReasoningEffort.Medium;
export const OPENAI_PRODUCT_COMPARE_REASONING_EFFORT =
  OpenAiReasoningEffort.Medium;
export const OPENAI_SKIN_JOURNAL_INSIGHT_REASONING_EFFORT =
  OpenAiReasoningEffort.Medium;
export const OPENAI_CATALOGUE_REASONING_EFFORT = OpenAiReasoningEffort.Low;
export const OPENAI_COMMUNITY_MODERATION_REASONING_EFFORT =
  OpenAiReasoningEffort.Low;
export const OPENAI_INGREDIENT_EXPLANATION_REASONING_EFFORT =
  OpenAiReasoningEffort.Low;
export const OPENAI_INGREDIENT_TRANSLATION_REASONING_EFFORT =
  OpenAiReasoningEffort.Low;

export type OpenAiRepeatabilityRequestOptions = {
  reasoning: {
    effort: OpenAiReasoningEffort;
  };
  temperature?: 0;
};

const TEMPERATURE_UNSUPPORTED_MODEL_PATTERNS = [
  /^gpt-5(?:[.-]|$)/i,
  /^o\d+(?:[.-]|$)/i,
] as const;

export function openAiRepeatabilityRequestOptions(
  model: string,
  reasoningEffort = OPENAI_REASONING_EFFORT,
): OpenAiRepeatabilityRequestOptions {
  const options: OpenAiRepeatabilityRequestOptions = {
    reasoning: { effort: reasoningEffort },
  };

  return supportsOpenAiTemperature(model)
    ? { ...options, temperature: 0 }
    : options;
}

export function supportsOpenAiTemperature(model: string): boolean {
  const normalizedModel = model.trim();
  if (!normalizedModel) return false;
  return !TEMPERATURE_UNSUPPORTED_MODEL_PATTERNS.some((pattern) =>
    pattern.test(normalizedModel),
  );
}

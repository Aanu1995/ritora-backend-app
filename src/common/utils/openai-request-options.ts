export enum OpenAiReasoningEffort {
  High = 'high',
}

export const OPENAI_REASONING_EFFORT = OpenAiReasoningEffort.High;

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
): OpenAiRepeatabilityRequestOptions {
  const options: OpenAiRepeatabilityRequestOptions = {
    reasoning: { effort: OPENAI_REASONING_EFFORT },
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

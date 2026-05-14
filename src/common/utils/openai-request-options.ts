export type OpenAiRepeatabilityRequestOptions = {
  temperature?: 0;
};

const TEMPERATURE_UNSUPPORTED_MODEL_PATTERNS = [
  /^gpt-5(?:[.-]|$)/i,
  /^o\d+(?:[.-]|$)/i,
] as const;

export function openAiRepeatabilityRequestOptions(
  model: string,
): OpenAiRepeatabilityRequestOptions {
  return supportsOpenAiTemperature(model) ? { temperature: 0 } : {};
}

export function supportsOpenAiTemperature(model: string): boolean {
  const normalizedModel = model.trim();
  if (!normalizedModel) return false;
  return !TEMPERATURE_UNSUPPORTED_MODEL_PATTERNS.some((pattern) =>
    pattern.test(normalizedModel),
  );
}

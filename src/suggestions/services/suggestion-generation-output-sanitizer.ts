import { SuggestionGenerationOutput } from './suggestion-ai-generator';
import {
  sanitizeExplanation,
  sanitizeGapRecommendations,
  sanitizeSafetyFlags,
} from './suggestion-ai-assembly';
import { sanitizeSuggestionText } from './suggestion-language';

export function sanitizeSuggestionGenerationOutput(
  output: SuggestionGenerationOutput,
): SuggestionGenerationOutput {
  return {
    ...output,
    explanation: sanitizeExplanation(output.explanation),
    gapRecommendations: sanitizeGapRecommendations(output.gapRecommendations),
    safetyFlags: sanitizeSafetyFlags(output.safetyFlags),
    steps: output.steps.map((step) => ({
      ...step,
      explanation: sanitizeSuggestionText(step.explanation, {
        maxLength: 140,
        maxSentences: 1,
      }),
      chips: step.chips.map((chip) => ({
        ...chip,
        text:
          sanitizeSuggestionText(chip.text, {
            maxLength: 40,
            maxSentences: 1,
          }) ?? '',
      })),
      safetyWarnings: sanitizeSafetyFlags(step.safetyWarnings),
    })),
  };
}

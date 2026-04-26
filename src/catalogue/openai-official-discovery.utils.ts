import { extractJsonObject } from './openai-extraction.utils';

export function extractOfficialDiscoveryUrls(outputText: string): string[] {
  try {
    const parsed = JSON.parse(extractJsonObject(outputText)) as {
      productUrls?: string[];
    };

    if (Array.isArray(parsed.productUrls)) {
      return parsed.productUrls.filter(
        (value): value is string => typeof value === 'string',
      );
    }
  } catch (error) {
    void error;
  }

  return Array.from(
    outputText.matchAll(/https?:\/\/[^\s"'`<>()]+/gi),
    (match) => match[0],
  );
}

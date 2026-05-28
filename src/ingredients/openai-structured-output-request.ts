import {
  extractOutputText,
  type OpenAiResponsePayload,
} from '../catalogue/openai-extraction.utils';

type OpenAiStructuredOutputInput = {
  apiKey: string;
  attempts: number;
  body: unknown;
  timeoutMs: number;
};

export type OpenAiStructuredOutputResult =
  | {
      ok: true;
      attempt: number;
      outputText: string | null;
      payload: OpenAiResponsePayload;
    }
  | {
      ok: false;
      attempt: number;
      status: number;
    };

export async function requestOpenAiStructuredOutput(
  input: OpenAiStructuredOutputInput,
): Promise<OpenAiStructuredOutputResult> {
  const attempts = Math.max(1, input.attempts);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input.body),
      signal: AbortSignal.timeout(input.timeoutMs),
    });

    if (!response.ok) {
      if (attempt < attempts && isRetryableStatus(response.status)) {
        continue;
      }
      return { ok: false, attempt, status: response.status };
    }

    const payload = (await response.json()) as OpenAiResponsePayload;
    const outputText = extractOutputText(payload);
    if (outputText || attempt === attempts) {
      return { ok: true, attempt, outputText, payload };
    }
  }

  return {
    ok: true,
    attempt: attempts,
    outputText: null,
    payload: {},
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

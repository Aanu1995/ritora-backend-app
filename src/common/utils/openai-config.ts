import { ConfigService } from '@nestjs/config';

export const OPENAI_MODEL_ENV_KEY = 'OPENAI_MODEL';

export function readOpenAiModel(
  configService: ConfigService,
  defaultModel: string,
): string | null {
  const configuredModel = configService
    .get<string>(OPENAI_MODEL_ENV_KEY)
    ?.trim();
  if (!configuredModel) {
    return null;
  }

  return configuredModel === 'gpt-5' ? defaultModel : configuredModel;
}

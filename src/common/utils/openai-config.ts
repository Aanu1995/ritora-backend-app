import { ConfigService } from '@nestjs/config';

export const OPENAI_MODEL_ENV_KEY = 'OPENAI_MODEL';
export const CATALOGUE_AI_MODEL_ENV_KEY = 'CATALOGUE_AI_MODEL';
export const INGREDIENT_EXPLANATION_AI_MODEL_ENV_KEY =
  'INGREDIENT_EXPLANATION_AI_MODEL';
export const INGREDIENT_ANALYSIS_AI_MODEL_ENV_KEY =
  'INGREDIENT_ANALYSIS_AI_MODEL';
export const INGREDIENT_TRANSLATION_AI_MODEL_ENV_KEY =
  'INGREDIENT_TRANSLATION_AI_MODEL';
export const SKIN_JOURNAL_ANALYSIS_AI_MODEL_ENV_KEY =
  'SKIN_JOURNAL_ANALYSIS_AI_MODEL';
export const INSIGHTS_AI_MODEL_ENV_KEY = 'INSIGHTS_AI_MODEL';
export const PRODUCT_CHECK_AI_MODEL_ENV_KEY = 'PRODUCT_CHECK_AI_MODEL';
export const COMMUNITY_MODERATION_AI_MODEL_ENV_KEY =
  'COMMUNITY_MODERATION_AI_MODEL';

export function readOpenAiModel(
  configService: ConfigService,
  defaultModel: string,
): string | null {
  return readConfiguredOpenAiModel(
    configService,
    [OPENAI_MODEL_ENV_KEY],
    defaultModel,
  );
}

export function readFeatureOpenAiModel(
  configService: ConfigService,
  featureModelEnvKey: string,
  defaultModel: string,
): string | null {
  return readConfiguredOpenAiModel(
    configService,
    [featureModelEnvKey, OPENAI_MODEL_ENV_KEY],
    defaultModel,
  );
}

function readConfiguredOpenAiModel(
  configService: ConfigService,
  envKeys: string[],
  defaultModel: string,
): string | null {
  for (const envKey of envKeys) {
    const configuredModel = configService.get<string>(envKey)?.trim();
    if (!configuredModel) {
      continue;
    }

    return configuredModel === 'gpt-5' ? defaultModel : configuredModel;
  }

  return null;
}

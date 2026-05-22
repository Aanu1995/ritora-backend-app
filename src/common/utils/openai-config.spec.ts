import { ConfigService } from '@nestjs/config';
import {
  OPENAI_MODEL_ENV_KEY,
  readFeatureOpenAiModel,
  readOpenAiModel,
} from './openai-config';

function config(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('openai-config', () => {
  it('keeps the generic model reader for shared fallback use', () => {
    const model = readOpenAiModel(
      config({ [OPENAI_MODEL_ENV_KEY]: 'generic-model' }),
      'default-model',
    );

    expect(model).toBe('generic-model');
  });

  it('uses a feature-specific model before the generic fallback', () => {
    const model = readFeatureOpenAiModel(
      config({
        FEATURE_AI_MODEL: 'feature-model',
        [OPENAI_MODEL_ENV_KEY]: 'generic-model',
      }),
      'FEATURE_AI_MODEL',
      'default-model',
    );

    expect(model).toBe('feature-model');
  });

  it('falls back to OPENAI_MODEL when the feature-specific model is empty', () => {
    const model = readFeatureOpenAiModel(
      config({
        FEATURE_AI_MODEL: '',
        [OPENAI_MODEL_ENV_KEY]: 'generic-model',
      }),
      'FEATURE_AI_MODEL',
      'default-model',
    );

    expect(model).toBe('generic-model');
  });

  it('maps the deprecated gpt-5 alias to the feature default', () => {
    const model = readFeatureOpenAiModel(
      config({
        FEATURE_AI_MODEL: 'gpt-5',
        [OPENAI_MODEL_ENV_KEY]: 'generic-model',
      }),
      'FEATURE_AI_MODEL',
      'default-model',
    );

    expect(model).toBe('default-model');
  });

  it('returns null when neither feature nor generic model is configured', () => {
    const model = readFeatureOpenAiModel(
      config({
        FEATURE_AI_MODEL: undefined,
        [OPENAI_MODEL_ENV_KEY]: undefined,
      }),
      'FEATURE_AI_MODEL',
      'default-model',
    );

    expect(model).toBeNull();
  });
});

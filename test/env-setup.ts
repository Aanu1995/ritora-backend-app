import { resolve } from 'path';
import {
  appEnvFilePaths,
  evaluationEnvFilePaths,
  EXTERNAL_TEST_SERVICES_ENV,
  loadEnvFiles,
} from '../src/config/env-files';

const rootDir = resolve(__dirname, '..');
const shellProvidedKeys = new Set(Object.keys(process.env));
const E2E_AI_MODEL_ENV_KEYS = [
  'OPENAI_MODEL',
  'CATALOGUE_AI_MODEL',
  'INGREDIENT_ANALYSIS_AI_MODEL',
  'INGREDIENT_EXPLANATION_AI_MODEL',
  'INGREDIENT_TRANSLATION_AI_MODEL',
  'SKIN_JOURNAL_ANALYSIS_AI_MODEL',
  'SUGGESTION_AI_MODEL',
  'SMART_PICKS_AI_MODEL',
  'COMMUNITY_MODERATION_AI_MODEL',
  'INSIGHTS_AI_MODEL',
] as const;

const externalServicesAllowed =
  process.env[EXTERNAL_TEST_SERVICES_ENV] === 'true';

loadEnvFiles(
  externalServicesAllowed ? evaluationEnvFilePaths() : appEnvFilePaths('test'),
  {
    protectedKeys: shellProvidedKeys,
    rootDir,
  },
);

if (!externalServicesAllowed) {
  applyE2eSafeDrivers();
  applyE2eExternalAiIsolation();
}

function applyE2eSafeDrivers(): void {
  process.env.ACCOUNT_DELETION_FINALIZATION_DRIVER = 'database';
  process.env.SMART_PICKS_QUEUE_DRIVER = 'database';
  process.env.SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER = 'database';
  process.env.SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER = 'database';
}

function applyE2eExternalAiIsolation(): void {
  process.env.OPENAI_API_KEY = '';

  for (const key of E2E_AI_MODEL_ENV_KEYS) {
    process.env[key] = '';
  }
}

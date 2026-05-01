import Joi, { type CustomHelpers } from 'joi';

const COOKIE_DOMAIN_PATTERN =
  /^(?:\.[a-z0-9-]+(?:\.[a-z0-9-]+)*|localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)*)$/i;

const productionSecret = Joi.when('NODE_ENV', {
  is: 'production',
  then: Joi.string().trim().min(1).required(),
  otherwise: Joi.string().allow('').default(''),
});

function validateCorsOrigins(value: string, helpers: CustomHelpers<string>) {
  if (value.trim().length === 0) {
    return value;
  }

  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    return helpers.error('any.invalid');
  }

  for (const origin of origins) {
    if (origin === '*') {
      return helpers.error('any.invalid');
    }

    try {
      const url = new URL(origin);
      const protocol = url.protocol.toLowerCase();

      if (protocol !== 'http:' && protocol !== 'https:') {
        return helpers.error('any.invalid');
      }

      if (url.username || url.password) {
        return helpers.error('any.invalid');
      }
    } catch {
      return helpers.error('any.invalid');
    }
  }

  return value;
}

function validateCookieDomain(value: string, helpers: CustomHelpers<string>) {
  const trimmed = value.trim();

  if (!trimmed) {
    return trimmed;
  }

  if (!COOKIE_DOMAIN_PATTERN.test(trimmed)) {
    return helpers.error('any.invalid');
  }

  return trimmed;
}

function validateCookieSettings(
  env: Record<string, unknown>,
  helpers: CustomHelpers<Record<string, unknown>>,
) {
  if (env.COOKIE_SAME_SITE === 'none' && env.COOKIE_SECURE !== true) {
    return helpers.error('any.invalid');
  }

  if (
    typeof env.JWT_SECRET === 'string' &&
    typeof env.JWT_REFRESH_SECRET === 'string' &&
    env.JWT_SECRET.length > 0 &&
    env.JWT_SECRET === env.JWT_REFRESH_SECRET
  ) {
    return helpers.error('any.invalid');
  }

  if (env.NODE_ENV === 'production') {
    const configuredOrigins =
      typeof env.CORS_ORIGINS === 'string' && env.CORS_ORIGINS.trim().length > 0
        ? env.CORS_ORIGINS
        : typeof env.WEB_APP_URL === 'string'
          ? env.WEB_APP_URL
          : '';

    const origins = configuredOrigins
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    const hasInsecureOrigin = origins.some((origin) => {
      try {
        return new URL(origin).protocol.toLowerCase() !== 'https:';
      } catch {
        return true;
      }
    });

    if (hasInsecureOrigin) {
      return helpers.error('any.invalid');
    }
  }

  return env;
}

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  API_PORT: Joi.number().port().default(3001),
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'log', 'debug', 'verbose')
    .default('debug'),

  DATABASE_HOST: Joi.string().trim().default('localhost'),
  DATABASE_PORT: Joi.number().port().default(5432),
  DATABASE_NAME: Joi.string().trim().default('ritora'),
  DATABASE_USER: Joi.string().trim().default('postgres'),
  DATABASE_PASSWORD: productionSecret,
  DATABASE_SSL: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.boolean().valid(true).default(true),
    otherwise: Joi.boolean().default(false),
  }),
  DATABASE_LOGGING: Joi.boolean().default(false),
  DATABASE_SSL_REJECT_UNAUTHORIZED: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.boolean().default(true),
    otherwise: Joi.boolean().default(false),
  }),

  CORS_ORIGINS: Joi.string()
    .trim()
    .default('')
    .custom(validateCorsOrigins, 'CORS origin validation'),

  JWT_SECRET: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().trim().min(32).required(),
    otherwise: Joi.string().trim().default('dev-jwt-secret-change-me'),
  }),
  JWT_REFRESH_SECRET: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().trim().min(32).required(),
    otherwise: Joi.string().trim().default('dev-refresh-secret-change-me'),
  }),
  JWT_ACCESS_EXPIRY: Joi.string().trim().default('15m'),
  JWT_REFRESH_EXPIRY: Joi.string().trim().default('7d'),
  JWT_ISSUER: Joi.string().trim().default('ritora'),
  JWT_AUDIENCE: Joi.string().trim().default('ritora-web'),

  COOKIE_DOMAIN: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .trim()
      .min(1)
      .custom(validateCookieDomain, 'cookie domain validation')
      .required(),
    otherwise: Joi.string()
      .allow('')
      .custom(validateCookieDomain, 'cookie domain validation')
      .default(''),
  }),
  COOKIE_SECURE: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.boolean().valid(true).required(),
    otherwise: Joi.boolean().default(false),
  }),
  COOKIE_SAME_SITE: Joi.string().valid('lax', 'strict', 'none').default('lax'),
  COOKIE_REFRESH_NAME: Joi.string().trim().default('ritora_refresh'),

  BCRYPT_SALT_ROUNDS: Joi.when('NODE_ENV', {
    is: 'test',
    then: Joi.number().integer().min(4).max(14).default(4),
    otherwise: Joi.number().integer().min(10).max(14).default(12),
  }),
  EMAIL_VERIFICATION_EXPIRY: Joi.string().trim().default('24h'),
  PASSWORD_RESET_EXPIRY: Joi.string().trim().default('1h'),

  RESEND_API_KEY: Joi.when('NODE_ENV', {
    is: 'test',
    then: Joi.string().trim().default('re_test_mock'),
    otherwise: productionSecret,
  }),
  OPENAI_API_KEY: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().trim().min(1).required(),
    otherwise: Joi.string().trim().allow('').default(''),
  }),
  OPENAI_MODEL: Joi.string().trim().allow('').default(''),
  CATALOGUE_AI_MODEL: Joi.string().trim().allow('').default('gpt-5.5'),
  INGREDIENT_EXPLANATION_AI_MODEL: Joi.string()
    .trim()
    .allow('')
    .default('gpt-5.5'),
  INGREDIENT_TRANSLATION_AI_MODEL: Joi.string()
    .trim()
    .allow('')
    .default('gpt-5.5'),
  SKIN_JOURNAL_ANALYSIS_AI_MODEL: Joi.string()
    .trim()
    .allow('')
    .default('gpt-5.5'),
  OPENAI_PRODUCT_DISCOVERY_REASONING_EFFORT: Joi.string()
    .trim()
    .allow('')
    .default('low'),
  OPENAI_PRODUCT_DISCOVERY_WEB_REASONING_EFFORT: Joi.string()
    .trim()
    .allow('')
    .default(''),
  INSIGHTS_AI_MODEL: Joi.string().trim().allow('').default('gpt-5.5'),
  SKIN_JOURNAL_ANALYSIS_INPUT_TOKEN_COST_PER_1M_USD: Joi.number()
    .min(0)
    .default(0),
  SKIN_JOURNAL_ANALYSIS_OUTPUT_TOKEN_COST_PER_1M_USD: Joi.number()
    .min(0)
    .default(0),
  SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().valid('sqs', 'database').default('sqs'),
    otherwise: Joi.string().valid('sqs', 'database').default('database'),
  }),
  SKIN_JOURNAL_ANALYSIS_SQS_QUEUE_URL: Joi.when(
    'SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER',
    {
      is: 'sqs',
      then: Joi.string()
        .trim()
        .uri({ scheme: ['https'] })
        .required(),
      otherwise: Joi.string().trim().allow('').default(''),
    },
  ),
  SKIN_JOURNAL_ANALYSIS_SQS_DLQ_URL: Joi.string()
    .trim()
    .uri({ scheme: ['https'] })
    .allow('')
    .default(''),
  SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().valid('sqs', 'database').default('sqs'),
    otherwise: Joi.string().valid('sqs', 'database').default('database'),
  }),
  SKIN_JOURNAL_INSIGHT_SQS_QUEUE_URL: Joi.when(
    'SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER',
    {
      is: 'sqs',
      then: Joi.string()
        .trim()
        .uri({ scheme: ['https'] })
        .required(),
      otherwise: Joi.string().trim().allow('').default(''),
    },
  ),
  SKIN_JOURNAL_INSIGHT_SQS_DLQ_URL: Joi.string()
    .trim()
    .uri({ scheme: ['https'] })
    .allow('')
    .default(''),
  SKIN_JOURNAL_OPERATIONS_TOKEN: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().trim().min(32).required(),
    otherwise: Joi.string().trim().allow('').default(''),
  }),
  SKIN_JOURNAL_ANALYSIS_WORKER_ENABLED: Joi.any().strip(),
  SKIN_JOURNAL_ANALYSIS_SQS_WAIT_TIME_SECONDS: Joi.any().strip(),
  SKIN_JOURNAL_ANALYSIS_SQS_VISIBILITY_TIMEOUT_SECONDS: Joi.any().strip(),
  SKIN_JOURNAL_ANALYSIS_JOB_LOCK_TTL_SECONDS: Joi.any().strip(),
  SKIN_JOURNAL_ANALYSIS_JOB_MAX_ATTEMPTS: Joi.any().strip(),
  SKIN_JOURNAL_ANALYSIS_JOB_BACKOFF_BASE_SECONDS: Joi.any().strip(),
  SKIN_JOURNAL_ANALYSIS_JOB_BACKOFF_MAX_SECONDS: Joi.any().strip(),
  SKIN_JOURNAL_INSIGHT_SQS_WAIT_TIME_SECONDS: Joi.any().strip(),
  SKIN_JOURNAL_INSIGHT_SQS_VISIBILITY_TIMEOUT_SECONDS: Joi.any().strip(),
  SKIN_JOURNAL_INSIGHT_JOB_LOCK_TTL_SECONDS: Joi.any().strip(),
  SKIN_JOURNAL_INSIGHT_JOB_MAX_ATTEMPTS: Joi.any().strip(),
  SKIN_JOURNAL_INSIGHT_JOB_BACKOFF_BASE_SECONDS: Joi.any().strip(),
  SKIN_JOURNAL_INSIGHT_JOB_BACKOFF_MAX_SECONDS: Joi.any().strip(),
  SKIN_PROFILE_FIELD_ENCRYPTION_KEY: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().trim().min(32).required(),
    otherwise: Joi.string().trim().allow('').default(''),
  }),
  SKIN_PROFILE_FIELD_ENCRYPTION_KEY_ID: Joi.string()
    .trim()
    .max(64)
    .default('primary'),
  MAIL_FROM: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().email().required(),
    otherwise: Joi.string().email().default('onboarding@resend.dev'),
  }),

  WEB_APP_URL: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .uri({ scheme: ['https'] })
      .required(),
    otherwise: Joi.string()
      .uri({ scheme: ['http', 'https'] })
      .default('http://localhost:3000'),
  }),

  SWAGGER_ENABLED: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.boolean().default(false),
    otherwise: Joi.boolean().default(true),
  }),

  AWS_REGION: Joi.string().trim().default('eu-west-1'),
  PRODUCT_MEDIA_BUCKET: Joi.string().trim().allow('').default(''),
  PRODUCT_MEDIA_CLOUDFRONT_URL: Joi.string()
    .trim()
    .uri({ scheme: ['https'] })
    .allow('')
    .default(''),
  PRODUCT_MEDIA_CLOUDFRONT_KEY_PAIR_ID: Joi.string()
    .trim()
    .allow('')
    .default(''),
  PRODUCT_MEDIA_CLOUDFRONT_PRIVATE_KEY: Joi.string().allow('').default(''),
  PRODUCT_MEDIA_S3_KMS_KEY_ID: Joi.string().trim().allow('').default(''),
  PRODUCT_EXTRACTION_IMAGE_MAX_DIMENSION: Joi.number()
    .integer()
    .min(1024)
    .max(4096)
    .default(2400),
  PRODUCT_EXTRACTION_IMAGE_WEBP_QUALITY: Joi.number()
    .integer()
    .min(70)
    .max(95)
    .default(90),

  LEGAL_TERMS_VERSION: Joi.string().trim().default('1.0.0'),
  LEGAL_PRIVACY_VERSION: Joi.string().trim().default('1.0.0'),

  SKIN_JOURNAL_MEDIA_BUCKET: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().trim().min(1).required(),
    otherwise: Joi.string().trim().allow('').default(''),
  }),
  SKIN_JOURNAL_MEDIA_CLOUDFRONT_URL: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .trim()
      .uri({ scheme: ['https'] })
      .required(),
    otherwise: Joi.string()
      .trim()
      .uri({ scheme: ['https'] })
      .allow('')
      .default(''),
  }),
  SKIN_JOURNAL_MEDIA_CLOUDFRONT_KEY_PAIR_ID: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().trim().min(1).required(),
    otherwise: Joi.string().trim().allow('').default(''),
  }),
  SKIN_JOURNAL_MEDIA_CLOUDFRONT_PRIVATE_KEY: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().trim().min(1).required(),
    otherwise: Joi.string().allow('').default(''),
  }),
  SKIN_JOURNAL_S3_KMS_KEY_ID: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().trim().min(1).required(),
    otherwise: Joi.string().trim().allow('').default(''),
  }),
})
  .custom(validateCookieSettings, 'cookie security validation')
  .unknown(true);

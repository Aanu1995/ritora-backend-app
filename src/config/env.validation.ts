import Joi, { type CustomHelpers } from 'joi';

const COOKIE_DOMAIN_PATTERN =
  /^(?:\.[a-z0-9-]+(?:\.[a-z0-9-]+)*|localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)*)$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

const environmentSecret = Joi.when('NODE_ENV', {
  is: 'production',
  then: Joi.string().trim().min(1).required(),
  otherwise: Joi.string().allow('').required(),
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

function validateBase64UrlBytes(
  value: string,
  expectedBytes: number,
  helpers: CustomHelpers<string>,
) {
  const trimmed = value.trim();

  if (!trimmed) {
    return trimmed;
  }

  if (!BASE64URL_PATTERN.test(trimmed)) {
    return helpers.error('any.invalid');
  }

  const padding = '='.repeat((4 - (trimmed.length % 4)) % 4);
  const decoded = Buffer.from(
    `${trimmed}${padding}`.replace(/-/g, '+').replace(/_/g, '/'),
    'base64',
  );

  if (decoded.length !== expectedBytes) {
    return helpers.error('any.invalid');
  }

  return trimmed;
}

function validateVapidPublicKey(value: string, helpers: CustomHelpers<string>) {
  const decoded = validateBase64UrlBytes(value, 65, helpers);
  if (typeof decoded !== 'string') {
    return decoded;
  }

  const padding = '='.repeat((4 - (decoded.length % 4)) % 4);
  const bytes = Buffer.from(
    `${decoded}${padding}`.replace(/-/g, '+').replace(/_/g, '/'),
    'base64',
  );

  return bytes[0] === 4 ? decoded : helpers.error('any.invalid');
}

function validateVapidPrivateKey(
  value: string,
  helpers: CustomHelpers<string>,
) {
  return validateBase64UrlBytes(value, 32, helpers);
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
    if (
      typeof env.MAIL_FROM === 'string' &&
      typeof env.NOTIFICATION_MAIL_FROM === 'string' &&
      env.MAIL_FROM.trim().toLowerCase() ===
        env.NOTIFICATION_MAIL_FROM.trim().toLowerCase()
    ) {
      return helpers.error('any.invalid');
    }

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
  NODE_ENV: Joi.string().valid('development', 'production', 'test').required(),

  API_PORT: Joi.number().port().required(),
  API_PUBLIC_URL: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .trim()
      .uri({ scheme: ['https'] })
      .required(),
    otherwise: Joi.string()
      .trim()
      .uri({ scheme: ['http', 'https'] })
      .allow('')
      .default(''),
  }),
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'log', 'debug', 'verbose')
    .required(),
  OTEL_ENABLED: Joi.boolean().required(),
  OTEL_SERVICE_NAME: Joi.string().trim().min(1).required(),
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string()
    .trim()
    .uri({ scheme: ['http', 'https'] })
    .allow('')
    .required(),
  OTEL_EXPORTER_OTLP_HEADERS: Joi.string().trim().allow('').required(),

  DATABASE_HOST: Joi.string().trim().required(),
  DATABASE_PORT: Joi.number().port().required(),
  DATABASE_NAME: Joi.string().trim().required(),
  DATABASE_USER: Joi.string().trim().required(),
  DATABASE_PASSWORD: environmentSecret,
  DATABASE_SSL: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.boolean().valid(true).required(),
    otherwise: Joi.boolean().required(),
  }),
  DATABASE_LOGGING: Joi.boolean().required(),
  DATABASE_SSL_REJECT_UNAUTHORIZED: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.boolean().required(),
    otherwise: Joi.boolean().required(),
  }),

  CORS_ORIGINS: Joi.string()
    .trim()
    .allow('')
    .required()
    .custom(validateCorsOrigins, 'CORS origin validation'),

  JWT_SECRET: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().trim().min(32).required(),
    otherwise: Joi.string().trim().min(1).required(),
  }),
  JWT_REFRESH_SECRET: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().trim().min(32).required(),
    otherwise: Joi.string().trim().min(1).required(),
  }),
  JWT_ACCESS_EXPIRY: Joi.string().trim().required(),
  JWT_REFRESH_EXPIRY: Joi.string().trim().required(),
  JWT_ISSUER: Joi.string().trim().required(),
  JWT_AUDIENCE: Joi.string().trim().required(),

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
      .required(),
  }),
  COOKIE_SECURE: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.boolean().valid(true).required(),
    otherwise: Joi.boolean().required(),
  }),
  COOKIE_SAME_SITE: Joi.string().valid('lax', 'strict', 'none').required(),
  COOKIE_REFRESH_NAME: Joi.string().trim().required(),

  BCRYPT_SALT_ROUNDS: Joi.when('NODE_ENV', {
    is: 'test',
    then: Joi.number().integer().min(4).max(14).required(),
    otherwise: Joi.number().integer().min(10).max(14).required(),
  }),
  EMAIL_VERIFICATION_EXPIRY: Joi.string().trim().required(),
  PASSWORD_RESET_EXPIRY: Joi.string().trim().required(),
  GOOGLE_CLIENT_ID: Joi.string().trim().min(1).required(),
  GOOGLE_CLIENT_SECRET: Joi.string().trim().min(1).required(),
  GOOGLE_CALLBACK_URL: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .trim()
      .uri({ scheme: ['https'] })
      .required(),
    otherwise: Joi.string()
      .trim()
      .uri({ scheme: ['http', 'https'] })
      .required(),
  }),
  APPLE_CLIENT_ID: Joi.string().trim().min(1).required(),
  APPLE_TEAM_ID: Joi.string().trim().min(1).required(),
  APPLE_KEY_ID: Joi.string().trim().min(1).required(),
  APPLE_PRIVATE_KEY: Joi.string().min(1).required(),
  APPLE_CALLBACK_URL: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .trim()
      .uri({ scheme: ['https'] })
      .required(),
    otherwise: Joi.string()
      .trim()
      .uri({ scheme: ['http', 'https'] })
      .required(),
  }),

  RESEND_API_KEY: Joi.when('NODE_ENV', {
    is: 'test',
    then: Joi.string().trim().required(),
    otherwise: environmentSecret,
  }),
  OPENAI_API_KEY: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().trim().min(1).required(),
    otherwise: Joi.string().trim().allow('').required(),
  }),
  OPENAI_MODEL: Joi.string().trim().allow('').required(),
  CATALOGUE_AI_MODEL: Joi.string().trim().allow('').required(),
  INGREDIENT_EXPLANATION_AI_MODEL: Joi.string().trim().allow('').required(),
  INGREDIENT_TRANSLATION_AI_MODEL: Joi.string().trim().allow('').required(),
  INGREDIENT_TRANSLATION_SOURCE_LANGUAGE: Joi.string().trim().required(),
  SKIN_JOURNAL_ANALYSIS_AI_MODEL: Joi.string().trim().allow('').required(),
  SUGGESTION_AI_MODEL: Joi.string().trim().allow('').required(),
  SMART_PICKS_AI_MODEL: Joi.string().trim().allow('').required(),
  SMART_PICKS_QUEUE_DRIVER: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().valid('sqs').required(),
    otherwise: Joi.string().valid('sqs', 'database').required(),
  }),
  SMART_PICKS_SQS_QUEUE_URL: Joi.when('SMART_PICKS_QUEUE_DRIVER', {
    is: 'sqs',
    then: Joi.string()
      .trim()
      .uri({ scheme: ['https'] })
      .required(),
    otherwise: Joi.string().trim().allow('').required(),
  }),
  SMART_PICKS_SQS_DLQ_URL: Joi.string()
    .trim()
    .uri({ scheme: ['https'] })
    .allow('')
    .required(),
  OPENAI_PRODUCT_DISCOVERY_REASONING_EFFORT: Joi.string()
    .trim()
    .allow('')
    .required(),
  OPENAI_PRODUCT_DISCOVERY_WEB_REASONING_EFFORT: Joi.string()
    .trim()
    .allow('')
    .required(),
  INSIGHTS_AI_MODEL: Joi.string().trim().allow('').required(),
  SKIN_JOURNAL_ANALYSIS_INPUT_TOKEN_COST_PER_1M_USD: Joi.number()
    .min(0)
    .required(),
  SKIN_JOURNAL_ANALYSIS_OUTPUT_TOKEN_COST_PER_1M_USD: Joi.number()
    .min(0)
    .required(),
  SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER: Joi.string()
    .valid('sqs', 'database')
    .required(),
  SKIN_JOURNAL_ANALYSIS_SQS_QUEUE_URL: Joi.when(
    'SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER',
    {
      is: 'sqs',
      then: Joi.string()
        .trim()
        .uri({ scheme: ['https'] })
        .required(),
      otherwise: Joi.string().trim().allow('').required(),
    },
  ),
  SKIN_JOURNAL_ANALYSIS_SQS_DLQ_URL: Joi.string()
    .trim()
    .uri({ scheme: ['https'] })
    .allow('')
    .required(),
  SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER: Joi.string()
    .valid('sqs', 'database')
    .required(),
  SKIN_JOURNAL_INSIGHT_SQS_QUEUE_URL: Joi.when(
    'SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER',
    {
      is: 'sqs',
      then: Joi.string()
        .trim()
        .uri({ scheme: ['https'] })
        .required(),
      otherwise: Joi.string().trim().allow('').required(),
    },
  ),
  SKIN_JOURNAL_INSIGHT_SQS_DLQ_URL: Joi.string()
    .trim()
    .uri({ scheme: ['https'] })
    .allow('')
    .required(),
  SKIN_JOURNAL_OPERATIONS_TOKEN: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().trim().min(32).required(),
    otherwise: Joi.string().trim().allow('').required(),
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
    otherwise: Joi.string().trim().allow('').required(),
  }),
  SKIN_PROFILE_FIELD_ENCRYPTION_KEY_ID: Joi.string().trim().max(64).required(),
  MAIL_FROM: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().trim().email().required(),
    otherwise: Joi.string().trim().email().required(),
  }),
  NOTIFICATION_MAIL_FROM: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().trim().email().required(),
    otherwise: Joi.string().trim().email().allow('').default(''),
  }),
  MAIL_UNSUBSCRIBE_SECRET: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().trim().min(32).required(),
    otherwise: Joi.string().trim().allow('').default(''),
  }),

  WEB_APP_URL: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .uri({ scheme: ['https'] })
      .required(),
    otherwise: Joi.string()
      .uri({ scheme: ['http', 'https'] })
      .required(),
  }),
  WEB_PUSH_VAPID_PUBLIC_KEY: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().trim().min(1).custom(validateVapidPublicKey).required(),
    otherwise: Joi.string()
      .trim()
      .allow('')
      .custom(validateVapidPublicKey)
      .required(),
  }),
  WEB_PUSH_VAPID_PRIVATE_KEY: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().trim().min(1).custom(validateVapidPrivateKey).required(),
    otherwise: Joi.string()
      .trim()
      .allow('')
      .custom(validateVapidPrivateKey)
      .required(),
  }),
  WEB_PUSH_SUBJECT: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .trim()
      .uri({ scheme: ['mailto', 'https'] })
      .required(),
    otherwise: Joi.string()
      .trim()
      .uri({ scheme: ['mailto', 'http', 'https'] })
      .allow('')
      .required(),
  }),
  SWAGGER_ENABLED: Joi.boolean().required(),

  AWS_REGION: Joi.string().trim().required(),
  PRODUCT_MEDIA_BUCKET: Joi.string().trim().allow('').required(),
  PRODUCT_MEDIA_CLOUDFRONT_URL: Joi.string()
    .trim()
    .uri({ scheme: ['https'] })
    .allow('')
    .required(),
  PRODUCT_MEDIA_CLOUDFRONT_KEY_PAIR_ID: Joi.string()
    .trim()
    .allow('')
    .required(),
  PRODUCT_MEDIA_CLOUDFRONT_PRIVATE_KEY: Joi.string().allow('').required(),
  PRODUCT_MEDIA_S3_KMS_KEY_ID: Joi.string().trim().allow('').required(),
  PRODUCT_EXTRACTION_IMAGE_MAX_DIMENSION: Joi.number()
    .integer()
    .min(1024)
    .max(4096)
    .required(),
  PRODUCT_EXTRACTION_IMAGE_WEBP_QUALITY: Joi.number()
    .integer()
    .min(70)
    .max(95)
    .required(),

  LEGAL_TERMS_VERSION: Joi.string().trim().required(),
  LEGAL_PRIVACY_VERSION: Joi.string().trim().required(),

  SKIN_JOURNAL_MEDIA_BUCKET: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().trim().min(1).required(),
    otherwise: Joi.string().trim().allow('').required(),
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
      .required(),
  }),
  SKIN_JOURNAL_MEDIA_CLOUDFRONT_KEY_PAIR_ID: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().trim().min(1).required(),
    otherwise: Joi.string().trim().allow('').required(),
  }),
  SKIN_JOURNAL_MEDIA_CLOUDFRONT_PRIVATE_KEY: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().trim().min(1).required(),
    otherwise: Joi.string().allow('').required(),
  }),
  SKIN_JOURNAL_S3_KMS_KEY_ID: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().trim().min(1).required(),
    otherwise: Joi.string().trim().allow('').required(),
  }),
})
  .custom(validateCookieSettings, 'cookie security validation')
  .unknown(true);

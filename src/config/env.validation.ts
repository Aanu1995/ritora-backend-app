import * as Joi from 'joi';

const COOKIE_DOMAIN_PATTERN =
  /^(?:\.[a-z0-9-]+(?:\.[a-z0-9-]+)*|localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)*)$/i;

const productionSecret = Joi.when('NODE_ENV', {
  is: 'production',
  then: Joi.string().trim().min(1).required(),
  otherwise: Joi.string().allow('').default(''),
});

function validateCorsOrigins(
  value: string,
  helpers: Joi.CustomHelpers<string>,
) {
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

function validateCookieDomain(
  value: string,
  helpers: Joi.CustomHelpers<string>,
) {
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
  helpers: Joi.CustomHelpers<Record<string, unknown>>,
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
  DATABASE_SSL: Joi.boolean().default(false),
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
  OPENAI_API_KEY: Joi.string().trim().allow('').default(''),
  OPENAI_PRODUCT_DISCOVERY_MODEL: Joi.string().trim().default('gpt-5'),
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
  PRODUCT_MEDIA_SIGNED_URL_TTL_SECONDS: Joi.number()
    .integer()
    .min(300)
    .max(86400)
    .default(3600),
  PRODUCT_MEDIA_PROCESSED_MAX_DIMENSION: Joi.number()
    .integer()
    .min(512)
    .max(4096)
    .default(1600),
  PRODUCT_MEDIA_WEBP_QUALITY: Joi.number()
    .integer()
    .min(60)
    .max(95)
    .default(82),

  LEGAL_TERMS_VERSION: Joi.string().trim().default('1.0.0'),
  LEGAL_PRIVACY_VERSION: Joi.string().trim().default('1.0.0'),
})
  .custom(validateCookieSettings, 'cookie security validation')
  .unknown(true);

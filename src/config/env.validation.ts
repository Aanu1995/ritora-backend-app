import * as Joi from 'joi';

const productionSecret = Joi.when('NODE_ENV', {
  is: 'production',
  then: Joi.string().trim().min(1).required(),
  otherwise: Joi.string().allow('').default(''),
});

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

  CORS_ORIGINS: Joi.string().trim().default('http://localhost:3000'),

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
    then: Joi.string().trim().min(1).required(),
    otherwise: Joi.string().allow('').default(''),
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
  MAIL_FROM: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().email().required(),
    otherwise: Joi.string().email().default('onboarding@resend.dev'),
  }),

  FRONTEND_URL: Joi.when('NODE_ENV', {
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

  LEGAL_TERMS_VERSION: Joi.string().trim().default('1.0.0'),
  LEGAL_PRIVACY_VERSION: Joi.string().trim().default('1.0.0'),
}).unknown(true);

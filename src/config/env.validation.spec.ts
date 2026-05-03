import { envValidationSchema } from './env.validation';

function validateEnv(input: Record<string, unknown>): {
  error?: Error;
  value: Record<string, unknown>;
} {
  const result = envValidationSchema.validate(input);

  return {
    error: result.error,
    value: result.value as Record<string, unknown>,
  };
}

function developmentEnv(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    NODE_ENV: 'development',
    API_PORT: 3001,
    LOG_LEVEL: 'debug',
    DATABASE_HOST: 'localhost',
    DATABASE_PORT: 5432,
    DATABASE_NAME: 'ritora',
    DATABASE_USER: 'postgres',
    DATABASE_PASSWORD: '',
    DATABASE_SSL: false,
    DATABASE_LOGGING: false,
    DATABASE_SSL_REJECT_UNAUTHORIZED: false,
    CORS_ORIGINS: 'http://localhost:3000',
    JWT_SECRET: 'dev-jwt-secret-change-me',
    JWT_REFRESH_SECRET: 'dev-refresh-secret-change-me',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    JWT_ISSUER: 'ritora',
    JWT_AUDIENCE: 'ritora-web',
    COOKIE_DOMAIN: '',
    COOKIE_SECURE: false,
    COOKIE_SAME_SITE: 'lax',
    COOKIE_REFRESH_NAME: 'ritora_refresh',
    BCRYPT_SALT_ROUNDS: 12,
    EMAIL_VERIFICATION_EXPIRY: '24h',
    PASSWORD_RESET_EXPIRY: '1h',
    GOOGLE_CLIENT_ID: 'dev-google-client-id',
    GOOGLE_CLIENT_SECRET: 'dev-google-client-secret',
    GOOGLE_CALLBACK_URL: 'http://localhost:3001/api/v1/auth/google/callback',
    APPLE_CLIENT_ID: 'com.ritora.dev',
    APPLE_TEAM_ID: 'TEAM123456',
    APPLE_KEY_ID: 'KEY1234567',
    APPLE_PRIVATE_KEY:
      '-----BEGIN PRIVATE KEY-----\\nmock\\n-----END PRIVATE KEY-----',
    APPLE_CALLBACK_URL: 'http://localhost:3001/api/v1/auth/apple/callback',
    RESEND_API_KEY: '',
    OPENAI_API_KEY: '',
    OPENAI_MODEL: '',
    CATALOGUE_AI_MODEL: 'gpt-5.5',
    INGREDIENT_EXPLANATION_AI_MODEL: 'gpt-5.5',
    INGREDIENT_TRANSLATION_AI_MODEL: 'gpt-5.5',
    INGREDIENT_TRANSLATION_SOURCE_LANGUAGE: 'en',
    SKIN_JOURNAL_ANALYSIS_AI_MODEL: 'gpt-5.5',
    OPENAI_PRODUCT_DISCOVERY_REASONING_EFFORT: 'low',
    OPENAI_PRODUCT_DISCOVERY_WEB_REASONING_EFFORT: '',
    INSIGHTS_AI_MODEL: 'gpt-5.5',
    SKIN_JOURNAL_ANALYSIS_INPUT_TOKEN_COST_PER_1M_USD: 0,
    SKIN_JOURNAL_ANALYSIS_OUTPUT_TOKEN_COST_PER_1M_USD: 0,
    SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER: 'database',
    SKIN_JOURNAL_ANALYSIS_SQS_QUEUE_URL: '',
    SKIN_JOURNAL_ANALYSIS_SQS_DLQ_URL: '',
    SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER: 'database',
    SKIN_JOURNAL_INSIGHT_SQS_QUEUE_URL: '',
    SKIN_JOURNAL_INSIGHT_SQS_DLQ_URL: '',
    SKIN_JOURNAL_OPERATIONS_TOKEN: '',
    SKIN_PROFILE_FIELD_ENCRYPTION_KEY: '',
    SKIN_PROFILE_FIELD_ENCRYPTION_KEY_ID: 'primary',
    MAIL_FROM: 'onboarding@resend.dev',
    WEB_APP_URL: 'http://localhost:3000',
    SWAGGER_ENABLED: true,
    AWS_REGION: 'eu-north-1',
    PRODUCT_MEDIA_BUCKET: '',
    PRODUCT_MEDIA_CLOUDFRONT_URL: '',
    PRODUCT_MEDIA_CLOUDFRONT_KEY_PAIR_ID: '',
    PRODUCT_MEDIA_CLOUDFRONT_PRIVATE_KEY: '',
    PRODUCT_MEDIA_S3_KMS_KEY_ID: '',
    PRODUCT_EXTRACTION_IMAGE_MAX_DIMENSION: 2400,
    PRODUCT_EXTRACTION_IMAGE_WEBP_QUALITY: 90,
    LEGAL_TERMS_VERSION: '1.0.0',
    LEGAL_PRIVACY_VERSION: '1.0.0',
    SKIN_JOURNAL_MEDIA_BUCKET: '',
    SKIN_JOURNAL_MEDIA_CLOUDFRONT_URL: '',
    SKIN_JOURNAL_MEDIA_CLOUDFRONT_KEY_PAIR_ID: '',
    SKIN_JOURNAL_MEDIA_CLOUDFRONT_PRIVATE_KEY: '',
    SKIN_JOURNAL_S3_KMS_KEY_ID: '',
    ...overrides,
  };
}

function productionEnv(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return developmentEnv({
    NODE_ENV: 'production',
    LOG_LEVEL: 'warn',
    DATABASE_PASSWORD: 'postgres-password',
    DATABASE_SSL: true,
    DATABASE_SSL_REJECT_UNAUTHORIZED: true,
    CORS_ORIGINS: 'https://app.ritora.com',
    JWT_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    COOKIE_DOMAIN: 'ritora.com',
    COOKIE_SECURE: true,
    RESEND_API_KEY: 're_prod_mock',
    OPENAI_API_KEY: 'sk-prod-mock',
    GOOGLE_CLIENT_ID: 'google-client-id',
    GOOGLE_CLIENT_SECRET: 'google-client-secret',
    GOOGLE_CALLBACK_URL: 'https://api.ritora.com/api/v1/auth/google/callback',
    APPLE_CLIENT_ID: 'com.ritora.web',
    APPLE_TEAM_ID: 'TEAM123456',
    APPLE_KEY_ID: 'KEY1234567',
    APPLE_PRIVATE_KEY:
      '-----BEGIN PRIVATE KEY-----\\nmock\\n-----END PRIVATE KEY-----',
    APPLE_CALLBACK_URL: 'https://api.ritora.com/api/v1/auth/apple/callback',
    SKIN_PROFILE_FIELD_ENCRYPTION_KEY: 'c'.repeat(32),
    MAIL_FROM: 'noreply@ritora.com',
    WEB_APP_URL: 'https://app.ritora.com',
    SWAGGER_ENABLED: false,
    PRODUCT_MEDIA_BUCKET: 'ritora-prod-product-media',
    PRODUCT_MEDIA_CLOUDFRONT_URL: 'https://products.ritora.com',
    PRODUCT_MEDIA_CLOUDFRONT_KEY_PAIR_ID: 'KPRODUCT',
    PRODUCT_MEDIA_CLOUDFRONT_PRIVATE_KEY:
      '-----BEGIN PRIVATE KEY-----\\nmock\\n-----END PRIVATE KEY-----',
    PRODUCT_MEDIA_S3_KMS_KEY_ID: 'arn:aws:kms:eu-west-1:123:key/product',
    SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER: 'sqs',
    SKIN_JOURNAL_ANALYSIS_SQS_QUEUE_URL:
      'https://sqs.eu-west-1.amazonaws.com/123/skin-journal-analysis',
    SKIN_JOURNAL_ANALYSIS_SQS_DLQ_URL: '',
    SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER: 'sqs',
    SKIN_JOURNAL_INSIGHT_SQS_QUEUE_URL:
      'https://sqs.eu-west-1.amazonaws.com/123/skin-journal-insights',
    SKIN_JOURNAL_INSIGHT_SQS_DLQ_URL: '',
    SKIN_JOURNAL_OPERATIONS_TOKEN: 'o'.repeat(32),
    SKIN_JOURNAL_MEDIA_BUCKET: 'ritora-prod-skin-journal',
    SKIN_JOURNAL_MEDIA_CLOUDFRONT_URL: 'https://media.ritora.com',
    SKIN_JOURNAL_MEDIA_CLOUDFRONT_KEY_PAIR_ID: 'K123',
    SKIN_JOURNAL_MEDIA_CLOUDFRONT_PRIVATE_KEY:
      '-----BEGIN PRIVATE KEY-----\\nmock\\n-----END PRIVATE KEY-----',
    SKIN_JOURNAL_S3_KMS_KEY_ID: 'arn:aws:kms:eu-west-1:123:key/mock',
    ...overrides,
  });
}

describe('envValidationSchema', () => {
  it('accepts explicit development environment values', () => {
    const result = validateEnv(developmentEnv());

    expect(result.error).toBeUndefined();
    expect(result.value).toMatchObject({
      API_PORT: 3001,
      CORS_ORIGINS: 'http://localhost:3000',
      DATABASE_SSL_REJECT_UNAUTHORIZED: false,
      JWT_SECRET: 'dev-jwt-secret-change-me',
      JWT_REFRESH_SECRET: 'dev-refresh-secret-change-me',
      MAIL_FROM: 'onboarding@resend.dev',
      COOKIE_DOMAIN: '',
      SWAGGER_ENABLED: true,
    });
  });

  it('requires explicit values instead of applying Joi defaults', () => {
    const result = validateEnv({ NODE_ENV: 'development' });

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('API_PORT');
  });

  it('keeps feature-specific OpenAI models explicit and OPENAI_MODEL as fallback only', () => {
    const result = validateEnv(developmentEnv());

    expect(result.error).toBeUndefined();
    expect(result.value.OPENAI_MODEL).toBe('');
    expect(result.value.CATALOGUE_AI_MODEL).toBe('gpt-5.5');
    expect(result.value.INGREDIENT_EXPLANATION_AI_MODEL).toBe('gpt-5.5');
    expect(result.value.INGREDIENT_TRANSLATION_AI_MODEL).toBe('gpt-5.5');
    expect(result.value.SKIN_JOURNAL_ANALYSIS_AI_MODEL).toBe('gpt-5.5');
    expect(result.value.INSIGHTS_AI_MODEL).toBe('gpt-5.5');
  });

  it('honors explicit production swagger and database SSL settings', () => {
    const result = validateEnv(productionEnv());

    expect(result.error).toBeUndefined();
    expect(result.value.SWAGGER_ENABLED).toBe(false);
    expect(result.value.DATABASE_SSL).toBe(true);
    expect(result.value.DATABASE_SSL_REJECT_UNAUTHORIZED).toBe(true);
  });

  it('allows extra process environment variables from npm and shells', () => {
    const result = validateEnv(
      developmentEnv({ npm_package_name: 'ritora-backend-app' }),
    );

    expect(result.error).toBeUndefined();
  });

  it('allows lower bcrypt rounds in test', () => {
    const result = validateEnv(
      developmentEnv({
        NODE_ENV: 'test',
        API_PORT: 3002,
        LOG_LEVEL: 'error',
        BCRYPT_SALT_ROUNDS: 4,
        RESEND_API_KEY: 're_test_mock',
        SWAGGER_ENABLED: false,
      }),
    );

    expect(result.error).toBeUndefined();
    expect(result.value.BCRYPT_SALT_ROUNDS).toBe(4);
  });

  it('requires OAuth strategy values outside production because Passport needs them at boot', () => {
    const googleResult = validateEnv(developmentEnv({ GOOGLE_CLIENT_ID: '' }));
    const appleResult = validateEnv(developmentEnv({ APPLE_CLIENT_ID: '' }));

    expect(googleResult.error).toBeDefined();
    expect(googleResult.error?.message).toContain('GOOGLE_CLIENT_ID');
    expect(appleResult.error).toBeDefined();
    expect(appleResult.error?.message).toContain('APPLE_CLIENT_ID');
  });

  it('does not expose Skin Journal product policy constants as env defaults', () => {
    const result = validateEnv(developmentEnv());

    expect(result.error).toBeUndefined();
    expect(result.value.SKIN_JOURNAL_LOCAL_DIR).toBeUndefined();
    expect(result.value.SKIN_JOURNAL_PUBLIC_URL_PREFIX).toBeUndefined();
    expect(
      result.value.SKIN_JOURNAL_MEDIA_SIGNED_URL_TTL_SECONDS,
    ).toBeUndefined();
    expect(result.value.SKIN_JOURNAL_PHOTO_MAX_BYTES).toBeUndefined();
    expect(result.value.SKIN_JOURNAL_PHOTO_MAX_DIMENSION).toBeUndefined();
    expect(result.value.SKIN_JOURNAL_PHOTO_WEBP_QUALITY).toBeUndefined();
    expect(result.value.SKIN_JOURNAL_ANALYSIS_MOCK).toBeUndefined();
    expect(result.value.SKIN_JOURNAL_ANALYSIS_TIMEOUT_MS).toBeUndefined();
    expect(result.value.SKIN_JOURNAL_ANALYSIS_MAX_CONCURRENT).toBeUndefined();
    expect(
      result.value.SKIN_JOURNAL_ANALYSIS_MAX_CONCURRENT_PER_USER,
    ).toBeUndefined();
    expect(result.value.SKIN_JOURNAL_ANALYSIS_DAILY_BUDGET_USD).toBeUndefined();
    expect(result.value.SKIN_JOURNAL_ANALYSIS_WORKER_ENABLED).toBeUndefined();
    expect(
      result.value.SKIN_JOURNAL_ANALYSIS_SQS_WAIT_TIME_SECONDS,
    ).toBeUndefined();
    expect(
      result.value.SKIN_JOURNAL_ANALYSIS_SQS_VISIBILITY_TIMEOUT_SECONDS,
    ).toBeUndefined();
    expect(
      result.value.SKIN_JOURNAL_ANALYSIS_JOB_LOCK_TTL_SECONDS,
    ).toBeUndefined();
    expect(result.value.SKIN_JOURNAL_ANALYSIS_JOB_MAX_ATTEMPTS).toBeUndefined();
    expect(
      result.value.SKIN_JOURNAL_ANALYSIS_JOB_BACKOFF_BASE_SECONDS,
    ).toBeUndefined();
    expect(
      result.value.SKIN_JOURNAL_ANALYSIS_JOB_BACKOFF_MAX_SECONDS,
    ).toBeUndefined();
    expect(result.value.SKIN_JOURNAL_REMINDER_DEFAULT_TIME).toBeUndefined();
    expect(result.value.SKIN_JOURNAL_WRAPPED_MIN_PHOTOS).toBeUndefined();
  });

  it('does not expose product media processing policy constants as env defaults', () => {
    const result = validateEnv(developmentEnv());

    expect(result.error).toBeUndefined();
    expect(result.value.PRODUCT_MEDIA_SIGNED_URL_TTL_SECONDS).toBeUndefined();
    expect(result.value.PRODUCT_MEDIA_PROCESSED_MAX_DIMENSION).toBeUndefined();
    expect(result.value.PRODUCT_MEDIA_WEBP_QUALITY).toBeUndefined();
  });

  it('requires production secrets and cookie domain', () => {
    const result = validateEnv(
      productionEnv({
        JWT_SECRET: '',
        JWT_REFRESH_SECRET: '',
        COOKIE_DOMAIN: '',
        RESEND_API_KEY: '',
      }),
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('JWT_SECRET');
  });

  it('rejects wildcard cors origins when credentials are enabled', () => {
    const result = validateEnv(developmentEnv({ CORS_ORIGINS: '*' }));

    expect(result.error).toBeDefined();
  });

  it('rejects insecure same-site none cookies', () => {
    const result = validateEnv(
      productionEnv({ COOKIE_SECURE: false, COOKIE_SAME_SITE: 'none' }),
    );

    expect(result.error).toBeDefined();
  });

  it('rejects malformed cookie domains', () => {
    const result = validateEnv(
      productionEnv({ COOKIE_DOMAIN: 'https://ritora.com/app' }),
    );

    expect(result.error).toBeDefined();
  });

  it('rejects using the same secret for access and refresh tokens', () => {
    const sharedSecret = 'a'.repeat(32);
    const result = validateEnv(
      productionEnv({
        JWT_SECRET: sharedSecret,
        JWT_REFRESH_SECRET: sharedSecret,
      }),
    );

    expect(result.error).toBeDefined();
  });

  it('rejects non-https cors origins in production', () => {
    const result = validateEnv(
      productionEnv({ CORS_ORIGINS: 'http://localhost:3000' }),
    );

    expect(result.error).toBeDefined();
  });

  it('requires production Skin Journal media storage configuration', () => {
    const result = validateEnv(
      productionEnv({ SKIN_JOURNAL_MEDIA_BUCKET: undefined }),
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('SKIN_JOURNAL_MEDIA_BUCKET');
  });

  it('requires production OpenAI key for Skin Journal analysis', () => {
    const result = validateEnv(productionEnv({ OPENAI_API_KEY: '' }));

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('OPENAI_API_KEY');
  });

  it('requires an SQS queue URL in production when the analysis queue driver is SQS', () => {
    const result = validateEnv(
      productionEnv({ SKIN_JOURNAL_ANALYSIS_SQS_QUEUE_URL: '' }),
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain(
      'SKIN_JOURNAL_ANALYSIS_SQS_QUEUE_URL',
    );
  });

  it('requires an operations token in production', () => {
    const result = validateEnv(
      productionEnv({ SKIN_JOURNAL_OPERATIONS_TOKEN: '' }),
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('SKIN_JOURNAL_OPERATIONS_TOKEN');
  });

  it('requires explicit queue drivers outside production', () => {
    const result = validateEnv(
      developmentEnv({
        SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER: undefined,
        SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER: undefined,
      }),
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain(
      'SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER',
    );
  });

  it('requires an SQS queue URL in production when the insight queue driver is SQS', () => {
    const result = validateEnv(
      productionEnv({ SKIN_JOURNAL_INSIGHT_SQS_QUEUE_URL: '' }),
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain(
      'SKIN_JOURNAL_INSIGHT_SQS_QUEUE_URL',
    );
  });

  it('strips Skin Journal queue policy values even when provided', () => {
    const result = validateEnv(
      developmentEnv({
        SKIN_JOURNAL_ANALYSIS_WORKER_ENABLED: 'false',
        SKIN_JOURNAL_ANALYSIS_SQS_WAIT_TIME_SECONDS: '20',
        SKIN_JOURNAL_ANALYSIS_SQS_VISIBILITY_TIMEOUT_SECONDS: '900',
        SKIN_JOURNAL_ANALYSIS_JOB_LOCK_TTL_SECONDS: '3600',
        SKIN_JOURNAL_ANALYSIS_JOB_MAX_ATTEMPTS: '20',
        SKIN_JOURNAL_ANALYSIS_JOB_BACKOFF_BASE_SECONDS: '60',
        SKIN_JOURNAL_ANALYSIS_JOB_BACKOFF_MAX_SECONDS: '7200',
        SKIN_JOURNAL_INSIGHT_SQS_WAIT_TIME_SECONDS: '20',
        SKIN_JOURNAL_INSIGHT_SQS_VISIBILITY_TIMEOUT_SECONDS: '900',
        SKIN_JOURNAL_INSIGHT_JOB_LOCK_TTL_SECONDS: '3600',
        SKIN_JOURNAL_INSIGHT_JOB_MAX_ATTEMPTS: '20',
        SKIN_JOURNAL_INSIGHT_JOB_BACKOFF_BASE_SECONDS: '60',
        SKIN_JOURNAL_INSIGHT_JOB_BACKOFF_MAX_SECONDS: '7200',
      }),
    );

    expect(result.error).toBeUndefined();
    expect(result.value.SKIN_JOURNAL_ANALYSIS_WORKER_ENABLED).toBeUndefined();
    expect(
      result.value.SKIN_JOURNAL_ANALYSIS_SQS_WAIT_TIME_SECONDS,
    ).toBeUndefined();
    expect(
      result.value.SKIN_JOURNAL_ANALYSIS_SQS_VISIBILITY_TIMEOUT_SECONDS,
    ).toBeUndefined();
    expect(
      result.value.SKIN_JOURNAL_ANALYSIS_JOB_LOCK_TTL_SECONDS,
    ).toBeUndefined();
    expect(result.value.SKIN_JOURNAL_ANALYSIS_JOB_MAX_ATTEMPTS).toBeUndefined();
    expect(
      result.value.SKIN_JOURNAL_ANALYSIS_JOB_BACKOFF_BASE_SECONDS,
    ).toBeUndefined();
    expect(
      result.value.SKIN_JOURNAL_ANALYSIS_JOB_BACKOFF_MAX_SECONDS,
    ).toBeUndefined();
    expect(
      result.value.SKIN_JOURNAL_INSIGHT_SQS_WAIT_TIME_SECONDS,
    ).toBeUndefined();
    expect(
      result.value.SKIN_JOURNAL_INSIGHT_SQS_VISIBILITY_TIMEOUT_SECONDS,
    ).toBeUndefined();
    expect(
      result.value.SKIN_JOURNAL_INSIGHT_JOB_LOCK_TTL_SECONDS,
    ).toBeUndefined();
    expect(result.value.SKIN_JOURNAL_INSIGHT_JOB_MAX_ATTEMPTS).toBeUndefined();
    expect(
      result.value.SKIN_JOURNAL_INSIGHT_JOB_BACKOFF_BASE_SECONDS,
    ).toBeUndefined();
    expect(
      result.value.SKIN_JOURNAL_INSIGHT_JOB_BACKOFF_MAX_SECONDS,
    ).toBeUndefined();
  });
});

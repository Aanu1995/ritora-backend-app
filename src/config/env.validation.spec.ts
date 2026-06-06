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
    OTEL_ENABLED: false,
    OTEL_SERVICE_NAME: 'ritora-backend-api',
    OTEL_EXPORTER_OTLP_ENDPOINT: '',
    OTEL_EXPORTER_OTLP_HEADERS: '',
    DATABASE_HOST: 'localhost',
    DATABASE_PORT: 5432,
    DATABASE_NAME: 'ritora',
    DATABASE_USER: 'postgres',
    DATABASE_PASSWORD: '',
    DATABASE_SSL: false,
    DATABASE_LOGGING: false,
    DATABASE_SSL_REJECT_UNAUTHORIZED: false,
    CORS_ORIGINS: 'http://localhost:3000,http://localhost:3002',
    ADMIN_ROOT_EMAIL: 'owner@ritora.app',
    ADMIN_ROOT_SETUP_EXPIRY: '24h',
    ADMIN_ROOT_SETUP_TOKEN_HASH:
      'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb',
    ADMIN_COOKIE_REFRESH_NAME: 'ritora_admin_refresh',
    ADMIN_INVITATION_EXPIRY: '7d',
    ADMIN_WEB_APP_URL: 'http://localhost:3002',
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
    GOOGLE_ID_TOKEN_AUDIENCES: 'dev-google-web-client-id',
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
    INGREDIENT_ANALYSIS_AI_MODEL: 'gpt-5.5',
    INGREDIENT_EXPLANATION_AI_MODEL: 'gpt-5.5',
    INGREDIENT_TRANSLATION_AI_MODEL: 'gpt-5.5',
    INGREDIENT_TRANSLATION_SOURCE_LANGUAGE: 'en',
    SKIN_JOURNAL_ANALYSIS_AI_MODEL: 'gpt-5.5',
    SUGGESTION_AI_MODEL: 'gpt-5.5',
    SMART_PICKS_AI_MODEL: 'gpt-5.5',
    COMMUNITY_MODERATION_AI_MODEL: 'gpt-5.5',
    INGREDIENT_ANALYSIS_QUEUE_DRIVER: 'database',
    INGREDIENT_ANALYSIS_SQS_QUEUE_URL: '',
    INGREDIENT_ANALYSIS_SQS_DLQ_URL: '',
    SMART_PICKS_QUEUE_DRIVER: 'database',
    SMART_PICKS_SQS_QUEUE_URL: '',
    SMART_PICKS_SQS_DLQ_URL: '',
    ACCOUNT_DELETION_FINALIZATION_DRIVER: 'database',
    ACCOUNT_DELETION_SQS_QUEUE_URL: '',
    ACCOUNT_DELETION_SQS_QUEUE_ARN: '',
    ACCOUNT_DELETION_SCHEDULER_ROLE_ARN: '',
    ACCOUNT_DELETION_SCHEDULER_GROUP: '',
    ACCOUNT_DELETION_SCHEDULER_DLQ_ARN: '',
    ACCOUNT_MONITORING_QUEUE_DRIVER: 'none',
    ACCOUNT_MONITORING_SQS_QUEUE_URL: '',
    ACCOUNT_MONITORING_SQS_DLQ_URL: '',
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
    NOTIFICATION_MAIL_FROM: '',
    SUPPORT_EMAIL: 'support@getritora.com',
    MAIL_UNSUBSCRIBE_SECRET: '',
    WEB_APP_URL: 'http://localhost:3000',
    API_PUBLIC_URL: '',
    WEB_PUSH_VAPID_PUBLIC_KEY: '',
    WEB_PUSH_VAPID_PRIVATE_KEY: '',
    WEB_PUSH_SUBJECT: 'mailto:support@getritora.com',
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
    ADMIN_ROOT_EMAIL: 'owner@ritora.app',
    ADMIN_ROOT_SETUP_TOKEN_HASH: 'a'.repeat(64),
    ADMIN_WEB_APP_URL: 'https://admin.ritora.com',
    JWT_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    COOKIE_DOMAIN: 'ritora.com',
    COOKIE_SECURE: true,
    RESEND_API_KEY: 're_prod_mock',
    OPENAI_API_KEY: 'sk-prod-mock',
    GOOGLE_CLIENT_ID: 'google-client-id',
    GOOGLE_CLIENT_SECRET: 'google-client-secret',
    GOOGLE_CALLBACK_URL: 'https://api.ritora.com/api/v1/auth/google/callback',
    GOOGLE_ID_TOKEN_AUDIENCES: 'google-client-id,ios-google-client-id',
    APPLE_CLIENT_ID: 'com.ritora.web',
    APPLE_TEAM_ID: 'TEAM123456',
    APPLE_KEY_ID: 'KEY1234567',
    APPLE_PRIVATE_KEY:
      '-----BEGIN PRIVATE KEY-----\\nmock\\n-----END PRIVATE KEY-----',
    APPLE_CALLBACK_URL: 'https://api.ritora.com/api/v1/auth/apple/callback',
    SKIN_PROFILE_FIELD_ENCRYPTION_KEY: 'c'.repeat(32),
    MAIL_FROM: 'noreply@ritora.com',
    NOTIFICATION_MAIL_FROM: 'notifications@ritora.com',
    MAIL_UNSUBSCRIBE_SECRET: 'u'.repeat(32),
    WEB_APP_URL: 'https://app.ritora.com',
    API_PUBLIC_URL: 'https://api.ritora.com/api/v1',
    WEB_PUSH_VAPID_PUBLIC_KEY:
      'BGtkbcjrO12YMoDuq2sCQeHlu47uPx3SHTgFKZFYiBW8Qr0D9vgyZSZPdw6_4ZFEI9Snk1VEAj2qTYI1I1YxBXE',
    WEB_PUSH_VAPID_PRIVATE_KEY: 'I0_d0vnesxbBSUmlDdOKibGo6vEXRO-Vu88QlSlm5j0',
    WEB_PUSH_SUBJECT: 'mailto:support@getritora.com',
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
    SMART_PICKS_QUEUE_DRIVER: 'sqs',
    SMART_PICKS_SQS_QUEUE_URL:
      'https://sqs.eu-west-1.amazonaws.com/123/smart-picks',
    SMART_PICKS_SQS_DLQ_URL: '',
    INGREDIENT_ANALYSIS_QUEUE_DRIVER: 'sqs',
    INGREDIENT_ANALYSIS_SQS_QUEUE_URL:
      'https://sqs.eu-west-1.amazonaws.com/123/ingredient-analysis',
    INGREDIENT_ANALYSIS_SQS_DLQ_URL: '',
    ACCOUNT_DELETION_FINALIZATION_DRIVER: 'eventbridge-sqs',
    ACCOUNT_DELETION_SQS_QUEUE_URL:
      'https://sqs.eu-west-1.amazonaws.com/123/account-deletions',
    ACCOUNT_DELETION_SQS_QUEUE_ARN:
      'arn:aws:sqs:eu-west-1:123:account-deletions',
    ACCOUNT_DELETION_SCHEDULER_ROLE_ARN:
      'arn:aws:iam::123:role/account-deletion-scheduler',
    ACCOUNT_DELETION_SCHEDULER_GROUP: 'account-deletions',
    ACCOUNT_DELETION_SCHEDULER_DLQ_ARN: '',
    ACCOUNT_MONITORING_QUEUE_DRIVER: 'sqs',
    ACCOUNT_MONITORING_SQS_QUEUE_URL:
      'https://sqs.eu-west-1.amazonaws.com/123/account-monitoring',
    ACCOUNT_MONITORING_SQS_DLQ_URL: '',
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
      CORS_ORIGINS: 'http://localhost:3000,http://localhost:3002',
      DATABASE_SSL_REJECT_UNAUTHORIZED: false,
      OTEL_ENABLED: false,
      OTEL_SERVICE_NAME: 'ritora-backend-api',
      JWT_SECRET: 'dev-jwt-secret-change-me',
      JWT_REFRESH_SECRET: 'dev-refresh-secret-change-me',
      MAIL_FROM: 'onboarding@resend.dev',
      NOTIFICATION_MAIL_FROM: '',
      SUPPORT_EMAIL: 'support@getritora.com',
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
    expect(result.value.INGREDIENT_ANALYSIS_AI_MODEL).toBe('gpt-5.5');
    expect(result.value.INGREDIENT_EXPLANATION_AI_MODEL).toBe('gpt-5.5');
    expect(result.value.INGREDIENT_TRANSLATION_AI_MODEL).toBe('gpt-5.5');
    expect(result.value.SKIN_JOURNAL_ANALYSIS_AI_MODEL).toBe('gpt-5.5');
    expect(result.value.SUGGESTION_AI_MODEL).toBe('gpt-5.5');
    expect(result.value.SMART_PICKS_AI_MODEL).toBe('gpt-5.5');
    expect(result.value.COMMUNITY_MODERATION_AI_MODEL).toBe('gpt-5.5');
    expect(result.value.INSIGHTS_AI_MODEL).toBe('gpt-5.5');
  });

  it('honors explicit production swagger and database SSL settings', () => {
    const result = validateEnv(productionEnv());

    expect(result.error).toBeUndefined();
    expect(result.value.SWAGGER_ENABLED).toBe(false);
    expect(result.value.DATABASE_SSL).toBe(true);
    expect(result.value.DATABASE_SSL_REJECT_UNAUTHORIZED).toBe(true);
  });

  it('allows production database SSL to be disabled for private database hosts', () => {
    const result = validateEnv(
      productionEnv({
        DATABASE_HOST: '10.10.0.5',
        DATABASE_SSL: false,
        DATABASE_SSL_REJECT_UNAUTHORIZED: false,
      }),
    );

    expect(result.error).toBeUndefined();
    expect(result.value.DATABASE_SSL).toBe(false);
  });

  it('rejects disabled production database SSL for public database hosts', () => {
    const result = validateEnv(
      productionEnv({
        DATABASE_HOST: 'db.example.com',
        DATABASE_SSL: false,
        DATABASE_SSL_REJECT_UNAUTHORIZED: false,
      }),
    );

    expect(result.error).toBeDefined();
  });

  it('requires Web Push VAPID credentials in production', () => {
    const result = validateEnv(
      productionEnv({
        WEB_PUSH_VAPID_PUBLIC_KEY: '',
      }),
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('WEB_PUSH_VAPID_PUBLIC_KEY');
  });

  it('requires the root admin email in every environment', () => {
    const result = validateEnv(
      developmentEnv({
        ADMIN_ROOT_EMAIL: '',
      }),
    );

    expect(result.error?.message).toContain('ADMIN_ROOT_EMAIL');
  });

  it('strips the legacy root setup token hash when present', () => {
    const result = validateEnv(
      productionEnv({
        ADMIN_ROOT_SETUP_TOKEN_HASH: 'legacy-no-longer-used',
      }),
    );

    expect(result.error).toBeUndefined();
    expect(result.value.ADMIN_ROOT_SETUP_TOKEN_HASH).toBeUndefined();
  });

  it('allows the legacy root setup token hash to be omitted', () => {
    const input = developmentEnv();
    delete input.ADMIN_ROOT_SETUP_TOKEN_HASH;

    const result = validateEnv(input);

    expect(result.error).toBeUndefined();
    expect(result.value.ADMIN_ROOT_SETUP_TOKEN_HASH).toBeUndefined();
  });

  it('rejects raw root setup tokens in every environment', () => {
    const result = validateEnv(
      developmentEnv({
        ADMIN_ROOT_SETUP_TOKEN: 'b'.repeat(64),
      }),
    );

    expect(result.error?.message).toContain('ADMIN_ROOT_SETUP_TOKEN');
  });

  it('rejects malformed root admin emails', () => {
    const result = validateEnv(
      developmentEnv({
        ADMIN_ROOT_EMAIL: 'not-an-email',
      }),
    );

    expect(result.error?.message).toContain('ADMIN_ROOT_EMAIL');
  });

  it('requires one-click unsubscribe signing config in production', () => {
    const result = validateEnv(
      productionEnv({
        MAIL_UNSUBSCRIBE_SECRET: '',
      }),
    );

    expect(result.error?.message).toContain('MAIL_UNSUBSCRIBE_SECRET');
  });

  it('requires a valid support email in every environment', () => {
    const result = validateEnv(
      developmentEnv({
        SUPPORT_EMAIL: 'not-an-email',
      }),
    );

    expect(result.error?.message).toContain('SUPPORT_EMAIL');
  });

  it('requires a notification email sender in production', () => {
    const missingResult = validateEnv(
      productionEnv({
        NOTIFICATION_MAIL_FROM: '',
      }),
    );
    expect(missingResult.error?.message).toContain('NOTIFICATION_MAIL_FROM');

    const sharedSenderResult = validateEnv(
      productionEnv({
        NOTIFICATION_MAIL_FROM: 'noreply@ritora.com',
      }),
    );
    expect(sharedSenderResult.error).toBeUndefined();
  });

  it('requires a public HTTPS API URL for production email unsubscribe links', () => {
    const result = validateEnv(
      productionEnv({
        API_PUBLIC_URL: '',
      }),
    );

    expect(result.error?.message).toContain('API_PUBLIC_URL');
  });

  it('rejects malformed Web Push VAPID credentials in production', () => {
    const result = validateEnv(
      productionEnv({
        WEB_PUSH_VAPID_PUBLIC_KEY: 'not-a-public-key',
        WEB_PUSH_VAPID_PRIVATE_KEY: 'not-a-private-key',
      }),
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('WEB_PUSH_VAPID_PUBLIC_KEY');
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
    const googleAudienceResult = validateEnv(
      developmentEnv({ GOOGLE_ID_TOKEN_AUDIENCES: '' }),
    );
    const appleResult = validateEnv(developmentEnv({ APPLE_CLIENT_ID: '' }));

    expect(googleResult.error).toBeDefined();
    expect(googleResult.error?.message).toContain('GOOGLE_CLIENT_ID');
    expect(googleAudienceResult.error).toBeDefined();
    expect(googleAudienceResult.error?.message).toContain(
      'GOOGLE_ID_TOKEN_AUDIENCES',
    );
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

  it('requires an explicit Smart Picks queue driver outside production', () => {
    const result = validateEnv(
      developmentEnv({
        SMART_PICKS_QUEUE_DRIVER: undefined,
      }),
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('SMART_PICKS_QUEUE_DRIVER');
  });

  it('requires an explicit ingredient analysis queue driver outside production', () => {
    const result = validateEnv(
      developmentEnv({
        INGREDIENT_ANALYSIS_QUEUE_DRIVER: undefined,
      }),
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('INGREDIENT_ANALYSIS_QUEUE_DRIVER');
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

  it('requires an SQS queue URL when the Smart Picks queue driver is SQS', () => {
    const result = validateEnv(
      productionEnv({
        SMART_PICKS_QUEUE_DRIVER: 'sqs',
        SMART_PICKS_SQS_QUEUE_URL: '',
      }),
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('SMART_PICKS_SQS_QUEUE_URL');
  });

  it('requires an SQS queue URL when the ingredient analysis queue driver is SQS', () => {
    const result = validateEnv(
      productionEnv({
        INGREDIENT_ANALYSIS_QUEUE_DRIVER: 'sqs',
        INGREDIENT_ANALYSIS_SQS_QUEUE_URL: '',
      }),
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain(
      'INGREDIENT_ANALYSIS_SQS_QUEUE_URL',
    );
  });

  it('requires the Smart Picks queue driver to be SQS in production', () => {
    const result = validateEnv(
      productionEnv({
        SMART_PICKS_QUEUE_DRIVER: 'database',
        SMART_PICKS_SQS_QUEUE_URL: '',
      }),
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('SMART_PICKS_QUEUE_DRIVER');
  });

  it('requires the ingredient analysis queue driver to be SQS in production', () => {
    const result = validateEnv(
      productionEnv({
        INGREDIENT_ANALYSIS_QUEUE_DRIVER: 'database',
        INGREDIENT_ANALYSIS_SQS_QUEUE_URL: '',
      }),
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('INGREDIENT_ANALYSIS_QUEUE_DRIVER');
  });

  it('requires EventBridge Scheduler backed account deletion in production', () => {
    const result = validateEnv(
      productionEnv({
        ACCOUNT_DELETION_FINALIZATION_DRIVER: 'database',
        ACCOUNT_DELETION_SQS_QUEUE_URL: '',
        ACCOUNT_DELETION_SQS_QUEUE_ARN: '',
        ACCOUNT_DELETION_SCHEDULER_ROLE_ARN: '',
      }),
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain(
      'ACCOUNT_DELETION_FINALIZATION_DRIVER',
    );
  });

  it('requires account deletion SQS and scheduler targets when EventBridge is enabled', () => {
    const result = validateEnv(
      productionEnv({
        ACCOUNT_DELETION_SQS_QUEUE_URL: '',
        ACCOUNT_DELETION_SQS_QUEUE_ARN: '',
        ACCOUNT_DELETION_SCHEDULER_ROLE_ARN: '',
      }),
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('ACCOUNT_DELETION_SQS_QUEUE_URL');
  });

  it('requires account monitoring SQS in production', () => {
    const result = validateEnv(
      productionEnv({
        ACCOUNT_MONITORING_QUEUE_DRIVER: 'none',
        ACCOUNT_MONITORING_SQS_QUEUE_URL: '',
      }),
    );

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('ACCOUNT_MONITORING_QUEUE_DRIVER');
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

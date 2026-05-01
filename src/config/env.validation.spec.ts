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

describe('envValidationSchema', () => {
  it('applies development defaults and allows empty dev-only fields', () => {
    const result = validateEnv({
      NODE_ENV: 'development',
      DATABASE_PASSWORD: '',
      RESEND_API_KEY: '',
      COOKIE_DOMAIN: '',
    });

    expect(result.error).toBeUndefined();
    expect(result.value).toMatchObject({
      API_PORT: 3001,
      CORS_ORIGINS: '',
      DATABASE_SSL_REJECT_UNAUTHORIZED: false,
      JWT_SECRET: 'dev-jwt-secret-change-me',
      JWT_REFRESH_SECRET: 'dev-refresh-secret-change-me',
      MAIL_FROM: 'onboarding@resend.dev',
      COOKIE_DOMAIN: '',
      SWAGGER_ENABLED: true,
    });
  });

  it('sets feature-specific OpenAI model defaults and keeps OPENAI_MODEL as fallback only', () => {
    const result = validateEnv({
      NODE_ENV: 'development',
    });

    expect(result.error).toBeUndefined();
    expect(result.value.OPENAI_MODEL).toBe('');
    expect(result.value.CATALOGUE_AI_MODEL).toBe('gpt-5.5');
    expect(result.value.INGREDIENT_EXPLANATION_AI_MODEL).toBe('gpt-5.5');
    expect(result.value.INGREDIENT_TRANSLATION_AI_MODEL).toBe('gpt-5.5');
    expect(result.value.SKIN_JOURNAL_ANALYSIS_AI_MODEL).toBe('gpt-5.5');
    expect(result.value.INSIGHTS_AI_MODEL).toBe('gpt-5.5');
  });

  it('disables swagger by default in production', () => {
    const result = validateEnv({
      NODE_ENV: 'production',
      DATABASE_PASSWORD: 'postgres-password',
      JWT_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      COOKIE_DOMAIN: 'ritora.com',
      COOKIE_SECURE: true,
      RESEND_API_KEY: 're_prod_mock',
      OPENAI_API_KEY: 'sk-prod-mock',
      SKIN_PROFILE_FIELD_ENCRYPTION_KEY: 'c'.repeat(32),
      MAIL_FROM: 'noreply@ritora.com',
      WEB_APP_URL: 'https://app.ritora.com',
      SKIN_JOURNAL_MEDIA_BUCKET: 'ritora-prod-skin-journal',
      SKIN_JOURNAL_MEDIA_CLOUDFRONT_URL: 'https://media.ritora.com',
      SKIN_JOURNAL_MEDIA_CLOUDFRONT_KEY_PAIR_ID: 'K123',
      SKIN_JOURNAL_MEDIA_CLOUDFRONT_PRIVATE_KEY:
        '-----BEGIN PRIVATE KEY-----\\nmock\\n-----END PRIVATE KEY-----',
      SKIN_JOURNAL_S3_KMS_KEY_ID: 'arn:aws:kms:eu-west-1:123:key/mock',
      SKIN_JOURNAL_ANALYSIS_SQS_QUEUE_URL:
        'https://sqs.eu-west-1.amazonaws.com/123/skin-journal-analysis',
      SKIN_JOURNAL_INSIGHT_SQS_QUEUE_URL:
        'https://sqs.eu-west-1.amazonaws.com/123/skin-journal-insights',
      SKIN_JOURNAL_OPERATIONS_TOKEN: 'o'.repeat(32),
    });

    expect(result.error).toBeUndefined();
    expect(result.value.SWAGGER_ENABLED).toBe(false);
    expect(result.value.DATABASE_SSL).toBe(true);
    expect(result.value.DATABASE_SSL_REJECT_UNAUTHORIZED).toBe(true);
  });

  it('allows extra process environment variables from npm and shells', () => {
    const result = validateEnv({
      NODE_ENV: 'development',
      npm_package_name: 'ritora-backend-app',
    });

    expect(result.error).toBeUndefined();
  });

  it('allows lower bcrypt rounds in test', () => {
    const result = validateEnv({
      NODE_ENV: 'test',
      BCRYPT_SALT_ROUNDS: 4,
    });

    expect(result.error).toBeUndefined();
    expect(result.value.BCRYPT_SALT_ROUNDS).toBe(4);
  });

  it('does not expose Skin Journal product policy constants as env defaults', () => {
    const result = validateEnv({
      NODE_ENV: 'development',
    });

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
    const result = validateEnv({
      NODE_ENV: 'development',
    });

    expect(result.error).toBeUndefined();
    expect(result.value.PRODUCT_MEDIA_SIGNED_URL_TTL_SECONDS).toBeUndefined();
    expect(result.value.PRODUCT_MEDIA_PROCESSED_MAX_DIMENSION).toBeUndefined();
    expect(result.value.PRODUCT_MEDIA_WEBP_QUALITY).toBeUndefined();
  });

  it('requires production secrets and cookie domain', () => {
    const result = validateEnv({
      NODE_ENV: 'production',
      DATABASE_PASSWORD: 'postgres',
      JWT_SECRET: '',
      JWT_REFRESH_SECRET: '',
      COOKIE_DOMAIN: '',
      RESEND_API_KEY: '',
      MAIL_FROM: 'noreply@ritora.com',
    });

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('"JWT_SECRET"');
  });

  it('rejects wildcard cors origins when credentials are enabled', () => {
    const result = validateEnv({
      NODE_ENV: 'development',
      CORS_ORIGINS: '*',
    });

    expect(result.error).toBeDefined();
  });

  it('rejects insecure same-site none cookies', () => {
    const result = validateEnv({
      NODE_ENV: 'production',
      DATABASE_PASSWORD: 'postgres-password',
      JWT_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      COOKIE_DOMAIN: 'ritora.com',
      COOKIE_SECURE: false,
      COOKIE_SAME_SITE: 'none',
      RESEND_API_KEY: 're_prod_mock',
      SKIN_PROFILE_FIELD_ENCRYPTION_KEY: 'c'.repeat(32),
      MAIL_FROM: 'noreply@ritora.com',
      WEB_APP_URL: 'https://app.ritora.com',
    });

    expect(result.error).toBeDefined();
  });

  it('rejects malformed cookie domains', () => {
    const result = validateEnv({
      NODE_ENV: 'production',
      DATABASE_PASSWORD: 'postgres-password',
      JWT_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      COOKIE_DOMAIN: 'https://ritora.com/app',
      COOKIE_SECURE: true,
      RESEND_API_KEY: 're_prod_mock',
      SKIN_PROFILE_FIELD_ENCRYPTION_KEY: 'c'.repeat(32),
      MAIL_FROM: 'noreply@ritora.com',
      WEB_APP_URL: 'https://app.ritora.com',
    });

    expect(result.error).toBeDefined();
  });

  it('rejects using the same secret for access and refresh tokens', () => {
    const sharedSecret = 'a'.repeat(32);
    const result = validateEnv({
      NODE_ENV: 'production',
      DATABASE_PASSWORD: 'postgres-password',
      JWT_SECRET: sharedSecret,
      JWT_REFRESH_SECRET: sharedSecret,
      COOKIE_DOMAIN: 'ritora.com',
      COOKIE_SECURE: true,
      RESEND_API_KEY: 're_prod_mock',
      SKIN_PROFILE_FIELD_ENCRYPTION_KEY: 'c'.repeat(32),
      MAIL_FROM: 'noreply@ritora.com',
      WEB_APP_URL: 'https://app.ritora.com',
    });

    expect(result.error).toBeDefined();
  });

  it('rejects non-https cors origins in production', () => {
    const result = validateEnv({
      NODE_ENV: 'production',
      DATABASE_PASSWORD: 'postgres-password',
      JWT_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      COOKIE_DOMAIN: 'ritora.com',
      COOKIE_SECURE: true,
      RESEND_API_KEY: 're_prod_mock',
      SKIN_PROFILE_FIELD_ENCRYPTION_KEY: 'c'.repeat(32),
      MAIL_FROM: 'noreply@ritora.com',
      WEB_APP_URL: 'https://app.ritora.com',
      CORS_ORIGINS: 'http://localhost:3000',
    });

    expect(result.error).toBeDefined();
  });

  it('requires production Skin Journal media storage configuration', () => {
    const result = validateEnv({
      NODE_ENV: 'production',
      DATABASE_PASSWORD: 'postgres-password',
      JWT_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      COOKIE_DOMAIN: 'ritora.com',
      COOKIE_SECURE: true,
      RESEND_API_KEY: 're_prod_mock',
      OPENAI_API_KEY: 'sk-prod-mock',
      SKIN_PROFILE_FIELD_ENCRYPTION_KEY: 'c'.repeat(32),
      MAIL_FROM: 'noreply@ritora.com',
      WEB_APP_URL: 'https://app.ritora.com',
      SKIN_JOURNAL_ANALYSIS_SQS_QUEUE_URL:
        'https://sqs.eu-west-1.amazonaws.com/123/skin-journal-analysis',
      SKIN_JOURNAL_INSIGHT_SQS_QUEUE_URL:
        'https://sqs.eu-west-1.amazonaws.com/123/skin-journal-insights',
      SKIN_JOURNAL_OPERATIONS_TOKEN: 'o'.repeat(32),
    });

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('SKIN_JOURNAL_MEDIA_BUCKET');
  });

  it('requires production OpenAI key for Skin Journal analysis', () => {
    const result = validateEnv({
      NODE_ENV: 'production',
      DATABASE_PASSWORD: 'postgres-password',
      JWT_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      COOKIE_DOMAIN: 'ritora.com',
      COOKIE_SECURE: true,
      RESEND_API_KEY: 're_prod_mock',
      SKIN_PROFILE_FIELD_ENCRYPTION_KEY: 'c'.repeat(32),
      MAIL_FROM: 'noreply@ritora.com',
      WEB_APP_URL: 'https://app.ritora.com',
      SKIN_JOURNAL_MEDIA_BUCKET: 'ritora-prod-skin-journal',
      SKIN_JOURNAL_MEDIA_CLOUDFRONT_URL: 'https://media.ritora.com',
      SKIN_JOURNAL_MEDIA_CLOUDFRONT_KEY_PAIR_ID: 'K123',
      SKIN_JOURNAL_MEDIA_CLOUDFRONT_PRIVATE_KEY:
        '-----BEGIN PRIVATE KEY-----\\nmock\\n-----END PRIVATE KEY-----',
      SKIN_JOURNAL_S3_KMS_KEY_ID: 'arn:aws:kms:eu-west-1:123:key/mock',
      SKIN_JOURNAL_ANALYSIS_SQS_QUEUE_URL:
        'https://sqs.eu-west-1.amazonaws.com/123/skin-journal-analysis',
      SKIN_JOURNAL_INSIGHT_SQS_QUEUE_URL:
        'https://sqs.eu-west-1.amazonaws.com/123/skin-journal-insights',
    });

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('OPENAI_API_KEY');
  });

  it('requires an SQS queue URL in production when the analysis queue driver is SQS', () => {
    const result = validateEnv({
      NODE_ENV: 'production',
      DATABASE_PASSWORD: 'postgres-password',
      JWT_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      COOKIE_DOMAIN: 'ritora.com',
      COOKIE_SECURE: true,
      RESEND_API_KEY: 're_prod_mock',
      OPENAI_API_KEY: 'sk-prod-mock',
      SKIN_PROFILE_FIELD_ENCRYPTION_KEY: 'c'.repeat(32),
      MAIL_FROM: 'noreply@ritora.com',
      WEB_APP_URL: 'https://app.ritora.com',
      SKIN_JOURNAL_MEDIA_BUCKET: 'ritora-prod-skin-journal',
      SKIN_JOURNAL_MEDIA_CLOUDFRONT_URL: 'https://media.ritora.com',
      SKIN_JOURNAL_MEDIA_CLOUDFRONT_KEY_PAIR_ID: 'K123',
      SKIN_JOURNAL_MEDIA_CLOUDFRONT_PRIVATE_KEY:
        '-----BEGIN PRIVATE KEY-----\\nmock\\n-----END PRIVATE KEY-----',
      SKIN_JOURNAL_S3_KMS_KEY_ID: 'arn:aws:kms:eu-west-1:123:key/mock',
      SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER: 'sqs',
      SKIN_JOURNAL_INSIGHT_SQS_QUEUE_URL:
        'https://sqs.eu-west-1.amazonaws.com/123/skin-journal-insights',
    });

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain(
      'SKIN_JOURNAL_ANALYSIS_SQS_QUEUE_URL',
    );
  });

  it('requires an operations token in production', () => {
    const result = validateEnv({
      NODE_ENV: 'production',
      DATABASE_PASSWORD: 'postgres-password',
      JWT_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      COOKIE_DOMAIN: 'ritora.com',
      COOKIE_SECURE: true,
      RESEND_API_KEY: 're_prod_mock',
      OPENAI_API_KEY: 'sk-prod-mock',
      SKIN_PROFILE_FIELD_ENCRYPTION_KEY: 'c'.repeat(32),
      MAIL_FROM: 'noreply@ritora.com',
      WEB_APP_URL: 'https://app.ritora.com',
      SKIN_JOURNAL_MEDIA_BUCKET: 'ritora-prod-skin-journal',
      SKIN_JOURNAL_MEDIA_CLOUDFRONT_URL: 'https://media.ritora.com',
      SKIN_JOURNAL_MEDIA_CLOUDFRONT_KEY_PAIR_ID: 'K123',
      SKIN_JOURNAL_MEDIA_CLOUDFRONT_PRIVATE_KEY:
        '-----BEGIN PRIVATE KEY-----\\nmock\\n-----END PRIVATE KEY-----',
      SKIN_JOURNAL_S3_KMS_KEY_ID: 'arn:aws:kms:eu-west-1:123:key/mock',
      SKIN_JOURNAL_ANALYSIS_SQS_QUEUE_URL:
        'https://sqs.eu-west-1.amazonaws.com/123/skin-journal-analysis',
      SKIN_JOURNAL_INSIGHT_SQS_QUEUE_URL:
        'https://sqs.eu-west-1.amazonaws.com/123/skin-journal-insights',
    });

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('SKIN_JOURNAL_OPERATIONS_TOKEN');
  });

  it('uses the database analysis queue driver by default outside production', () => {
    const result = validateEnv({
      NODE_ENV: 'development',
    });

    expect(result.error).toBeUndefined();
    expect(result.value.SKIN_JOURNAL_ANALYSIS_QUEUE_DRIVER).toBe('database');
    expect(result.value.SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER).toBe('database');
    expect(result.value.SKIN_JOURNAL_ANALYSIS_WORKER_ENABLED).toBeUndefined();
  });

  it('requires an SQS queue URL in production when the insight queue driver is SQS', () => {
    const result = validateEnv({
      NODE_ENV: 'production',
      DATABASE_PASSWORD: 'postgres-password',
      JWT_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      COOKIE_DOMAIN: 'ritora.com',
      COOKIE_SECURE: true,
      RESEND_API_KEY: 're_prod_mock',
      OPENAI_API_KEY: 'sk-prod-mock',
      SKIN_PROFILE_FIELD_ENCRYPTION_KEY: 'c'.repeat(32),
      MAIL_FROM: 'noreply@ritora.com',
      WEB_APP_URL: 'https://app.ritora.com',
      SKIN_JOURNAL_MEDIA_BUCKET: 'ritora-prod-skin-journal',
      SKIN_JOURNAL_MEDIA_CLOUDFRONT_URL: 'https://media.ritora.com',
      SKIN_JOURNAL_MEDIA_CLOUDFRONT_KEY_PAIR_ID: 'K123',
      SKIN_JOURNAL_MEDIA_CLOUDFRONT_PRIVATE_KEY:
        '-----BEGIN PRIVATE KEY-----\\nmock\\n-----END PRIVATE KEY-----',
      SKIN_JOURNAL_S3_KMS_KEY_ID: 'arn:aws:kms:eu-west-1:123:key/mock',
      SKIN_JOURNAL_ANALYSIS_SQS_QUEUE_URL:
        'https://sqs.eu-west-1.amazonaws.com/123/skin-journal-analysis',
      SKIN_JOURNAL_INSIGHT_QUEUE_DRIVER: 'sqs',
      SKIN_JOURNAL_OPERATIONS_TOKEN: 'o'.repeat(32),
    });

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain(
      'SKIN_JOURNAL_INSIGHT_SQS_QUEUE_URL',
    );
  });

  it('strips Skin Journal queue policy values even when provided', () => {
    const result = validateEnv({
      NODE_ENV: 'development',
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
    });

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

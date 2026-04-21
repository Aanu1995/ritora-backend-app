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

  it('disables swagger by default in production', () => {
    const result = validateEnv({
      NODE_ENV: 'production',
      DATABASE_PASSWORD: 'postgres-password',
      JWT_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      COOKIE_DOMAIN: 'ritora.com',
      COOKIE_SECURE: true,
      RESEND_API_KEY: 're_prod_mock',
      MAIL_FROM: 'noreply@ritora.com',
      WEB_APP_URL: 'https://app.ritora.com',
    });

    expect(result.error).toBeUndefined();
    expect(result.value.SWAGGER_ENABLED).toBe(false);
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
      MAIL_FROM: 'noreply@ritora.com',
      WEB_APP_URL: 'https://app.ritora.com',
      CORS_ORIGINS: 'http://localhost:3000',
    });

    expect(result.error).toBeDefined();
  });
});

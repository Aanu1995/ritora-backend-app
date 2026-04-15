import { envValidationSchema } from './env.validation';

describe('envValidationSchema', () => {
  it('applies development defaults and allows empty dev-only fields', () => {
    const result = envValidationSchema.validate({
      NODE_ENV: 'development',
      DATABASE_PASSWORD: '',
      MAIL_USER: '',
      MAIL_PASS: '',
      COOKIE_DOMAIN: '',
    });

    expect(result.error).toBeUndefined();
    expect(result.value).toMatchObject({
      API_PORT: 3001,
      CORS_ORIGINS: 'http://localhost:3000',
      JWT_SECRET: 'dev-jwt-secret-change-me',
      JWT_REFRESH_SECRET: 'dev-refresh-secret-change-me',
      MAIL_FROM: 'noreply@ritora.com',
      COOKIE_DOMAIN: '',
      SWAGGER_ENABLED: true,
    });
  });

  it('allows extra process environment variables from npm and shells', () => {
    const { error } = envValidationSchema.validate({
      NODE_ENV: 'development',
      npm_package_name: 'ritora-backend-app',
    });

    expect(error).toBeUndefined();
  });

  it('allows lower bcrypt rounds in test', () => {
    const { error, value } = envValidationSchema.validate({
      NODE_ENV: 'test',
      BCRYPT_SALT_ROUNDS: 4,
    });

    expect(error).toBeUndefined();
    expect(value.BCRYPT_SALT_ROUNDS).toBe(4);
  });

  it('requires production secrets and cookie domain', () => {
    const { error } = envValidationSchema.validate({
      NODE_ENV: 'production',
      DATABASE_PASSWORD: 'postgres',
      JWT_SECRET: '',
      JWT_REFRESH_SECRET: '',
      COOKIE_DOMAIN: '',
      MAIL_USER: '',
      MAIL_PASS: '',
      MAIL_FROM: 'noreply@ritora.com',
    });

    expect(error).toBeDefined();
    expect(error?.message).toContain('"JWT_SECRET"');
  });
});

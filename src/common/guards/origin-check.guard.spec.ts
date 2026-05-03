import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OriginCheckGuard } from './origin-check.guard';

describe('OriginCheckGuard', () => {
  const createContext = (headers: Record<string, string | undefined>) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers }),
      }),
    }) as unknown as ExecutionContext;
  const createConfigService = (
    overrides: Record<string, string>,
  ): ConfigService =>
    ({
      get: jest.fn((key: string) => overrides[key]),
      getOrThrow: jest.fn((key: string) => {
        if (key in overrides) {
          return overrides[key];
        }
        throw new Error(`Missing config ${key}`);
      }),
    }) as unknown as ConfigService;

  it('allows matching origin headers', () => {
    const configService = createConfigService({
      CORS_ORIGINS: 'http://localhost:3000, https://ritora.com',
    });
    const guard = new OriginCheckGuard(configService);

    expect(
      guard.canActivate(
        createContext({ origin: 'https://ritora.com', referer: undefined }),
      ),
    ).toBe(true);
  });

  it('allows matching referer headers when origin is absent', () => {
    const configService = createConfigService({
      CORS_ORIGINS: '',
      WEB_APP_URL: 'http://localhost:3000',
    });
    const guard = new OriginCheckGuard(configService);

    expect(
      guard.canActivate(
        createContext({
          origin: undefined,
          referer: 'http://localhost:3000/some/path',
        }),
      ),
    ).toBe(true);
  });

  it('rejects disallowed origins', () => {
    const configService = createConfigService({
      CORS_ORIGINS: '',
      WEB_APP_URL: 'http://localhost:3000',
    });
    const guard = new OriginCheckGuard(configService);

    expect(() =>
      guard.canActivate(
        createContext({ origin: 'https://evil.example', referer: undefined }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects malformed origin values', () => {
    const configService = createConfigService({
      CORS_ORIGINS: '',
      WEB_APP_URL: 'http://localhost:3000',
    });
    const guard = new OriginCheckGuard(configService);

    expect(() =>
      guard.canActivate(
        createContext({ origin: 'not a url', referer: undefined }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects cross-site browser requests before origin fallback', () => {
    const configService = createConfigService({
      CORS_ORIGINS: '',
      WEB_APP_URL: 'http://localhost:3000',
    });
    const guard = new OriginCheckGuard(configService);

    expect(() =>
      guard.canActivate(
        createContext({
          origin: 'http://localhost:3000',
          referer: undefined,
          'sec-fetch-site': 'cross-site',
        }),
      ),
    ).toThrow(ForbiddenException);
  });
});

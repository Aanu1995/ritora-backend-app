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

  it('allows matching origin headers', () => {
    const configService = {
      get: jest.fn((key: string, fallback?: string) =>
        key === 'CORS_ORIGINS'
          ? 'http://localhost:3000, https://ritora.com'
          : fallback,
      ),
    } as unknown as ConfigService;
    const guard = new OriginCheckGuard(configService);

    expect(
      guard.canActivate(
        createContext({ origin: 'https://ritora.com', referer: undefined }),
      ),
    ).toBe(true);
  });

  it('allows matching referer headers when origin is absent', () => {
    const configService = {
      get: jest.fn((key: string, fallback?: string) =>
        key === 'CORS_ORIGINS' ? undefined : fallback,
      ),
    } as unknown as ConfigService;
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
    const configService = {
      get: jest.fn((key: string, fallback?: string) =>
        key === 'WEB_APP_URL' ? 'http://localhost:3000' : fallback,
      ),
    } as unknown as ConfigService;
    const guard = new OriginCheckGuard(configService);

    expect(() =>
      guard.canActivate(
        createContext({ origin: 'https://evil.example', referer: undefined }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects malformed origin values', () => {
    const configService = {
      get: jest.fn((key: string, fallback?: string) =>
        key === 'WEB_APP_URL' ? 'http://localhost:3000' : fallback,
      ),
    } as unknown as ConfigService;
    const guard = new OriginCheckGuard(configService);

    expect(() =>
      guard.canActivate(
        createContext({ origin: 'not a url', referer: undefined }),
      ),
    ).toThrow(ForbiddenException);
  });
});

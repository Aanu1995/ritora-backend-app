import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { HttpCachePolicy } from '../decorators/http-cache.decorator';
import { NoCacheInterceptor } from './no-cache.interceptor';

describe('NoCacheInterceptor', () => {
  const handler = jest.fn();
  const controller = class TestController {};

  function contextFor(request: { headers: Record<string, string> }) {
    return {
      getHandler: () => handler,
      getClass: () => controller,
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ setHeader }),
      }),
    } as unknown as ExecutionContext;
  }

  let setHeader: jest.Mock;
  let reflector: Reflector;
  let getCachePolicy: jest.SpiedFunction<Reflector['getAllAndOverride']>;

  beforeEach(() => {
    setHeader = jest.fn();
    reflector = new Reflector();
    getCachePolicy = jest.spyOn(reflector, 'getAllAndOverride');
  });

  it('sets strict no-cache headers and forwards the handler response', (done) => {
    const request = {
      headers: {
        'if-none-match': 'W/"cached"',
        'if-modified-since': 'Sat, 09 May 2026 00:00:00 GMT',
      },
    };
    const next = {
      handle: jest.fn(() => of('ok')),
    } as unknown as CallHandler;
    const interceptor = new NoCacheInterceptor(reflector);

    interceptor.intercept(contextFor(request), next).subscribe((value) => {
      expect(value).toBe('ok');
      expect(setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'private, no-store, max-age=0',
      );
      expect(setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
      expect(setHeader).toHaveBeenCalledWith('Expires', '0');
      expect(request.headers).toEqual({});
      expect(next.handle).toHaveBeenCalled();
      done();
    });
  });

  it('leaves explicit browser-cache endpoints untouched', (done) => {
    getCachePolicy.mockReturnValue(HttpCachePolicy.AllowBrowserCache);
    const request = {
      headers: {
        'if-none-match': 'W/"cached"',
      },
    };
    const next = {
      handle: jest.fn(() => of('media')),
    } as unknown as CallHandler;
    const interceptor = new NoCacheInterceptor(reflector);

    interceptor.intercept(contextFor(request), next).subscribe((value) => {
      expect(value).toBe('media');
      expect(setHeader).not.toHaveBeenCalled();
      expect(request.headers).toEqual({ 'if-none-match': 'W/"cached"' });
      expect(next.handle).toHaveBeenCalled();
      done();
    });
  });
});

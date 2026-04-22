import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { NoCacheInterceptor } from './no-cache.interceptor';

describe('NoCacheInterceptor', () => {
  it('sets strict no-cache headers and forwards the handler response', (done) => {
    const setHeader = jest.fn();
    const context = {
      switchToHttp: () => ({
        getResponse: () => ({ setHeader }),
      }),
    } as unknown as ExecutionContext;
    const next = {
      handle: jest.fn(() => of('ok')),
    } as unknown as CallHandler;
    const interceptor = new NoCacheInterceptor();

    interceptor.intercept(context, next).subscribe((value) => {
      expect(value).toBe('ok');
      expect(setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'private, no-store, max-age=0',
      );
      expect(setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
      expect(setHeader).toHaveBeenCalledWith('Expires', '0');
      expect(next.handle).toHaveBeenCalled();
      done();
    });
  });
});

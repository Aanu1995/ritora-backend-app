import { of } from 'rxjs';
import { AuthenticatedTimezoneCaptureInterceptor } from './authenticated-timezone-capture.interceptor';

describe('AuthenticatedTimezoneCaptureInterceptor', () => {
  const usersService = {
    captureTimeZoneIfMissing: jest.fn(),
  };

  const createContext = (request: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    }) as never;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('captures a valid timezone when the user does not have one yet', async () => {
    const interceptor = new AuthenticatedTimezoneCaptureInterceptor(
      usersService as never,
    );
    const request = {
      headers: { 'x-timezone': 'Europe/Stockholm' },
      user: { id: 'user-1', timeZone: null },
    };

    usersService.captureTimeZoneIfMissing.mockResolvedValue({
      time_zone: 'Europe/Stockholm',
    });

    await interceptor.intercept(createContext(request), {
      handle: () => of('ok'),
    } as never);

    expect(usersService.captureTimeZoneIfMissing).toHaveBeenCalledWith(
      'user-1',
      'Europe/Stockholm',
    );
    expect(request.user).toEqual({
      id: 'user-1',
      timeZone: 'Europe/Stockholm',
    });
  });

  it('does not overwrite a saved timezone from the request header', async () => {
    const interceptor = new AuthenticatedTimezoneCaptureInterceptor(
      usersService as never,
    );
    const request = {
      headers: { 'x-timezone': 'America/New_York' },
      user: { id: 'user-1', timeZone: 'Europe/Stockholm' },
    };

    await interceptor.intercept(createContext(request), {
      handle: () => of('ok'),
    } as never);

    expect(usersService.captureTimeZoneIfMissing).not.toHaveBeenCalled();
    expect(request.user).toEqual({
      id: 'user-1',
      timeZone: 'Europe/Stockholm',
    });
  });

  it('ignores invalid timezone headers', async () => {
    const interceptor = new AuthenticatedTimezoneCaptureInterceptor(
      usersService as never,
    );
    const request = {
      headers: { 'x-timezone': '+01:00' },
      user: { id: 'user-1', timeZone: null },
    };

    await interceptor.intercept(createContext(request), {
      handle: () => of('ok'),
    } as never);

    expect(usersService.captureTimeZoneIfMissing).not.toHaveBeenCalled();
  });
});

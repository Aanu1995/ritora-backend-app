import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const createContext = () =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
    }) as unknown as ExecutionContext;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('allows public routes without calling parent guard', () => {
    const reflector = {
      getAllAndOverride: jest.fn(() => true),
    } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);
    const parentSpy = jest.spyOn(
      Object.getPrototypeOf(JwtAuthGuard.prototype),
      'canActivate',
    );

    const result = guard.canActivate(createContext());

    expect(result).toBe(true);
    expect(parentSpy).not.toHaveBeenCalled();
  });

  it('delegates to passport auth guard for protected routes', () => {
    const reflector = {
      getAllAndOverride: jest.fn(() => false),
    } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);
    const parentSpy = jest
      .spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate')
      .mockReturnValue(true);

    const result = guard.canActivate(createContext());

    expect(result).toBe(true);
    expect(parentSpy).toHaveBeenCalled();
  });
});

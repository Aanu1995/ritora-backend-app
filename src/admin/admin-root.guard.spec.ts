import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { AdminAccountRole } from './entities/admin-account.entity';
import { AdminRootGuard } from './admin-root.guard';

function createContext(user?: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('AdminRootGuard', () => {
  it('allows root admins', () => {
    const guard = new AdminRootGuard();

    expect(
      guard.canActivate(createContext({ role: AdminAccountRole.Root })),
    ).toBe(true);
  });

  it('rejects non-root admins', () => {
    const guard = new AdminRootGuard();

    expect(() =>
      guard.canActivate(createContext({ role: AdminAccountRole.Admin })),
    ).toThrow(ForbiddenException);
  });
});

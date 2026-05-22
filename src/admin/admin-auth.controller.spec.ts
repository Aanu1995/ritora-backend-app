import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { OriginCheckGuard } from '../common/guards/origin-check.guard';
import {
  AdminAccountRole,
  AdminAccountStatus,
} from './entities/admin-account.entity';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminJwtAuthGuard } from './admin-jwt-auth.guard';

function getRouteGuards(methodName: keyof AdminAuthController): unknown[] {
  const method = AdminAuthController.prototype[methodName] as object;

  return Reflect.getMetadata(GUARDS_METADATA, method) ?? [];
}

function createController(authService: Partial<AdminAuthService>) {
  const configService = {
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string> = {
        ADMIN_COOKIE_REFRESH_NAME: 'ritora_admin_refresh',
      };
      return values[key];
    }),
  } as unknown as ConfigService;

  return new AdminAuthController(
    authService as AdminAuthService,
    configService,
  );
}

const currentAdmin = {
  email: 'owner@ritora.app',
  id: 'admin-root',
  name: 'Root Admin',
  role: AdminAccountRole.Root,
  sessionId: 'session-current',
  status: AdminAccountStatus.Active,
};

describe('AdminAuthController', () => {
  it('protects the admin session inspection route with authenticated admin guard', () => {
    expect(getRouteGuards('listSessions')).toContain(AdminJwtAuthGuard);
    expect(getRouteGuards('listSessions')).not.toContain(OriginCheckGuard);
  });

  it('protects MFA management routes with origin and admin guards', () => {
    expect(getRouteGuards('getMfaStatus')).toContain(AdminJwtAuthGuard);
    expect(getRouteGuards('startMfaSetup')).toEqual(
      expect.arrayContaining([OriginCheckGuard, AdminJwtAuthGuard]),
    );
    expect(getRouteGuards('enableMfa')).toEqual(
      expect.arrayContaining([OriginCheckGuard, AdminJwtAuthGuard]),
    );
    expect(getRouteGuards('disableMfa')).toEqual(
      expect.arrayContaining([OriginCheckGuard, AdminJwtAuthGuard]),
    );
  });

  it('does not expose multi-session mutation routes for admins', () => {
    expect(AdminAuthController.prototype).not.toHaveProperty('logoutAll');
    expect(AdminAuthController.prototype).not.toHaveProperty('revokeSession');
  });

  it('lists sessions for the current admin account', async () => {
    const authService = {
      listSessions: jest.fn(async () => []),
    };
    const controller = createController(authService);

    await expect(controller.listSessions(currentAdmin)).resolves.toEqual([]);
    expect(authService.listSessions).toHaveBeenCalledWith(currentAdmin);
  });

  it('forwards MFA setup and enable requests with request context', async () => {
    const authService = {
      enableMfa: jest.fn(async () => ({
        enabled: true,
        enabledAt: '2026-05-21T10:00:00.000Z',
        pendingSetupExpiresAt: null,
        recoveryCodes: [],
        recoveryCodesRemaining: 10,
      })),
      startMfaSetup: jest.fn(async () => ({
        expiresAt: '2026-05-21T10:10:00.000Z',
        manualEntryKey: 'ABCD EFGH',
        otpauthUri: 'otpauth://totp/Ritora',
        secret: 'ABCDEFGH',
      })),
    };
    const controller = createController(authService);
    const request = {
      headers: { 'user-agent': 'Jest' },
      ip: '127.0.0.1',
    } as never;

    await controller.startMfaSetup(currentAdmin, {
      currentPassword: 'RootAdmin123!',
    });
    await controller.enableMfa(currentAdmin, { code: '123456' }, request);

    expect(authService.startMfaSetup).toHaveBeenCalledWith(
      currentAdmin,
      'RootAdmin123!',
    );
    expect(authService.enableMfa).toHaveBeenCalledWith(currentAdmin, '123456', {
      ip: '127.0.0.1',
      sessionId: 'session-current',
      userAgent: 'Jest',
    });
  });
});

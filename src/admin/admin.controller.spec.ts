import { GUARDS_METADATA } from '@nestjs/common/constants';
import { OriginCheckGuard } from '../common/guards/origin-check.guard';
import { AdminController } from './admin.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminRootGuard } from './admin-root.guard';
import { AdminService } from './admin.service';
import {
  AdminAccountRole,
  AdminAccountStatus,
} from './entities/admin-account.entity';
import { AdminUserRestrictionFilter } from './admin.types';
import { AdminAuditAction } from './entities/admin-audit-log.entity';

function getRouteGuards(methodName: keyof AdminController): unknown[] {
  const method = AdminController.prototype[methodName] as object;

  return Reflect.getMetadata(GUARDS_METADATA, method) ?? [];
}

describe('AdminController', () => {
  it('keeps admin-account routes root-only while product-user routes use the authenticated admin guard', () => {
    expect(getRouteGuards('listUsers')).not.toContain(AdminRootGuard);
    expect(getRouteGuards('getUser')).not.toContain(AdminRootGuard);
    expect(getRouteGuards('listAuditLogs')).not.toContain(AdminRootGuard);
    expect(getRouteGuards('getOperationsMonitoring')).not.toContain(
      AdminRootGuard,
    );
    expect(getRouteGuards('restrictUser')).not.toContain(AdminRootGuard);
    expect(getRouteGuards('unrestrictUser')).not.toContain(AdminRootGuard);
    expect(getRouteGuards('restrictUser')).toContain(OriginCheckGuard);
    expect(getRouteGuards('unrestrictUser')).toContain(OriginCheckGuard);
    expect(getRouteGuards('listAdmins')).toContain(AdminRootGuard);
    expect(getRouteGuards('createAdmin')).toContain(AdminRootGuard);
    expect(getRouteGuards('createAdmin')).toContain(OriginCheckGuard);
    expect(getRouteGuards('resendAdminInvitation')).toContain(AdminRootGuard);
    expect(getRouteGuards('resendAdminInvitation')).toContain(OriginCheckGuard);
    expect(getRouteGuards('deleteAdmin')).toContain(AdminRootGuard);
    expect(getRouteGuards('deleteAdmin')).toContain(OriginCheckGuard);
  });

  it('exposes the current admin member from the authenticated user context', () => {
    const service = {
      getCurrentAdmin: jest.fn(() => ({
        acceptedAt: null,
        createdAt: '2026-05-20T10:00:00.000Z',
        createdByAdminId: null,
        email: 'owner@ritora.app',
        id: 'admin-root',
        invitedAt: null,
        lastLoginAt: null,
        name: 'Root Admin',
        permissions: ['metrics:read'],
        role: AdminAccountRole.Root,
        roles: [AdminAccountRole.Root],
        status: AdminAccountStatus.Active,
      })),
      listUsers: jest.fn(),
      restrictUser: jest.fn(),
      unrestrictUser: jest.fn(),
    } as unknown as AdminService;
    const authService = {} as unknown as AdminAuthService;
    const controller = new AdminController(service, authService);

    expect(
      controller.getMe({
        email: 'owner@ritora.app',
        id: 'admin-root',
        name: 'Root Admin',
        role: AdminAccountRole.Root,
        sessionId: 'session-1',
        status: AdminAccountStatus.Active,
      }),
    ).toMatchObject({
      email: 'owner@ritora.app',
      roles: [AdminAccountRole.Root],
    });
    expect(service.getCurrentAdmin).toHaveBeenCalledWith({
      email: 'owner@ritora.app',
      id: 'admin-root',
      name: 'Root Admin',
      role: AdminAccountRole.Root,
      sessionId: 'session-1',
      status: AdminAccountStatus.Active,
    });
  });

  it('passes user monitoring queries to the admin service', async () => {
    const service = {
      listUsers: jest.fn(async () => ({
        hasNextPage: false,
        hasPreviousPage: false,
        limit: 25,
        page: 1,
        total: 0,
        totalPages: 0,
        users: [],
      })),
    } as unknown as AdminService;
    const authService = {} as unknown as AdminAuthService;
    const controller = new AdminController(service, authService);

    await expect(
      controller.listUsers({
        limit: 25,
        page: 1,
        query: 'jane',
        restriction: AdminUserRestrictionFilter.All,
      }),
    ).resolves.toEqual({
      hasNextPage: false,
      hasPreviousPage: false,
      limit: 25,
      page: 1,
      total: 0,
      totalPages: 0,
      users: [],
    });

    expect(service.listUsers).toHaveBeenCalledWith({
      limit: 25,
      page: 1,
      query: 'jane',
      restriction: AdminUserRestrictionFilter.All,
    });
  });

  it('passes user detail requests to the admin service for all admins', async () => {
    const service = {
      getUser: jest.fn(async () => ({
        id: '01USER',
      })),
    } as unknown as AdminService;
    const authService = {} as unknown as AdminAuthService;
    const controller = new AdminController(service, authService);

    await expect(controller.getUser('01USER')).resolves.toEqual({
      id: '01USER',
    });
    expect(service.getUser).toHaveBeenCalledWith('01USER');
  });

  it('passes audit log queries to the admin service', async () => {
    const service = {
      listAuditLogs: jest.fn(async () => ({
        hasNextPage: false,
        hasPreviousPage: false,
        limit: 25,
        logs: [],
        page: 1,
        total: 0,
        totalPages: 0,
      })),
    } as unknown as AdminService;
    const authService = {} as unknown as AdminAuthService;
    const controller = new AdminController(service, authService);

    await expect(
      controller.listAuditLogs({
        action: AdminAuditAction.UserRestricted,
        limit: 25,
        page: 1,
        query: 'jane',
      }),
    ).resolves.toEqual({
      hasNextPage: false,
      hasPreviousPage: false,
      limit: 25,
      logs: [],
      page: 1,
      total: 0,
      totalPages: 0,
    });
    expect(service.listAuditLogs).toHaveBeenCalledWith({
      action: AdminAuditAction.UserRestricted,
      limit: 25,
      page: 1,
      query: 'jane',
    });
  });

  it('passes operational monitoring requests to the admin service', async () => {
    const service = {
      getOperationsMonitoring: jest.fn(async () => ({
        generatedAt: '2026-05-20T10:00:00.000Z',
        jobHealth: [],
        workItems: [],
      })),
    } as unknown as AdminService;
    const authService = {} as unknown as AdminAuthService;
    const controller = new AdminController(service, authService);

    await expect(controller.getOperationsMonitoring()).resolves.toEqual({
      generatedAt: '2026-05-20T10:00:00.000Z',
      jobHealth: [],
      workItems: [],
    });
    expect(service.getOperationsMonitoring).toHaveBeenCalledTimes(1);
  });

  it('passes admin search queries to the root-only auth service', async () => {
    const service = {} as unknown as AdminService;
    const authService = {
      listAdmins: jest.fn(async () => ({
        admins: [],
        hasNextPage: false,
        hasPreviousPage: false,
        limit: 50,
        page: 1,
        total: 0,
        totalPages: 0,
      })),
    } as unknown as AdminAuthService;
    const controller = new AdminController(service, authService);
    const user = {
      email: 'owner@ritora.app',
      id: 'admin-root',
      name: 'Root Admin',
      role: AdminAccountRole.Root,
      sessionId: 'session-1',
      status: AdminAccountStatus.Active,
    };

    await expect(
      controller.listAdmins(user, { limit: 50, page: 1, query: 'ops' }),
    ).resolves.toEqual({
      admins: [],
      hasNextPage: false,
      hasPreviousPage: false,
      limit: 50,
      page: 1,
      total: 0,
      totalPages: 0,
    });
    expect(authService.listAdmins).toHaveBeenCalledWith(user, {
      limit: 50,
      page: 1,
      query: 'ops',
    });
  });

  it('passes account restriction commands with audit context', async () => {
    const service = {
      restrictUser: jest.fn(async () => ({ id: '01USER' })),
      unrestrictUser: jest.fn(async () => ({ id: '01USER' })),
    } as unknown as AdminService;
    const authService = {} as unknown as AdminAuthService;
    const controller = new AdminController(service, authService);
    const user = {
      email: 'ops@ritora.app',
      id: 'admin-ops',
      name: 'Ops Admin',
      role: AdminAccountRole.Admin,
      sessionId: 'session-1',
      status: AdminAccountStatus.Active,
    };
    const request = {
      headers: { 'user-agent': 'Jest' },
      ip: '127.0.0.1',
    };

    await controller.restrictUser(
      user,
      '01USER',
      { reason: 'Suspicious automated activity' },
      request as never,
    );
    await controller.unrestrictUser(
      user,
      '01USER',
      { reason: 'Manual review cleared the account' },
      request as never,
    );

    expect(service.restrictUser).toHaveBeenCalledWith(user, '01USER', {
      ip: '127.0.0.1',
      reason: 'Suspicious automated activity',
      sessionId: 'session-1',
      userAgent: 'Jest',
    });
    expect(service.unrestrictUser).toHaveBeenCalledWith(user, '01USER', {
      ip: '127.0.0.1',
      reason: 'Manual review cleared the account',
      sessionId: 'session-1',
      userAgent: 'Jest',
    });
  });

  it('passes admin invitation resend commands with audit context', async () => {
    const service = {} as unknown as AdminService;
    const authService = {
      resendAdminInvitation: jest.fn(async () => ({ id: 'admin-ops' })),
    } as unknown as AdminAuthService;
    const controller = new AdminController(service, authService);
    const user = {
      email: 'owner@ritora.app',
      id: 'admin-root',
      name: 'Root Admin',
      role: AdminAccountRole.Root,
      sessionId: 'session-1',
      status: AdminAccountStatus.Active,
    };
    const request = {
      headers: { 'user-agent': 'Jest' },
      ip: '127.0.0.1',
    };

    await controller.resendAdminInvitation(
      user,
      'admin-ops',
      {
        language: 'sv',
        reason: 'Invitation link expired',
      },
      request as never,
    );

    expect(authService.resendAdminInvitation).toHaveBeenCalledWith(
      user,
      'admin-ops',
      {
        ip: '127.0.0.1',
        reason: 'Invitation link expired',
        sessionId: 'session-1',
        userAgent: 'Jest',
      },
      'sv',
    );
  });
});

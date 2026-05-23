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
import { UserRestrictionCapability } from '../users/user-restrictions';
import { AdminUserRestrictionFilter } from './admin.types';
import { AdminAuditAction } from './entities/admin-audit-log.entity';
import { AdminOperationalIncidentSeverity } from './entities/admin-operational-incident.entity';
import { AdminOperationalIncidentStatusFilter } from './dto/admin-operational-incident.dto';
import {
  AdminAccountMonitoringSeverity,
  AdminAccountMonitoringSignalType,
  AdminAccountMonitoringStatus,
} from './entities/admin-account-monitoring-flag.entity';
import { AdminAccountMonitoringStatusFilter } from './dto/admin-account-monitoring.dto';
import {
  SupportFeedbackPriority,
  SupportFeedbackSource,
  SupportFeedbackStatus,
  SupportFeedbackType,
} from '../support/entities/support-feedback-item.entity';
import { SupportFeedbackStatusFilter } from '../support/dto/support-feedback.dto';

function getRouteGuards(methodName: keyof AdminController): unknown[] {
  const method = AdminController.prototype[methodName] as object;

  return Reflect.getMetadata(GUARDS_METADATA, method) ?? [];
}

describe('AdminController', () => {
  it('keeps admin-account routes root-only while product-user routes use the authenticated admin guard', () => {
    expect(getRouteGuards('listUsers')).not.toContain(AdminRootGuard);
    expect(getRouteGuards('getUser')).not.toContain(AdminRootGuard);
    expect(getRouteGuards('listUserNotes')).not.toContain(AdminRootGuard);
    expect(getRouteGuards('createUserNote')).not.toContain(AdminRootGuard);
    expect(getRouteGuards('listSupportFeedback')).not.toContain(AdminRootGuard);
    expect(getRouteGuards('createSupportFeedback')).not.toContain(
      AdminRootGuard,
    );
    expect(getRouteGuards('updateSupportFeedback')).not.toContain(
      AdminRootGuard,
    );
    expect(getRouteGuards('listSupportFeedbackNotes')).not.toContain(
      AdminRootGuard,
    );
    expect(getRouteGuards('createSupportFeedbackNote')).not.toContain(
      AdminRootGuard,
    );
    expect(getRouteGuards('listAuditLogs')).not.toContain(AdminRootGuard);
    expect(getRouteGuards('getOperationsMonitoring')).not.toContain(
      AdminRootGuard,
    );
    expect(getRouteGuards('listAiCostByUsers')).not.toContain(AdminRootGuard);
    expect(getRouteGuards('listAccountMonitoringFlags')).not.toContain(
      AdminRootGuard,
    );
    expect(getRouteGuards('createAccountMonitoringFlag')).not.toContain(
      AdminRootGuard,
    );
    expect(getRouteGuards('updateAccountMonitoringFlag')).not.toContain(
      AdminRootGuard,
    );
    expect(getRouteGuards('resolveAccountMonitoringFlag')).not.toContain(
      AdminRootGuard,
    );
    expect(getRouteGuards('createAccountMonitoringFlag')).toContain(
      OriginCheckGuard,
    );
    expect(getRouteGuards('updateAccountMonitoringFlag')).toContain(
      OriginCheckGuard,
    );
    expect(getRouteGuards('resolveAccountMonitoringFlag')).toContain(
      OriginCheckGuard,
    );
    expect(getRouteGuards('listOperationalIncidents')).not.toContain(
      AdminRootGuard,
    );
    expect(getRouteGuards('createOperationalIncident')).not.toContain(
      AdminRootGuard,
    );
    expect(getRouteGuards('resolveOperationalIncident')).not.toContain(
      AdminRootGuard,
    );
    expect(getRouteGuards('restrictUser')).not.toContain(AdminRootGuard);
    expect(getRouteGuards('unrestrictUser')).not.toContain(AdminRootGuard);
    expect(getRouteGuards('restrictUser')).toContain(OriginCheckGuard);
    expect(getRouteGuards('unrestrictUser')).toContain(OriginCheckGuard);
    expect(getRouteGuards('createUserNote')).toContain(OriginCheckGuard);
    expect(getRouteGuards('createSupportFeedback')).toContain(OriginCheckGuard);
    expect(getRouteGuards('updateSupportFeedback')).toContain(OriginCheckGuard);
    expect(getRouteGuards('createSupportFeedbackNote')).toContain(
      OriginCheckGuard,
    );
    expect(getRouteGuards('createOperationalIncident')).toContain(
      OriginCheckGuard,
    );
    expect(getRouteGuards('resolveOperationalIncident')).toContain(
      OriginCheckGuard,
    );
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

  it('passes per-user AI cost queries to the admin service for all admins', async () => {
    const service = {
      listAiCostByUsers: jest.fn(async () => ({
        hasNextPage: false,
        hasPreviousPage: false,
        limit: 10,
        page: 1,
        total: 0,
        totalPages: 0,
        users: [],
      })),
    } as unknown as AdminService;
    const authService = {} as unknown as AdminAuthService;
    const controller = new AdminController(service, authService);

    await expect(
      controller.listAiCostByUsers({
        feature: 'quick_check',
        limit: 10,
        page: 1,
        period: 'today',
        query: 'jane',
      }),
    ).resolves.toEqual({
      hasNextPage: false,
      hasPreviousPage: false,
      limit: 10,
      page: 1,
      total: 0,
      totalPages: 0,
      users: [],
    });
    expect(service.listAiCostByUsers).toHaveBeenCalledWith({
      feature: 'quick_check',
      limit: 10,
      page: 1,
      period: 'today',
      query: 'jane',
    });
  });

  it('passes support feedback inbox queries and mutations to the support service for all admins', async () => {
    const service = {} as unknown as AdminService;
    const supportService = {
      createAdminFeedback: jest.fn(async () => ({
        assignedAdmin: null,
        assignedAdminId: null,
        closedAt: null,
        context: { route: '/settings' },
        createdAt: '2026-05-22T08:00:00.000Z',
        createdByAdmin: {
          email: 'ops@ritora.app',
          id: 'admin-ops',
          name: 'Ops Admin',
        },
        createdByAdminId: 'admin-ops',
        description: 'User reported confusing account export copy.',
        id: 'feedback-1',
        noteCount: 0,
        priority: SupportFeedbackPriority.High,
        reporterEmail: 'jane@example.com',
        source: SupportFeedbackSource.SupportEmail,
        status: SupportFeedbackStatus.New,
        title: 'Export wording confusion',
        type: SupportFeedbackType.ConfusingResult,
        updatedAt: '2026-05-22T08:00:00.000Z',
        user: null,
        userId: null,
      })),
      createAdminFeedbackNote: jest.fn(async () => ({
        author: {
          email: 'ops@ritora.app',
          id: 'admin-ops',
          name: 'Ops Admin',
        },
        authorAdminId: 'admin-ops',
        body: 'Followed up by email.',
        createdAt: '2026-05-22T09:00:00.000Z',
        feedbackId: 'feedback-1',
        id: 'note-1',
      })),
      listAdminFeedback: jest.fn(async () => ({
        feedback: [],
        hasNextPage: false,
        hasPreviousPage: false,
        limit: 20,
        page: 1,
        total: 0,
        totalPages: 0,
      })),
      listAdminFeedbackNotes: jest.fn(async () => ({
        hasNextPage: false,
        hasPreviousPage: false,
        limit: 10,
        notes: [],
        page: 1,
        total: 0,
        totalPages: 0,
      })),
      updateAdminFeedback: jest.fn(async () => ({
        id: 'feedback-1',
        status: SupportFeedbackStatus.Triaged,
      })),
    };
    const authService = {} as unknown as AdminAuthService;
    const controller = new AdminController(
      service,
      authService,
      supportService as never,
    );
    const adminUser = {
      email: 'ops@ritora.app',
      id: 'admin-ops',
      name: 'Ops Admin',
      role: AdminAccountRole.Admin,
      sessionId: 'session-1',
      status: AdminAccountStatus.Active,
    };
    const req = {
      headers: { 'user-agent': 'Safari' },
      ip: '127.0.0.1',
    } as never;

    await controller.listSupportFeedback({
      limit: 20,
      page: 1,
      query: 'export',
      status: SupportFeedbackStatusFilter.New,
      type: SupportFeedbackType.ConfusingResult,
    });
    await controller.createSupportFeedback(
      adminUser,
      {
        context: { route: '/settings' },
        description: 'User reported confusing account export copy.',
        priority: SupportFeedbackPriority.High,
        reason: 'Support email copied into Ritora inbox',
        reporterEmail: 'jane@example.com',
        source: SupportFeedbackSource.SupportEmail,
        title: 'Export wording confusion',
        type: SupportFeedbackType.ConfusingResult,
      },
      req,
    );
    await controller.updateSupportFeedback(
      adminUser,
      'feedback-1',
      {
        assignedAdminId: 'admin-ops',
        priority: SupportFeedbackPriority.High,
        reason: 'Support issue triaged for launch review',
        status: SupportFeedbackStatus.Triaged,
      },
      req,
    );
    await controller.listSupportFeedbackNotes('feedback-1', {
      limit: 10,
      page: 1,
    });
    await controller.createSupportFeedbackNote(
      adminUser,
      'feedback-1',
      {
        body: 'Followed up by email.',
        reason: 'Support follow-up recorded',
      },
      req,
    );

    expect(supportService.listAdminFeedback).toHaveBeenCalledWith({
      limit: 20,
      page: 1,
      query: 'export',
      status: SupportFeedbackStatusFilter.New,
      type: SupportFeedbackType.ConfusingResult,
    });
    expect(supportService.createAdminFeedback).toHaveBeenCalledWith(
      adminUser,
      expect.objectContaining({
        source: SupportFeedbackSource.SupportEmail,
        title: 'Export wording confusion',
      }),
      {
        ip: '127.0.0.1',
        sessionId: 'session-1',
        userAgent: 'Safari',
      },
    );
    expect(supportService.updateAdminFeedback).toHaveBeenCalledWith(
      adminUser,
      'feedback-1',
      expect.objectContaining({
        status: SupportFeedbackStatus.Triaged,
      }),
      {
        ip: '127.0.0.1',
        sessionId: 'session-1',
        userAgent: 'Safari',
      },
    );
    expect(supportService.listAdminFeedbackNotes).toHaveBeenCalledWith(
      'feedback-1',
      { limit: 10, page: 1 },
    );
    expect(supportService.createAdminFeedbackNote).toHaveBeenCalledWith(
      adminUser,
      'feedback-1',
      { body: 'Followed up by email.', reason: 'Support follow-up recorded' },
      {
        ip: '127.0.0.1',
        sessionId: 'session-1',
        userAgent: 'Safari',
      },
    );
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

  it('passes internal user note requests with audit context for all admins', async () => {
    const service = {
      createUserNote: jest.fn(async () => ({ id: 'note-1' })),
      listUserNotes: jest.fn(async () => ({
        hasNextPage: false,
        hasPreviousPage: false,
        limit: 10,
        notes: [],
        page: 1,
        total: 0,
        totalPages: 0,
      })),
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

    await expect(
      controller.listUserNotes('01USER', { limit: 10, page: 1 }),
    ).resolves.toMatchObject({ notes: [] });
    await expect(
      controller.createUserNote(
        user,
        '01USER',
        { body: 'Escalated for failed export follow-up.' },
        request as never,
      ),
    ).resolves.toEqual({ id: 'note-1' });

    expect(service.listUserNotes).toHaveBeenCalledWith('01USER', {
      limit: 10,
      page: 1,
    });
    expect(service.createUserNote).toHaveBeenCalledWith(
      user,
      '01USER',
      { body: 'Escalated for failed export follow-up.' },
      {
        ip: '127.0.0.1',
        sessionId: 'session-1',
        userAgent: 'Jest',
      },
    );
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
        monitoringFlagId: 'flag-1',
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
      monitoringFlagId: 'flag-1',
      page: 1,
      query: 'jane',
    });
  });

  it('passes operational monitoring requests to the admin service', async () => {
    const service = {
      getOperationsMonitoring: jest.fn(async () => ({
        backendHealth: {
          checkedAt: '2026-05-20T10:00:00.000Z',
          components: [],
          status: 'healthy',
        },
        compliance: {
          failedExportCount: 0,
          pendingDeletionCount: 0,
          sensitiveAccessEvents24h: 0,
        },
        generatedAt: '2026-05-20T10:00:00.000Z',
        jobHealth: [],
        workItems: [],
      })),
    } as unknown as AdminService;
    const authService = {} as unknown as AdminAuthService;
    const controller = new AdminController(service, authService);

    await expect(controller.getOperationsMonitoring()).resolves.toEqual({
      backendHealth: {
        checkedAt: '2026-05-20T10:00:00.000Z',
        components: [],
        status: 'healthy',
      },
      compliance: {
        failedExportCount: 0,
        pendingDeletionCount: 0,
        sensitiveAccessEvents24h: 0,
      },
      generatedAt: '2026-05-20T10:00:00.000Z',
      jobHealth: [],
      workItems: [],
    });
    expect(service.getOperationsMonitoring).toHaveBeenCalledTimes(1);
  });

  it('passes account monitoring requests with audit context for all admins', async () => {
    const service = {
      createAccountMonitoringFlag: jest.fn(async () => ({ id: 'flag-1' })),
      listAccountMonitoringFlags: jest.fn(async () => ({
        flags: [],
        hasNextPage: false,
        hasPreviousPage: false,
        limit: 10,
        page: 1,
        total: 0,
        totalPages: 0,
      })),
      getAccountMonitoringSettings: jest.fn(async () => ({
        thresholds: {
          aiCost24hCriticalUsd: 5,
          aiCost24hWarningUsd: 2,
          aiGenerations24hCritical: 50,
          aiGenerations24hWarning: 25,
          authFailures24hWarning: 8,
          deletionEvents30dWarning: 3,
          mediaCleanupAttempts24hWarning: 6,
          mediaCleanupFailures24hWarning: 3,
          passwordResets24hWarning: 5,
          productExtractions24hWarning: 20,
          safetyReactionSignals7dWarning: 3,
          unknownAuthFailures24hCritical: 20,
          unknownAuthFailures24hWarning: 8,
          uploadFailures24hWarning: 5,
        },
        updatedAt: '2026-05-22T09:00:00.000Z',
        updatedByAdminId: null,
      })),
      resolveAccountMonitoringFlag: jest.fn(async () => ({ id: 'flag-1' })),
      runAccountMonitoringAutomatedScan: jest.fn(async () => ({
        candidates: 0,
        created: 0,
        flags: [],
        platformCandidates: 0,
        platformIncidentsCreated: 0,
        platformIncidentsRefreshed: 0,
        refreshed: 0,
        scannedAt: '2026-05-22T09:00:00.000Z',
        skipped: 0,
      })),
      updateAccountMonitoringSettings: jest.fn(async () => ({
        thresholds: {
          aiCost24hCriticalUsd: 5,
          aiCost24hWarningUsd: 3,
          aiGenerations24hCritical: 50,
          aiGenerations24hWarning: 30,
          authFailures24hWarning: 8,
          deletionEvents30dWarning: 3,
          mediaCleanupAttempts24hWarning: 6,
          mediaCleanupFailures24hWarning: 3,
          passwordResets24hWarning: 5,
          productExtractions24hWarning: 20,
          safetyReactionSignals7dWarning: 3,
          unknownAuthFailures24hCritical: 20,
          unknownAuthFailures24hWarning: 8,
          uploadFailures24hWarning: 5,
        },
        updatedAt: '2026-05-22T09:10:00.000Z',
        updatedByAdminId: 'admin-ops',
      })),
      updateAccountMonitoringFlag: jest.fn(async () => ({ id: 'flag-1' })),
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

    await expect(
      controller.listAccountMonitoringFlags({
        limit: 10,
        page: 1,
        query: 'jane',
        signalType: AdminAccountMonitoringSignalType.HighAiCost,
        status: AdminAccountMonitoringStatusFilter.Active,
      }),
    ).resolves.toMatchObject({ flags: [] });
    await controller.createAccountMonitoringFlag(
      user,
      {
        internalNote: 'Review AI cost trend before taking action.',
        latestSignal: 'AI spend crossed the daily review threshold.',
        reason: 'AI cost spike needs manual review',
        severity: AdminAccountMonitoringSeverity.Warning,
        signalType: AdminAccountMonitoringSignalType.HighAiCost,
        summary: 'High AI spend spike',
        userIdentifier: 'jane@example.com',
      },
      request as never,
    );
    await controller.updateAccountMonitoringFlag(
      user,
      'flag-1',
      {
        reason: 'Account is under active review',
        status: AdminAccountMonitoringStatus.Watching,
      },
      request as never,
    );
    await controller.resolveAccountMonitoringFlag(
      user,
      'flag-1',
      {
        reason: 'Manual review cleared account',
        resolutionNote: 'Cost returned to expected usage after review.',
      },
      request as never,
    );
    await controller.runAccountMonitoringAutomatedScan(user, request as never);
    await controller.getAccountMonitoringSettings();
    await controller.updateAccountMonitoringSettings(
      user,
      {
        reason: 'Tune monitoring thresholds after launch traffic review',
        thresholds: {
          aiCost24hCriticalUsd: 5,
          aiCost24hWarningUsd: 3,
          aiGenerations24hCritical: 50,
          aiGenerations24hWarning: 30,
          authFailures24hWarning: 8,
          deletionEvents30dWarning: 3,
          mediaCleanupAttempts24hWarning: 6,
          mediaCleanupFailures24hWarning: 3,
          passwordResets24hWarning: 5,
          productExtractions24hWarning: 20,
          safetyReactionSignals7dWarning: 3,
          unknownAuthFailures24hCritical: 20,
          unknownAuthFailures24hWarning: 8,
          uploadFailures24hWarning: 5,
        },
      },
      request as never,
    );

    expect(service.listAccountMonitoringFlags).toHaveBeenCalledWith({
      limit: 10,
      page: 1,
      query: 'jane',
      signalType: AdminAccountMonitoringSignalType.HighAiCost,
      status: AdminAccountMonitoringStatusFilter.Active,
    });
    expect(service.createAccountMonitoringFlag).toHaveBeenCalledWith(
      user,
      {
        internalNote: 'Review AI cost trend before taking action.',
        latestSignal: 'AI spend crossed the daily review threshold.',
        nextReviewAt: undefined,
        reason: 'AI cost spike needs manual review',
        severity: AdminAccountMonitoringSeverity.Warning,
        signalType: AdminAccountMonitoringSignalType.HighAiCost,
        summary: 'High AI spend spike',
        userIdentifier: 'jane@example.com',
      },
      {
        ip: '127.0.0.1',
        sessionId: 'session-1',
        userAgent: 'Jest',
      },
    );
    expect(service.updateAccountMonitoringFlag).toHaveBeenCalledWith(
      user,
      'flag-1',
      {
        assignedAdminId: undefined,
        internalNote: undefined,
        latestSignal: undefined,
        nextReviewAt: undefined,
        reason: 'Account is under active review',
        status: AdminAccountMonitoringStatus.Watching,
      },
      {
        ip: '127.0.0.1',
        sessionId: 'session-1',
        userAgent: 'Jest',
      },
    );
    expect(service.resolveAccountMonitoringFlag).toHaveBeenCalledWith(
      user,
      'flag-1',
      {
        reason: 'Manual review cleared account',
        resolutionNote: 'Cost returned to expected usage after review.',
      },
      {
        ip: '127.0.0.1',
        sessionId: 'session-1',
        userAgent: 'Jest',
      },
    );
    expect(service.runAccountMonitoringAutomatedScan).toHaveBeenCalledWith(
      user,
      {
        ip: '127.0.0.1',
        sessionId: 'session-1',
        userAgent: 'Jest',
      },
    );
    expect(service.getAccountMonitoringSettings).toHaveBeenCalledTimes(1);
    expect(service.updateAccountMonitoringSettings).toHaveBeenCalledWith(
      user,
      {
        reason: 'Tune monitoring thresholds after launch traffic review',
        thresholds: expect.objectContaining({
          aiCost24hWarningUsd: 3,
          aiGenerations24hWarning: 30,
        }),
      },
      {
        ip: '127.0.0.1',
        sessionId: 'session-1',
        userAgent: 'Jest',
      },
    );
  });

  it('passes operational incident triage requests with audit context', async () => {
    const service = {
      createOperationalIncident: jest.fn(async () => ({ id: 'incident-1' })),
      listOperationalIncidents: jest.fn(async () => ({
        hasNextPage: false,
        hasPreviousPage: false,
        incidents: [],
        limit: 10,
        page: 1,
        total: 0,
        totalPages: 0,
      })),
      resolveOperationalIncident: jest.fn(async () => ({ id: 'incident-1' })),
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

    await expect(
      controller.listOperationalIncidents({
        limit: 10,
        page: 1,
        status: AdminOperationalIncidentStatusFilter.Open,
      }),
    ).resolves.toMatchObject({ incidents: [] });
    await controller.createOperationalIncident(
      user,
      {
        description: 'Journal analysis has failed repeatedly.',
        severity: AdminOperationalIncidentSeverity.Critical,
        sourceId: 'job-1',
        sourceType: 'journal-analysis',
        targetUserId: '01USER',
        title: 'Journal analysis failed',
      },
      request as never,
    );
    await controller.resolveOperationalIncident(
      user,
      'incident-1',
      { resolutionSummary: 'Provider recovered and the queue drained.' },
      request as never,
    );

    expect(service.listOperationalIncidents).toHaveBeenCalledWith({
      limit: 10,
      page: 1,
      status: 'open',
    });
    expect(service.createOperationalIncident).toHaveBeenCalledWith(
      user,
      {
        description: 'Journal analysis has failed repeatedly.',
        severity: AdminOperationalIncidentSeverity.Critical,
        sourceId: 'job-1',
        sourceType: 'journal-analysis',
        targetUserId: '01USER',
        title: 'Journal analysis failed',
      },
      {
        ip: '127.0.0.1',
        sessionId: 'session-1',
        userAgent: 'Jest',
      },
    );
    expect(service.resolveOperationalIncident).toHaveBeenCalledWith(
      user,
      'incident-1',
      { resolutionSummary: 'Provider recovered and the queue drained.' },
      {
        ip: '127.0.0.1',
        sessionId: 'session-1',
        userAgent: 'Jest',
      },
    );
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
      {
        capabilities: [
          UserRestrictionCapability.DisableAiGeneration,
          UserRestrictionCapability.ForceLogout,
        ],
        expiresAt: '2099-06-20T09:00:00.000Z',
        internalNote: 'Observed abnormal AI generation volume.',
        reason: 'Suspicious automated activity',
        userMessage: 'Some account actions are temporarily unavailable.',
      },
      request as never,
    );
    await controller.unrestrictUser(
      user,
      '01USER',
      { reason: 'Manual review cleared the account' },
      request as never,
    );

    expect(service.restrictUser).toHaveBeenCalledWith(user, '01USER', {
      capabilities: [
        UserRestrictionCapability.DisableAiGeneration,
        UserRestrictionCapability.ForceLogout,
      ],
      expiresAt: '2099-06-20T09:00:00.000Z',
      internalNote: 'Observed abnormal AI generation volume.',
      ip: '127.0.0.1',
      reason: 'Suspicious automated activity',
      sessionId: 'session-1',
      userMessage: 'Some account actions are temporarily unavailable.',
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

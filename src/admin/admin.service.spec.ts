import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthSession } from '../auth/entities/auth-session.entity';
import { User } from '../users/entities/user.entity';
import { AdminService } from './admin.service';
import {
  AdminAccountRole,
  AdminAccountStatus,
} from './entities/admin-account.entity';
import {
  AdminAuditAction,
  AdminAuditLog,
} from './entities/admin-audit-log.entity';
import { AdminJobStatus, AdminUserRestrictionFilter } from './admin.types';

type RepositoryMock = Record<string, unknown>;

function createAdminDataSourceMock(options: {
  auditLogsRepository?: Partial<RepositoryMock>;
  query?: jest.Mock;
  sessionsRepository?: Partial<RepositoryMock>;
  usersRepository?: Partial<RepositoryMock>;
}): DataSource {
  const usersRepository = {
    findOne: jest.fn(),
    save: jest.fn(async (value: User) => value),
    ...options.usersRepository,
  };
  const sessionsRepository = {
    update: jest.fn(),
    ...options.sessionsRepository,
  };
  const auditLogsRepository = {
    create: jest.fn((value: Partial<AdminAuditLog>) => value as AdminAuditLog),
    save: jest.fn(async (value: AdminAuditLog) => value),
    ...options.auditLogsRepository,
  };
  const manager = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === User) return usersRepository;
      if (entity === AuthSession) return sessionsRepository;
      if (entity === AdminAuditLog) return auditLogsRepository;
      throw new Error('Unexpected repository requested');
    }),
  };

  return {
    query: options.query ?? jest.fn(),
    transaction: jest.fn(
      async (
        operation: (transactionManager: typeof manager) => Promise<unknown>,
      ) => operation(manager),
    ),
  } as unknown as DataSource;
}

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    account_deletion_cancel_token_consumed_at: null,
    account_deletion_cancel_token_hash: null,
    account_deletion_confirm_expires: null,
    account_deletion_confirm_token_hash: null,
    account_deletion_requested_at: null,
    account_deletion_scheduled_for: null,
    account_restricted_at: null,
    account_restricted_by_admin_id: null,
    account_restriction_reason: null,
    apple_subject: null,
    canonical_email: 'jane@example.com',
    consents: [],
    created_at: new Date('2026-05-01T10:00:00.000Z'),
    data_access_logs: [],
    date_of_birth: null,
    email: 'jane@example.com',
    email_verification_expires: null,
    email_verification_token_hash: null,
    email_verified: true,
    first_name: 'Jane',
    generateId: jest.fn(),
    google_subject: null,
    id: '01USER',
    last_name: 'Doe',
    password_hash: null,
    password_reset_expires: null,
    password_reset_token_hash: null,
    preferred_language: 'en',
    sex_at_birth: null,
    time_zone: 'Europe/Stockholm',
    updated_at: new Date('2026-05-10T10:00:00.000Z'),
    ...overrides,
  };
}

describe('AdminService', () => {
  it('returns the current admin member without exposing sensitive user fields', () => {
    const service = new AdminService(createAdminDataSourceMock({}));

    const member = service.getCurrentAdmin({
      email: 'owner@ritora.app',
      id: 'admin-root',
      name: 'Root Admin',
      role: AdminAccountRole.Root,
      sessionId: 'session-1',
      status: AdminAccountStatus.Active,
    });

    expect(member).toEqual({
      acceptedAt: null,
      createdAt: expect.any(String),
      createdByAdminId: null,
      email: 'owner@ritora.app',
      id: 'admin-root',
      invitedAt: null,
      lastLoginAt: null,
      name: 'Root Admin',
      permissions: [
        'metrics:read',
        'users:read',
        'users:restrict',
        'jobs:write',
        'audit:read',
      ],
      role: 'root',
      roles: ['root'],
      status: 'active',
    });
    expect(JSON.stringify(member)).not.toContain('password');
  });

  it('gives non-root admins product-operation permissions without admin-account authority', () => {
    const service = new AdminService(createAdminDataSourceMock({}));

    const member = service.getCurrentAdmin({
      email: 'ops@ritora.app',
      id: 'admin-ops',
      name: 'Ops Admin',
      role: AdminAccountRole.Admin,
      sessionId: 'session-1',
      status: AdminAccountStatus.Active,
    });

    expect(member.permissions).toEqual([
      'metrics:read',
      'users:read',
      'users:restrict',
      'jobs:write',
      'audit:read',
    ]);
    expect(member.roles).toEqual(['admin']);
  });

  it('aggregates product health, jobs, alerts, and compliance metrics', async () => {
    const query = jest
      .fn<Promise<Array<Record<string, unknown>>>, [string, unknown[]?]>()
      .mockResolvedValueOnce([
        {
          registered_users: '1240',
          verified_users: '1000',
          weekly_active_users: '320',
          skin_profile_users: '760',
          routine_users: '756',
          weekly_checkin_users: '434',
          suggestion_users: '420',
          journal_users: '520',
          pending_deletion_count: '1',
          failed_export_count: '2',
          sensitive_access_events_24h: '3',
          analysis_completed_count: '98',
          analysis_failed_count: '2',
          journal_ai_cost_mtd: '7.4',
          suggestion_ai_cost_mtd: '5',
          active_restrictions: '4',
        },
      ])
      .mockResolvedValueOnce([
        {
          failed: '3',
          oldest_queued_age_seconds: '900',
          queued: '12',
        },
      ])
      .mockResolvedValueOnce([
        {
          failed: '0',
          oldest_queued_age_seconds: null,
          queued: '1',
        },
      ])
      .mockResolvedValueOnce([
        {
          failed: '0',
          oldest_queued_age_seconds: '120',
          queued: '2',
        },
      ]);
    const service = new AdminService({ query } as unknown as DataSource);

    const result = await service.getOverview(
      new Date('2026-05-20T10:00:00.000Z'),
    );

    expect(result.generatedAt).toBe('2026-05-20T10:00:00.000Z');
    expect(result.metrics).toEqual({
      activeRestrictions: 4,
      activationRate: 61,
      aiSuccessRate: 98,
      dailyCheckInRate: 35,
      monthToDateAiCostUsd: 12.4,
      registeredUsers: 1240,
      routineAcceptanceRate: 61,
      verifiedUsers: 1000,
      weeklyActiveUsers: 320,
    });
    expect(result.activationFunnel).toEqual([
      { count: 1240, label: 'Account created', stage: 'account_created' },
      {
        count: 760,
        label: 'Skin profile created',
        stage: 'skin_profile_created',
      },
      {
        count: 420,
        label: 'First suggestion recorded',
        stage: 'first_suggestion_recorded',
      },
      {
        count: 520,
        label: 'Journal check-in recorded',
        stage: 'journal_check_in_recorded',
      },
    ]);
    expect(result.jobHealth[0]).toEqual({
      failed: 3,
      id: 'journal-analysis',
      label: 'Journal analysis',
      oldestQueuedAgeSeconds: 900,
      queued: 12,
      status: 'critical',
    });
    expect(result.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'critical',
          title: 'Analysis queue delayed',
        }),
        expect.objectContaining({
          severity: 'critical',
          title: 'Journal exports failing',
        }),
      ]),
    );
    expect(result.compliance).toEqual({
      failedExportCount: 2,
      pendingDeletionCount: 1,
      sensitiveAccessEvents24h: 3,
    });
    expect(JSON.stringify(result)).not.toContain('user-1');
  });

  it('lists users for monitoring without exposing sensitive profile fields', async () => {
    const query = jest.fn().mockResolvedValueOnce([
      {
        account_deletion_scheduled_for: null,
        account_restricted_at: '2026-05-20T09:00:00.000Z',
        account_restricted_by_admin_id: 'admin-root',
        account_restriction_reason: 'Suspicious automated activity',
        created_at: '2026-05-01T10:00:00.000Z',
        email: 'jane@example.com',
        email_verified: true,
        first_name: 'Jane',
        id: '01USER',
        last_active_at: '2026-05-20T08:00:00.000Z',
        last_name: 'Doe',
        preferred_language: 'en',
        time_zone: 'Europe/Stockholm',
        total_count: '1',
        updated_at: '2026-05-20T09:00:00.000Z',
      },
    ]);
    const service = new AdminService(createAdminDataSourceMock({ query }));

    const result = await service.listUsers({
      limit: 25,
      page: 2,
      query: 'jane_%',
      restriction: AdminUserRestrictionFilter.Restricted,
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('account_restricted_at IS NOT NULL'),
      expect.arrayContaining(['%jane\\_\\%%', 25, 25]),
    );
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('WITH filtered_users AS');
    expect(sql).toContain('OFFSET');
    expect(sql).toContain("ESCAPE '\\'");
    expect(sql).toContain('LEFT JOIN LATERAL');
    expect(sql).toContain('ORDER BY auth_sessions.last_used_at DESC');
    expect(sql).not.toContain('GROUP BY');
    expect(result).toEqual({
      hasNextPage: false,
      hasPreviousPage: true,
      limit: 25,
      page: 2,
      total: 1,
      totalPages: 1,
      users: [
        {
          accountDeletionScheduledFor: null,
          createdAt: '2026-05-01T10:00:00.000Z',
          email: 'jane@example.com',
          emailVerified: true,
          firstName: 'Jane',
          id: '01USER',
          lastActiveAt: '2026-05-20T08:00:00.000Z',
          lastName: 'Doe',
          preferredLanguage: 'en',
          restrictedAt: '2026-05-20T09:00:00.000Z',
          restrictedByAdminId: 'admin-root',
          restrictionReason: 'Suspicious automated activity',
          timeZone: 'Europe/Stockholm',
          updatedAt: '2026-05-20T09:00:00.000Z',
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('date_of_birth');
    expect(JSON.stringify(result)).not.toContain('sex_at_birth');
  });

  it('returns pagination metadata for empty user pages without mapping null rows', async () => {
    const query = jest.fn().mockResolvedValueOnce([
      {
        id: null,
        total_count: '3',
      },
    ]);
    const service = new AdminService(createAdminDataSourceMock({ query }));

    const result = await service.listUsers({ limit: 2, page: 3 });

    expect(result).toEqual({
      hasNextPage: false,
      hasPreviousPage: true,
      limit: 2,
      page: 3,
      total: 3,
      totalPages: 2,
      users: [],
    });
  });

  it('returns a deeper user detail without exposing encrypted profile fields', async () => {
    const query = jest
      .fn<Promise<Array<Record<string, unknown>>>, [string, unknown[]?]>()
      .mockResolvedValueOnce([
        {
          account_deletion_scheduled_for: null,
          account_restricted_at: null,
          account_restricted_by_admin_id: null,
          account_restriction_reason: null,
          active_session_count: '2',
          analysis_completed_count: '8',
          analysis_failed_count: '1',
          created_at: '2026-05-01T10:00:00.000Z',
          email: 'jane@example.com',
          email_verified: true,
          failed_export_count: '0',
          first_name: 'Jane',
          has_skin_profile: true,
          id: '01USER',
          journal_entry_count: '12',
          last_active_at: '2026-05-20T08:00:00.000Z',
          last_name: 'Doe',
          latest_journal_entry_at: '2026-05-19T08:00:00.000Z',
          latest_suggestion_at: '2026-05-20T06:00:00.000Z',
          preferred_language: 'en',
          sensitive_access_events_24h: '1',
          suggestion_count: '9',
          time_zone: 'Europe/Stockholm',
          total_session_count: '3',
          updated_at: '2026-05-20T09:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          action: AdminAuditAction.UserRestricted,
          actor_admin_email: 'owner@ritora.app',
          actor_admin_id: 'admin-root',
          actor_admin_name: 'Root Admin',
          actor_session_id: 'admin-session',
          created_at: '2026-05-20T09:00:00.000Z',
          id: 'audit-1',
          ip_address: '127.0.0.1',
          metadata: { userEmail: 'jane@example.com' },
          reason: 'Suspicious automated activity',
          target_admin_email: null,
          target_admin_id: null,
          target_admin_name: null,
          target_user_email: 'jane@example.com',
          target_user_id: '01USER',
          target_user_name: 'Jane Doe',
          total_count: '1',
          user_agent: 'Jest',
        },
      ]);
    const service = new AdminService(createAdminDataSourceMock({ query }));

    const result = await service.getUser('01USER');

    expect(query).toHaveBeenNthCalledWith(1, expect.any(String), [
      '01USER',
      'completed',
      'failed',
      'failed',
      expect.any(Date),
    ]);
    expect(result.activity).toEqual({
      activeSessionCount: 2,
      analysisCompletedCount: 8,
      analysisFailedCount: 1,
      hasSkinProfile: true,
      journalEntryCount: 12,
      latestJournalEntryAt: '2026-05-19T08:00:00.000Z',
      latestSuggestionAt: '2026-05-20T06:00:00.000Z',
      suggestionCount: 9,
      totalSessionCount: 3,
    });
    expect(result.safety).toEqual({
      failedExportCount: 0,
      sensitiveAccessEvents24h: 1,
    });
    expect(result.recentAuditLogs).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('date_of_birth');
    expect(JSON.stringify(result)).not.toContain('sex_at_birth');
  });

  it('returns not found for a missing user detail', async () => {
    const service = new AdminService(
      createAdminDataSourceMock({ query: jest.fn().mockResolvedValueOnce([]) }),
    );

    await expect(service.getUser('missing-user')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('lists audit logs with search, filters, and stable pagination', async () => {
    const query = jest.fn().mockResolvedValueOnce([
      {
        action: AdminAuditAction.AdminInvited,
        actor_admin_email: 'owner@ritora.app',
        actor_admin_id: 'admin-root',
        actor_admin_name: 'Root Admin',
        actor_session_id: 'session-1',
        created_at: '2026-05-20T10:00:00.000Z',
        id: 'audit-1',
        ip_address: '127.0.0.1',
        metadata: { invitedEmail: 'ops@ritora.app' },
        reason: 'Launch operations coverage',
        target_admin_email: 'ops@ritora.app',
        target_admin_id: 'admin-ops',
        target_admin_name: 'Ops Lead',
        target_user_email: null,
        target_user_id: null,
        target_user_name: null,
        total_count: '1',
        user_agent: 'Jest',
      },
    ]);
    const service = new AdminService(createAdminDataSourceMock({ query }));

    const result = await service.listAuditLogs({
      action: AdminAuditAction.AdminInvited,
      limit: 25,
      page: 1,
      query: 'ops_%',
      targetAdminId: 'admin-ops',
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WITH filtered_logs AS'),
      expect.arrayContaining([
        AdminAuditAction.AdminInvited,
        'admin-ops',
        '%ops\\_\\%%',
        25,
        0,
      ]),
    );
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('LEFT JOIN users target_user');
    expect(sql).toContain("ESCAPE '\\'");
    expect(sql).toContain('ORDER BY created_at DESC, id DESC');
    expect(result.logs[0]).toEqual(
      expect.objectContaining({
        action: AdminAuditAction.AdminInvited,
        actor: {
          email: 'owner@ritora.app',
          id: 'admin-root',
          name: 'Root Admin',
        },
        target: {
          email: 'ops@ritora.app',
          id: 'admin-ops',
          name: 'Ops Lead',
          type: 'admin',
        },
      }),
    );
    expect(JSON.stringify(result)).not.toContain('password');
  });

  it('aggregates operations monitoring work items without exposing encrypted payloads', async () => {
    const query = jest
      .fn<Promise<Array<Record<string, unknown>>>, [string, unknown[]?]>()
      .mockResolvedValueOnce([
        { failed: '0', oldest_queued_age_seconds: '620', queued: '3' },
      ])
      .mockResolvedValueOnce([
        { failed: '1', oldest_queued_age_seconds: null, queued: '0' },
      ])
      .mockResolvedValueOnce([
        { failed: '0', oldest_queued_age_seconds: '60', queued: '1' },
      ])
      .mockResolvedValueOnce([
        {
          failed_export_count: '1',
          pending_deletion_count: '2',
          sensitive_access_events_24h: '3',
        },
      ])
      .mockResolvedValueOnce([
        {
          attempt_count: '2',
          created_at: '2026-05-20T09:00:00.000Z',
          id: 'job-1',
          last_error: 'Provider timed out',
          label: 'Journal analysis',
          run_after: '2026-05-20T09:45:00.000Z',
          severity: AdminJobStatus.Critical,
          status: 'failed',
          type: 'journal-analysis',
          updated_at: '2026-05-20T09:55:00.000Z',
          user_email: 'jane@example.com',
          user_id: '01USER',
        },
      ]);
    const service = new AdminService(createAdminDataSourceMock({ query }));

    const result = await service.getOperationsMonitoring(
      new Date('2026-05-20T10:00:00.000Z'),
    );

    expect(result.generatedAt).toBe('2026-05-20T10:00:00.000Z');
    expect(result.jobHealth[0]).toEqual(
      expect.objectContaining({
        id: 'journal-analysis',
        status: AdminJobStatus.Critical,
      }),
    );
    expect(result.compliance).toEqual({
      failedExportCount: 1,
      pendingDeletionCount: 2,
      sensitiveAccessEvents24h: 3,
    });
    expect(result.workItems[0]).toEqual(
      expect.objectContaining({
        id: 'job-1',
        lastError: 'Provider timed out',
        severity: AdminJobStatus.Critical,
        type: 'journal-analysis',
        userEmail: 'jane@example.com',
      }),
    );
    expect(JSON.stringify(result)).not.toContain('payload');
  });

  it('restricts a user, revokes active sessions, and writes an admin audit log atomically', async () => {
    const user = fakeUser();
    const save = jest.fn(async (value: User) => value);
    const sessionUpdate = jest.fn();
    const auditCreate = jest.fn(
      (value: Partial<AdminAuditLog>) => value as AdminAuditLog,
    );
    const auditSave = jest.fn(async (value: AdminAuditLog) => value);
    const dataSource = createAdminDataSourceMock({
      auditLogsRepository: { create: auditCreate, save: auditSave },
      sessionsRepository: { update: sessionUpdate },
      usersRepository: {
        findOne: jest.fn(async () => user),
        save,
      },
    });
    const service = new AdminService(dataSource);

    const result = await service.restrictUser(
      {
        email: 'owner@ritora.app',
        id: 'admin-root',
        name: 'Root Admin',
        role: AdminAccountRole.Root,
        sessionId: 'admin-session',
        status: AdminAccountStatus.Active,
      },
      '01USER',
      {
        ip: '127.0.0.1',
        reason: 'Suspicious automated activity',
        sessionId: 'admin-session',
        userAgent: 'Jest',
      },
    );

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        account_restricted_at: expect.any(Date),
        account_restricted_by_admin_id: 'admin-root',
        account_restriction_reason: 'Suspicious automated activity',
      }),
    );
    expect(sessionUpdate).toHaveBeenCalledWith(
      { revoked_at: expect.any(Object), user_id: '01USER' },
      { revoked_at: expect.any(Date) },
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AdminAuditAction.UserRestricted,
        actor_admin_id: 'admin-root',
        actor_session_id: 'admin-session',
        reason: 'Suspicious automated activity',
        target_user_id: '01USER',
      }),
    );
    expect(result.restrictedAt).toEqual(expect.any(String));
  });

  it('unrestricts a user and keeps an audit trail', async () => {
    const user = fakeUser({
      account_restricted_at: new Date('2026-05-20T09:00:00.000Z'),
      account_restricted_by_admin_id: 'admin-root',
      account_restriction_reason: 'Suspicious automated activity',
    });
    const save = jest.fn(async (value: User) => value);
    const auditCreate = jest.fn(
      (value: Partial<AdminAuditLog>) => value as AdminAuditLog,
    );
    const service = new AdminService(
      createAdminDataSourceMock({
        auditLogsRepository: { create: auditCreate },
        usersRepository: {
          findOne: jest.fn(async () => user),
          save,
        },
      }),
    );

    const result = await service.unrestrictUser(
      {
        email: 'owner@ritora.app',
        id: 'admin-root',
        name: 'Root Admin',
        role: AdminAccountRole.Root,
        sessionId: 'admin-session',
        status: AdminAccountStatus.Active,
      },
      '01USER',
      {
        reason: 'Manual review cleared the account',
        sessionId: 'admin-session',
      },
    );

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        account_restricted_at: null,
        account_restricted_by_admin_id: null,
        account_restriction_reason: null,
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AdminAuditAction.UserUnrestricted,
        reason: 'Manual review cleared the account',
        target_user_id: '01USER',
      }),
    );
    expect(result.restrictedAt).toBeNull();
  });

  it('returns not found when restricting a missing user', async () => {
    const service = new AdminService(
      createAdminDataSourceMock({
        usersRepository: {
          findOne: jest.fn(async () => null),
        },
      }),
    );

    await expect(
      service.restrictUser(
        {
          email: 'owner@ritora.app',
          id: 'admin-root',
          name: 'Root Admin',
          role: AdminAccountRole.Root,
          sessionId: 'admin-session',
          status: AdminAccountStatus.Active,
        },
        'missing-user',
        {
          reason: 'Suspicious automated activity',
          sessionId: 'admin-session',
        },
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthSession } from '../auth/entities/auth-session.entity';
import { User } from '../users/entities/user.entity';
import {
  ACCOUNT_MONITORING_INCIDENT_SESSION_ID,
  AdminService,
} from './admin.service';
import {
  AdminAccountRole,
  AdminAccountStatus,
  AdminAccount,
} from './entities/admin-account.entity';
import {
  AdminAccountMonitoringFlag,
  AdminAccountMonitoringSeverity,
  AdminAccountMonitoringSignalType,
  AdminAccountMonitoringStatus,
  encryptedAccountMonitoringInternalNoteTransformer,
  encryptedAccountMonitoringLatestSignalTransformer,
  encryptedAccountMonitoringResolutionNoteTransformer,
} from './entities/admin-account-monitoring-flag.entity';
import {
  ADMIN_ACCOUNT_MONITORING_SETTINGS_ID,
  AdminAccountMonitoringSettings,
} from './entities/admin-account-monitoring-settings.entity';
import {
  AdminAuditAction,
  AdminAuditLog,
} from './entities/admin-audit-log.entity';
import { encryptedNullableStringFieldTransformer } from '../skin-profile/skin-profile-field-encryption';
import {
  AdminOperationalIncident,
  AdminOperationalIncidentSeverity,
  AdminOperationalIncidentStatus,
  encryptedIncidentDescriptionTransformer,
  encryptedIncidentResolutionTransformer,
} from './entities/admin-operational-incident.entity';
import {
  AdminNotification,
  AdminNotificationSeverity,
  AdminNotificationType,
} from './entities/admin-notification.entity';
import { AdminUserNote } from './entities/admin-user-note.entity';
import {
  AdminAiCostFeatureFilter,
  AdminJobStatus,
  AdminUserRestrictionFilter,
} from './admin.types';
import { AdminOperationalIncidentStatusFilter } from './dto/admin-operational-incident.dto';
import { AdminAccountMonitoringStatusFilter } from './dto/admin-account-monitoring.dto';
import { UserRestrictionCapability } from '../users/user-restrictions';
import { PlatformGlobalRestrictionCapability } from '../platform-controls/platform-global-restrictions';
import { AccountMonitoringEvent } from '../users/entities/account-monitoring-event.entity';

type RepositoryMock = Record<string, unknown>;

const restrictionInternalNoteTransformer =
  encryptedNullableStringFieldTransformer(
    'users.account_restriction_internal_note',
  );
const restrictionUserMessageTransformer =
  encryptedNullableStringFieldTransformer(
    'users.account_restriction_user_message',
  );

function createAdminDataSourceMock(options: {
  accountsRepository?: Partial<RepositoryMock>;
  auditLogsRepository?: Partial<RepositoryMock>;
  incidentsRepository?: Partial<RepositoryMock>;
  notificationsRepository?: Partial<RepositoryMock>;
  monitoringRepository?: Partial<RepositoryMock>;
  monitoringEventsRepository?: Partial<RepositoryMock>;
  monitoringSettingsRepository?: Partial<RepositoryMock>;
  notesRepository?: Partial<RepositoryMock>;
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
  const notesRepository = {
    create: jest.fn((value: Partial<AdminUserNote>) => value as AdminUserNote),
    findAndCount: jest.fn(async () => [[], 0]),
    save: jest.fn(async (value: AdminUserNote) => value),
    ...options.notesRepository,
  };
  const accountsRepository = {
    findOne: jest.fn(),
    ...options.accountsRepository,
  };
  const monitoringRepository = {
    create: jest.fn(
      (value: Partial<AdminAccountMonitoringFlag>) =>
        value as AdminAccountMonitoringFlag,
    ),
    find: jest.fn(async () => []),
    findOne: jest.fn(),
    save: jest.fn(async (value: AdminAccountMonitoringFlag) => value),
    ...options.monitoringRepository,
  };
  const monitoringEventsRepository = {
    create: jest.fn((value: Partial<AccountMonitoringEvent>) => value),
    find: jest.fn(async () => []),
    save: jest.fn(async (value: AccountMonitoringEvent) => value),
    ...options.monitoringEventsRepository,
  };
  const monitoringSettingsRepository = {
    create: jest.fn(
      (value: Partial<AdminAccountMonitoringSettings>) =>
        value as AdminAccountMonitoringSettings,
    ),
    findOne: jest.fn(),
    save: jest.fn(async (value: AdminAccountMonitoringSettings) => value),
    ...options.monitoringSettingsRepository,
  };
  const incidentsRepository = {
    create: jest.fn(
      (value: Partial<AdminOperationalIncident>) =>
        value as AdminOperationalIncident,
    ),
    find: jest.fn(async () => []),
    findOne: jest.fn(),
    save: jest.fn(async (value: AdminOperationalIncident) => value),
    ...options.incidentsRepository,
  };
  const notificationsRepository = {
    create: jest.fn(
      (value: Partial<AdminNotification>) => value as AdminNotification,
    ),
    count: jest.fn(async () => 0),
    createQueryBuilder: jest.fn(() => ({
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => []),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    })),
    findOne: jest.fn(),
    save: jest.fn(async (value: AdminNotification) => value),
    ...options.notificationsRepository,
  };
  const manager = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === AdminAccount) return accountsRepository;
      if (entity === User) return usersRepository;
      if (entity === AuthSession) return sessionsRepository;
      if (entity === AdminAuditLog) return auditLogsRepository;
      if (entity === AccountMonitoringEvent) {
        return monitoringEventsRepository;
      }
      if (entity === AdminAccountMonitoringFlag) return monitoringRepository;
      if (entity === AdminAccountMonitoringSettings) {
        return monitoringSettingsRepository;
      }
      if (entity === AdminUserNote) return notesRepository;
      if (entity === AdminOperationalIncident) return incidentsRepository;
      if (entity === AdminNotification) return notificationsRepository;
      throw new Error('Unexpected repository requested');
    }),
  };

  return {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === AdminAccount) return accountsRepository;
      if (entity === AdminUserNote) return notesRepository;
      if (entity === AdminOperationalIncident) return incidentsRepository;
      if (entity === AdminNotification) return notificationsRepository;
      if (entity === AccountMonitoringEvent) {
        return monitoringEventsRepository;
      }
      if (entity === AdminAccountMonitoringFlag) return monitoringRepository;
      if (entity === AdminAccountMonitoringSettings) {
        return monitoringSettingsRepository;
      }
      throw new Error('Unexpected repository requested');
    }),
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
    account_restriction_capabilities: null,
    account_restriction_expires_at: null,
    account_restriction_internal_note: null,
    account_restriction_reason: null,
    account_restriction_user_message: null,
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

function fakeMonitoringFlag(
  overrides: Partial<AdminAccountMonitoringFlag> = {},
): AdminAccountMonitoringFlag {
  return {
    assigned_admin_id: 'admin-ops',
    created_at: new Date('2026-05-21T09:00:00.000Z'),
    created_by_admin_id: 'admin-ops',
    generateId: jest.fn(),
    id: 'flag-1',
    internal_note: 'Review AI cost trend before taking action.',
    latest_signal: 'AI spend crossed the daily review threshold.',
    next_review_at: new Date('2099-05-22T09:00:00.000Z'),
    resolution_note: null,
    resolved_at: null,
    resolved_by_admin_id: null,
    severity: AdminAccountMonitoringSeverity.Warning,
    signal_type: AdminAccountMonitoringSignalType.HighAiCost,
    status: AdminAccountMonitoringStatus.Open,
    summary: 'High AI spend spike',
    updated_at: new Date('2026-05-21T09:00:00.000Z'),
    user_id: '01USER',
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
      mfaEnabled: false,
      mfaEnabledAt: null,
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

  it('lists and marks admin notifications without exposing unsafe metadata', async () => {
    const notification = {
      action_url: '/account-monitoring?status=active',
      admin_id: 'admin-ops',
      body: 'High AI usage needs review.',
      created_at: new Date('2026-05-22T09:00:00.000Z'),
      generateId: jest.fn(),
      id: 'notification-1',
      metadata: {
        flagId: 'flag-1',
        secret: 'must-not-leak',
        userId: '01USER',
      },
      read_at: null,
      severity: AdminNotificationSeverity.Warning,
      title: 'Account monitoring flag opened',
      type: AdminNotificationType.AccountMonitoringAlert,
    } as AdminNotification;
    const save = jest.fn(async (value: AdminNotification) => value);
    const service = new AdminService(
      createAdminDataSourceMock({
        notificationsRepository: {
          count: jest.fn(async () => 1),
          createQueryBuilder: jest.fn(() => ({
            addOrderBy: jest.fn().mockReturnThis(),
            getMany: jest.fn(async () => [notification]),
            orderBy: jest.fn().mockReturnThis(),
            take: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
          })),
          findOne: jest.fn(async () => notification),
          save,
        },
      }),
    );
    const actor = {
      email: 'ops@ritora.app',
      id: 'admin-ops',
      name: 'Ops Lead',
      role: AdminAccountRole.Admin,
      sessionId: 'admin-session',
      status: AdminAccountStatus.Active,
    };

    await expect(service.listNotifications(actor)).resolves.toMatchObject({
      notifications: [
        {
          id: 'notification-1',
          metadata: { flagId: 'flag-1', userId: '01USER' },
          readAt: null,
        },
      ],
      unreadCount: 1,
    });
    await expect(
      service.markNotificationRead(actor, 'notification-1'),
    ).resolves.toMatchObject({
      id: 'notification-1',
      readAt: expect.any(String),
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'notification-1',
        read_at: expect.any(Date),
      }),
    );
  });

  it('aggregates product health, jobs, alerts, and compliance metrics', async () => {
    const query = jest
      .fn<Promise<Array<Record<string, unknown>>>, [string, unknown[]?]>()
      .mockResolvedValueOnce([
        {
          active_restrictions: '4',
          daily_active_users: '90',
          daily_checkin_users: '124',
          failed_export_count: '2',
          journal_ai_cost_mtd: '7.4',
          journal_ai_cost_today: '1.2',
          journal_users: '520',
          journal_insights_ai_cost_mtd: '1.4',
          journal_insights_ai_cost_today: '0.3',
          monthly_active_users: '690',
          new_signups_30d: '240',
          new_signups_7d: '84',
          new_signups_today: '12',
          notification_users: '610',
          pending_deletion_count: '1',
          product_check_ai_cost_mtd: '2.1',
          product_check_ai_cost_today: '0.6',
          product_check_failed_count: '10',
          product_check_reviewed_count: '490',
          product_users: '500',
          registered_users: '1240',
          retention_cohorts: [
            {
              eligibleUsers: 900,
              id: 'day_1',
              label: 'Day 1',
              retainedUsers: 630,
            },
            {
              eligibleUsers: 700,
              id: 'day_7',
              label: 'Day 7',
              retainedUsers: 350,
            },
            {
              eligibleUsers: 200,
              id: 'day_30',
              label: 'Day 30',
              retainedUsers: 60,
            },
          ],
          routine_recorded_count: '549',
          routine_users: '420',
          schedule_users: '680',
          signup_trend: [
            { count: 5, date: '2026-05-14' },
            { count: 12, date: '2026-05-20' },
          ],
          skin_profile_users: '760',
          smart_pick_completed_count: '20',
          smart_pick_ai_cost_mtd: '3.5',
          smart_pick_ai_cost_today: '0.4',
          smart_pick_failed_count: '1',
          smart_pick_users: '210',
          suggestion_ai_cost_mtd: '5',
          suggestion_ai_cost_today: '0.8',
          suggestion_failed_count: '5',
          suggestion_generated_users: '700',
          suggestion_ready_count: '900',
          sensitive_access_events_24h: '3',
          analysis_completed_count: '98',
          analysis_failed_count: '2',
          insight_completed_count: '70',
          insight_failed_count: '5',
          ingredient_analysis_ai_cost_mtd: '1.2',
          ingredient_analysis_ai_cost_today: '0.2',
          ingredient_analysis_completed_count: '44',
          ingredient_analysis_failed_count: '4',
          verified_users: '1000',
          weekly_active_users: '320',
          active_user_trend: [
            {
              dailyActiveUsers: 44,
              date: '2026-05-14',
              monthlyActiveUsers: 610,
              weeklyActiveUsers: 280,
            },
            {
              dailyActiveUsers: 90,
              date: '2026-05-20',
              monthlyActiveUsers: 690,
              weeklyActiveUsers: 320,
            },
          ],
          endpoint_health: [
            {
              errorRate: 1,
              method: 'GET',
              p95LatencyMs: 140,
              requestCount: 900,
              route: '/admin/users',
            },
            {
              errorRate: 7,
              method: 'POST',
              p95LatencyMs: 1250,
              requestCount: 40,
              route: '/admin/users/:id/restrictions',
            },
          ],
        },
      ])
      .mockResolvedValueOnce([
        {
          failed: '3',
          id: 'journal-analysis',
          label: 'Journal analysis',
          oldest_queued_age_seconds: '900',
          queued: '12',
        },
        {
          failed: '0',
          id: 'smart-picks',
          label: 'Smart Picks',
          oldest_queued_age_seconds: null,
          queued: '1',
        },
        {
          failed: '0',
          id: 'suggestions',
          label: 'Daily suggestions',
          oldest_queued_age_seconds: '120',
          queued: '2',
        },
        {
          failed: '1',
          id: 'ingredient-analysis',
          label: 'Ingredient analysis',
          oldest_queued_age_seconds: '300',
          queued: '4',
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
      criticalAlerts: 2,
      dailyActiveUsers: 90,
      dailyCheckInRate: 10,
      monthToDateAiCostUsd: 20.6,
      monthlyActiveUsers: 690,
      newSignups30d: 240,
      newSignups7d: 84,
      newSignupsToday: 12,
      productAddSuccessRate: 40,
      registeredUsers: 1240,
      routineAcceptanceRate: 61,
      todayAiCostUsd: 3.5,
      verifiedUsers: 1000,
      weeklyActiveUsers: 320,
    });
    expect(result.activationFunnel).toEqual([
      { count: 1240, label: 'Account created', stage: 'account_created' },
      { count: 1000, label: 'Email verified', stage: 'email_verified' },
      {
        count: 760,
        label: 'Skin profile created',
        stage: 'skin_profile_created',
      },
      {
        count: 500,
        label: 'First product added',
        stage: 'first_product_added',
      },
      {
        count: 680,
        label: 'First schedule slot created',
        stage: 'first_schedule_slot_created',
      },
      {
        count: 700,
        label: 'First suggestion generated',
        stage: 'first_suggestion_generated',
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
      {
        count: 610,
        label: 'Notification preference enabled',
        stage: 'notification_preference_enabled',
      },
    ]);
    expect(result.signupTrend).toEqual([
      { count: 5, date: '2026-05-14' },
      { count: 12, date: '2026-05-20' },
    ]);
    expect(result.activeUserTrend.at(-1)).toEqual({
      dailyActiveUsers: 90,
      date: '2026-05-20',
      monthlyActiveUsers: 690,
      weeklyActiveUsers: 320,
    });
    expect(result.retentionCohorts).toEqual([
      {
        eligibleUsers: 900,
        id: 'day_1',
        label: 'Day 1',
        rate: 70,
        retainedUsers: 630,
      },
      {
        eligibleUsers: 700,
        id: 'day_7',
        label: 'Day 7',
        rate: 50,
        retainedUsers: 350,
      },
      {
        eligibleUsers: 200,
        id: 'day_30',
        label: 'Day 30',
        rate: 30,
        retainedUsers: 60,
      },
    ]);
    expect(result.featureAdoption).toEqual(
      expect.arrayContaining([
        {
          id: 'shelf',
          label: 'Shelf products',
          rate: 40,
          users: 500,
        },
        {
          id: 'notifications',
          label: 'Notification preferences',
          rate: 49,
          users: 610,
        },
      ]),
    );
    expect(result.aiCostByFeature).toEqual([
      {
        id: 'journal_analysis',
        label: 'Journal analysis',
        monthToDateCostUsd: 7.4,
        successRate: 98,
        todayCostUsd: 1.2,
      },
      {
        id: 'daily_suggestions',
        label: 'Daily suggestions',
        monthToDateCostUsd: 5,
        successRate: 99,
        todayCostUsd: 0.8,
      },
      {
        id: 'journal_insights',
        label: 'AI Insights',
        monthToDateCostUsd: 1.4,
        successRate: 93,
        todayCostUsd: 0.3,
      },
      {
        id: 'quick_check',
        label: 'Quick Check',
        monthToDateCostUsd: 2.1,
        successRate: 98,
        todayCostUsd: 0.6,
      },
      {
        id: 'ingredient_analysis',
        label: 'Ingredient analysis',
        monthToDateCostUsd: 1.2,
        successRate: 92,
        todayCostUsd: 0.2,
      },
      {
        id: 'smart_picks',
        label: 'Smart Picks',
        monthToDateCostUsd: 3.5,
        successRate: 95,
        todayCostUsd: 0.4,
      },
    ]);
    expect(result.endpointHealth).toEqual([
      {
        errorRate: 1,
        id: 'GET /admin/users',
        method: 'GET',
        p95LatencyMs: 140,
        requestCount: 900,
        route: '/admin/users',
        status: 'warning',
      },
      {
        errorRate: 7,
        id: 'POST /admin/users/:id/restrictions',
        method: 'POST',
        p95LatencyMs: 1250,
        requestCount: 40,
        route: '/admin/users/:id/restrictions',
        status: 'critical',
      },
    ]);
    expect(result.metricSources).toEqual([
      {
        id: 'endpoint_health',
        source: 'event',
      },
      {
        id: 'feature_adoption',
        source: 'event',
      },
      {
        id: 'retention',
        source: 'event',
      },
      {
        id: 'product_add_success',
        source: 'event',
      },
      {
        id: 'smart_picks_ai_cost',
        source: 'table',
      },
      {
        id: 'journal_insights_ai_cost',
        source: 'table',
      },
      {
        id: 'quick_check_ai_cost',
        source: 'table',
      },
      {
        id: 'ingredient_analysis_ai_cost',
        source: 'table',
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
    expect(result.alerts).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'sensitive-access-events' }),
      ]),
    );
    expect(result.compliance).toEqual({
      failedExportCount: 2,
      pendingDeletionCount: 1,
      sensitiveAccessEvents24h: 3,
    });
    const metricsSql = String(query.mock.calls[0]?.[0]);
    expect(metricsSql).toContain('product_event_counts AS');
    expect(metricsSql).toContain('product_analytics_events');
    expect(metricsSql).toContain('active_session_days AS');
    expect(metricsSql).toContain('http_request_metrics');
    expect(metricsSql).toContain('ai_estimated_cost_usd IS NOT NULL');
    expect(metricsSql).toContain('product_check_ai_review_metrics');
    expect(metricsSql).toContain('ingredient_analysis_ai_usage_metrics');
    expect(metricsSql).toContain('skin_journal_insight_generation_runs');
    expect(metricsSql).toContain("event_type = 'data_accessed'");
    expect(metricsSql).not.toContain(
      "FROM product_analytics_events\n              WHERE event_type = 'skin_profile_created'",
    );
    const jobHealthSql = String(query.mock.calls[1]?.[0]);
    expect(jobHealthSql).toContain('UNION ALL');
    expect(jobHealthSql).toContain('skin_journal_analysis_jobs');
    expect(jobHealthSql).toContain('ingredient_product_analysis_jobs');
    expect(query).toHaveBeenCalledTimes(2);
    expect(metricsSql).not.toContain('password_hash');
    expect(metricsSql).not.toContain('photo_object_key');
    expect(metricsSql).not.toContain('complaint_note');
    expect(JSON.stringify(result)).not.toContain('user-1');
  });

  it('lists paginated per-user AI cost breakdowns without sensitive payloads', async () => {
    const query = jest
      .fn<Promise<Array<Record<string, unknown>>>, [string, unknown[]?]>()
      .mockResolvedValueOnce([
        {
          daily_suggestions_cost_mtd: '0.8',
          daily_suggestions_cost_today: '0.2',
          email: 'jane@example.com',
          first_name: 'Jane',
          journal_analysis_cost_mtd: '1.1',
          journal_analysis_cost_today: '0.4',
          journal_insights_cost_mtd: '0.3',
          journal_insights_cost_today: '0.1',
          ingredient_analysis_cost_mtd: '0.2',
          ingredient_analysis_cost_today: '0.1',
          last_name: 'Doe',
          month_to_date_cost_usd: '3.3',
          quick_check_cost_mtd: '0.6',
          quick_check_cost_today: '0.1',
          smart_picks_cost_mtd: '0.3',
          smart_picks_cost_today: '0',
          today_cost_usd: '0.9',
          total_count: '1',
          user_id: '01USER',
        },
      ]);
    const service = new AdminService({ query } as unknown as DataSource);

    await expect(
      service.listAiCostByUsers({
        feature: AdminAiCostFeatureFilter.IngredientAnalysis,
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
      total: 1,
      totalPages: 1,
      users: [
        {
          email: 'jane@example.com',
          featureCosts: [
            {
              id: 'journal_analysis',
              label: 'Journal analysis',
              monthToDateCostUsd: 1.1,
              todayCostUsd: 0.4,
            },
            {
              id: 'daily_suggestions',
              label: 'Daily suggestions',
              monthToDateCostUsd: 0.8,
              todayCostUsd: 0.2,
            },
            {
              id: 'journal_insights',
              label: 'AI Insights',
              monthToDateCostUsd: 0.3,
              todayCostUsd: 0.1,
            },
            {
              id: 'quick_check',
              label: 'Quick Check',
              monthToDateCostUsd: 0.6,
              todayCostUsd: 0.1,
            },
            {
              id: 'ingredient_analysis',
              label: 'Ingredient analysis',
              monthToDateCostUsd: 0.2,
              todayCostUsd: 0.1,
            },
            {
              id: 'smart_picks',
              label: 'Smart Picks',
              monthToDateCostUsd: 0.3,
              todayCostUsd: 0,
            },
          ],
          monthToDateCostUsd: 3.3,
          name: 'Jane Doe',
          todayCostUsd: 0.9,
          userId: '01USER',
        },
      ],
    });

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('candidate_users AS');
    expect(sql).toContain('INNER JOIN candidate_users cost_users');
    expect(sql).toContain('INNER JOIN candidate_users users');
    expect(sql).toContain('feature_rollups AS');
    expect(sql).toContain('ingredient_analysis_ai_usage_metrics');
    expect(sql).toContain('GROUP BY ingredient_usage.user_id');
    expect(sql).not.toContain('product_check_ai_review_metrics');
    expect(sql).not.toContain('skin_journal_entries');
    expect(sql).not.toContain('skin_journal_insight_generation_runs');
    expect(sql).not.toContain('suggestion_instances');
    expect(sql).not.toContain('smart_pick_snapshots');
    expect(sql).not.toContain('cost_events AS');
    expect(sql).toContain('COUNT(*) OVER()');
    expect(sql).toContain('WHERE rollup.today_cost_usd > 0');
    expect(sql).toContain(
      'ORDER BY rollup.today_cost_usd DESC, rollup.month_to_date_cost_usd DESC, users.id ASC',
    );
    expect(sql).not.toContain('photo_object_key');
    expect(sql).not.toContain('complaint_note');
    expect(sql).not.toContain('ai_explanation');
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      expect.any(Date),
      expect.any(Date),
      expect.any(Date),
      '%jane%',
      10,
      0,
    ]);
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
    expect(sql).toContain('WITH expired_user_restrictions AS');
    expect(sql).toContain('UPDATE users');
    expect(sql).toContain('account_restriction_expires_at <= now()');
    expect(sql).toContain('filtered_users AS');
    expect(sql).toContain('OFFSET');
    expect(sql).toContain("ESCAPE '\\'");
    expect(sql).toContain('LEFT JOIN LATERAL');
    expect(sql).toContain('ORDER BY auth_sessions.last_used_at DESC');
    expect(sql).toContain('NULL::text AS account_restriction_internal_note');
    expect(sql).toContain('NULL::text AS account_restriction_user_message');
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
          accountStatus: 'suspended',
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
          restrictionCapabilities: [
            UserRestrictionCapability.DisableLogin,
            UserRestrictionCapability.ForceLogout,
          ],
          restrictionExpiresAt: null,
          restrictionInternalNote: null,
          restrictionReason: 'Suspicious automated activity',
          restrictionUserMessage: null,
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

  it('lists every platform-wide restriction capability with active state only from active rows', async () => {
    const query = jest.fn().mockResolvedValueOnce([
      {
        capability: PlatformGlobalRestrictionCapability.DisableAiGeneration,
        enabled_at: '2026-05-21T08:00:00.000Z',
        enabled_by_admin_email: 'owner@ritora.app',
        enabled_by_admin_id: 'admin-root',
        enabled_by_admin_name: 'Root Admin',
        expires_at: null,
        id: 'restriction-1',
        reason: 'Compromised API key response',
      },
    ]);
    const service = new AdminService({ query } as unknown as DataSource);

    await expect(service.listPlatformGlobalRestrictions()).resolves.toEqual({
      generatedAt: expect.any(String),
      restrictions: expect.arrayContaining([
        expect.objectContaining({
          active: true,
          capability: PlatformGlobalRestrictionCapability.DisableAiGeneration,
          enabledByAdmin: {
            email: 'owner@ritora.app',
            id: 'admin-root',
            name: 'Root Admin',
          },
          reason: 'Compromised API key response',
        }),
        expect.objectContaining({
          active: false,
          capability:
            PlatformGlobalRestrictionCapability.DisableAccountCreation,
          reason: null,
        }),
      ]),
    });

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('WITH expired_restrictions AS');
    expect(sql).toContain('UPDATE platform_global_restrictions');
    expect(sql).toContain("disable_reason = 'Expired automatically'");
    expect(sql).toContain('disabled_at IS NULL');
    expect(sql).toContain('expires_at > now()');
    expect(sql).not.toContain('internal_note');
  });

  it('enables and disables platform-wide restrictions transactionally with audit logs', async () => {
    const auditLogsRepository = {
      create: jest.fn(
        (value: Partial<AdminAuditLog>) => value as AdminAuditLog,
      ),
      save: jest.fn(async (value: AdminAuditLog) => value),
    };
    const managerQuery = jest
      .fn<Promise<Array<Record<string, unknown>>>, [string, unknown[]?]>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          capability: PlatformGlobalRestrictionCapability.DisableAiGeneration,
          enabled_at: '2026-05-21T09:00:00.000Z',
          enabled_by_admin_id: 'admin-root',
          expires_at: null,
          id: 'restriction-1',
          reason: 'Emergency model credential rotation',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          capability: PlatformGlobalRestrictionCapability.DisableAiGeneration,
          id: 'restriction-1',
        },
      ]);
    const transaction = jest.fn(
      async (
        operation: (manager: {
          getRepository: (entity: unknown) => typeof auditLogsRepository;
          query: typeof managerQuery;
        }) => Promise<unknown>,
      ) =>
        operation({
          getRepository: () => auditLogsRepository,
          query: managerQuery,
        }),
    );
    const service = new AdminService({
      transaction,
    } as unknown as DataSource);
    const actor = {
      email: 'owner@ritora.app',
      id: 'admin-root',
      name: 'Root Admin',
      role: AdminAccountRole.Root,
      sessionId: 'session-1',
      status: AdminAccountStatus.Active,
    };
    const context = {
      ip: '127.0.0.1',
      reason: 'Emergency model credential rotation',
      sessionId: 'session-1',
      userAgent: 'Safari',
    };

    await expect(
      service.enablePlatformGlobalRestriction(
        actor,
        PlatformGlobalRestrictionCapability.DisableAiGeneration,
        {
          ...context,
          expiresAt: null,
          internalNote: 'OpenAI credential compromise reported by provider.',
        },
      ),
    ).resolves.toMatchObject({
      active: true,
      capability: PlatformGlobalRestrictionCapability.DisableAiGeneration,
    });
    await expect(
      service.disablePlatformGlobalRestriction(
        actor,
        PlatformGlobalRestrictionCapability.DisableAiGeneration,
        {
          ...context,
          reason: 'Credential rotation completed and verified',
        },
      ),
    ).resolves.toMatchObject({
      active: false,
      capability: PlatformGlobalRestrictionCapability.DisableAiGeneration,
    });

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(managerQuery.mock.calls[0]?.[0]).toContain('pg_advisory_xact_lock');
    expect(managerQuery.mock.calls[3]?.[0]).toContain('pg_advisory_xact_lock');
    expect(managerQuery.mock.calls[2]?.[0]).toContain(
      'INSERT INTO platform_global_restrictions',
    );
    expect(String(managerQuery.mock.calls[2]?.[1]?.[3])).toContain(
      'ritora:v1:',
    );
    expect(managerQuery.mock.calls[4]?.[0]).toContain(
      'UPDATE platform_global_restrictions',
    );
    expect(auditLogsRepository.save).toHaveBeenCalledTimes(2);
    expect(auditLogsRepository.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: AdminAuditAction.PlatformGlobalRestrictionEnabled,
        metadata: expect.objectContaining({
          capability: PlatformGlobalRestrictionCapability.DisableAiGeneration,
        }),
        target_admin_id: null,
        target_user_id: null,
      }),
    );
    expect(JSON.stringify(auditLogsRepository.create.mock.calls)).not.toContain(
      'OpenAI credential compromise',
    );
  });

  it('does not surface expired account restrictions as active controls', async () => {
    const query = jest.fn().mockResolvedValueOnce([
      {
        account_deletion_scheduled_for: null,
        account_restricted_at: '2026-05-20T09:00:00.000Z',
        account_restricted_by_admin_id: 'admin-root',
        account_restriction_capabilities: [
          UserRestrictionCapability.DisableLogin,
        ],
        account_restriction_expires_at: '2026-05-20T10:00:00.000Z',
        account_restriction_reason: 'Expired fraud review',
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

    const result = await service.listUsers();

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('WITH expired_user_restrictions AS');
    expect(sql).toContain('UPDATE users');
    expect(result.users[0]).toMatchObject({
      accountStatus: 'active',
      restrictedAt: null,
      restrictedByAdminId: null,
      restrictionCapabilities: [],
      restrictionExpiresAt: null,
      restrictionReason: null,
    });
  });

  it('returns a deeper user detail without exposing encrypted profile fields', async () => {
    const encryptedInternalNote = restrictionInternalNoteTransformer.to(
      'Observed repeated automated AI generation.',
    );
    const encryptedUserMessage = restrictionUserMessageTransformer.to(
      'Some account actions are temporarily unavailable.',
    );
    const query = jest
      .fn<Promise<Array<Record<string, unknown>>>, [string, unknown[]?]>()
      .mockResolvedValueOnce([
        {
          account_deletion_scheduled_for: null,
          account_restricted_at: '2026-05-20T09:00:00.000Z',
          account_restricted_by_admin_id: 'admin-root',
          account_restriction_capabilities: [
            UserRestrictionCapability.DisableAiGeneration,
          ],
          account_restriction_expires_at: '2099-06-20T09:00:00.000Z',
          account_restriction_internal_note: encryptedInternalNote,
          account_restriction_reason: 'Suspicious automated activity',
          account_restriction_user_message: encryptedUserMessage,
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

    const detailSql = String(query.mock.calls[0]?.[0]);
    expect(detailSql).toContain('WITH expired_user_restrictions AS');
    expect(detailSql).toContain('WHERE id = $1');
    expect(detailSql).toContain('account_restriction_expires_at <= now()');
    expect(detailSql).toContain("event_type = 'data_accessed'");
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
    expect(result.restrictionInternalNote).toBe(
      'Observed repeated automated AI generation.',
    );
    expect(result.restrictionUserMessage).toBe(
      'Some account actions are temporarily unavailable.',
    );
    expect(result.recentAuditLogs).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(String(encryptedInternalNote));
    expect(JSON.stringify(result)).not.toContain(String(encryptedUserMessage));
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

  it('lists internal user notes with pagination and author context', async () => {
    const note = {
      author_admin_id: 'admin-root',
      body: 'Escalated to support after repeated failed exports.',
      created_at: new Date('2026-05-21T09:00:00.000Z'),
      id: 'note-1',
      updated_at: new Date('2026-05-21T09:00:00.000Z'),
      user_id: '01USER',
    } as AdminUserNote;
    const findAndCount = jest.fn(async () => [[note], 12]);
    const query = jest
      .fn<Promise<Array<Record<string, unknown>>>, [string, unknown[]?]>()
      .mockResolvedValueOnce([{ id: '01USER' }])
      .mockResolvedValueOnce([
        {
          email: 'owner@ritora.app',
          id: 'admin-root',
          name: 'Root Admin',
        },
      ]);
    const service = new AdminService(
      createAdminDataSourceMock({
        notesRepository: { findAndCount },
        query,
      }),
    );

    const result = await service.listUserNotes('01USER', {
      limit: 5,
      page: 2,
    });

    expect(findAndCount).toHaveBeenCalledWith({
      order: { created_at: 'DESC', id: 'DESC' },
      skip: 5,
      take: 5,
      where: { user_id: '01USER' },
    });
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('FROM admin_accounts'),
      [['admin-root']],
    );
    expect(result).toEqual({
      hasNextPage: true,
      hasPreviousPage: true,
      limit: 5,
      notes: [
        {
          author: {
            email: 'owner@ritora.app',
            id: 'admin-root',
            name: 'Root Admin',
          },
          authorAdminId: 'admin-root',
          body: 'Escalated to support after repeated failed exports.',
          createdAt: '2026-05-21T09:00:00.000Z',
          id: 'note-1',
          updatedAt: '2026-05-21T09:00:00.000Z',
          userId: '01USER',
        },
      ],
      page: 2,
      total: 12,
      totalPages: 3,
    });
  });

  it('creates an encrypted internal user note and audits without leaking note body', async () => {
    const user = fakeUser();
    const savedNote = {
      author_admin_id: 'admin-root',
      body: 'Customer reported account export trouble.',
      created_at: new Date('2026-05-21T09:00:00.000Z'),
      id: 'note-1',
      updated_at: new Date('2026-05-21T09:00:00.000Z'),
      user_id: '01USER',
    } as AdminUserNote;
    const noteCreate = jest.fn(
      (value: Partial<AdminUserNote>) => value as AdminUserNote,
    );
    const noteSave = jest.fn(async () => savedNote);
    const auditCreate = jest.fn(
      (value: Partial<AdminAuditLog>) => value as AdminAuditLog,
    );
    const auditSave = jest.fn(async (value: AdminAuditLog) => value);
    const dataSource = createAdminDataSourceMock({
      auditLogsRepository: { create: auditCreate, save: auditSave },
      notesRepository: { create: noteCreate, save: noteSave },
      usersRepository: {
        findOne: jest.fn(async () => user),
      },
    });
    const service = new AdminService(dataSource);

    const result = await service.createUserNote(
      {
        email: 'owner@ritora.app',
        id: 'admin-root',
        name: 'Root Admin',
        role: AdminAccountRole.Root,
        sessionId: 'admin-session',
        status: AdminAccountStatus.Active,
      },
      '01USER',
      { body: '  Customer reported account export trouble.  ' },
      {
        ip: '127.0.0.1',
        sessionId: 'admin-session',
        userAgent: 'Jest',
      },
    );

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(noteCreate).toHaveBeenCalledWith({
      author_admin_id: 'admin-root',
      body: 'Customer reported account export trouble.',
      user_id: '01USER',
    });
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AdminAuditAction.UserNoteCreated,
        actor_admin_id: 'admin-root',
        actor_session_id: 'admin-session',
        metadata: {
          noteId: 'note-1',
          userEmail: 'jane@example.com',
        },
        reason: 'Internal account note added',
        target_user_id: '01USER',
      }),
    );
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain(
      'Customer reported account export trouble',
    );
    expect(result).toMatchObject({
      author: {
        email: 'owner@ritora.app',
        id: 'admin-root',
        name: 'Root Admin',
      },
      body: 'Customer reported account export trouble.',
      id: 'note-1',
      userId: '01USER',
    });
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
      monitoringFlagId: 'flag-1',
      page: 1,
      query: 'ops_%',
      targetAdminId: 'admin-ops',
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WITH filtered_logs AS'),
      expect.arrayContaining([
        AdminAuditAction.AdminInvited,
        'admin-ops',
        'flag-1',
        '%ops\\_\\%%',
        25,
        0,
      ]),
    );
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('LEFT JOIN users target_user');
    expect(sql).toContain("logs.metadata ->> 'monitoringFlagId'");
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

  it('lists account monitoring flags with status, signal, search, and owner context', async () => {
    const query = jest.fn().mockResolvedValueOnce([
      {
        assigned_admin_email: 'ops@ritora.app',
        assigned_admin_id: 'admin-ops',
        assigned_admin_name: 'Ops Lead',
        audit_log_count: '2',
        created_at: '2026-05-21T09:00:00.000Z',
        created_by_admin_email: 'owner@ritora.app',
        created_by_admin_id: 'admin-root',
        created_by_admin_name: 'Root Admin',
        id: 'flag-1',
        internal_note: encryptedAccountMonitoringInternalNoteTransformer.to(
          'Review AI cost trend before taking action.',
        ),
        latest_signal: encryptedAccountMonitoringLatestSignalTransformer.to(
          'AI spend crossed the daily review threshold.',
        ),
        next_review_at: '2099-05-22T09:00:00.000Z',
        resolution_note: encryptedAccountMonitoringResolutionNoteTransformer.to(
          'Cost returned to normal after review.',
        ),
        resolved_at: null,
        resolved_by_admin_email: null,
        resolved_by_admin_id: null,
        resolved_by_admin_name: null,
        severity: AdminAccountMonitoringSeverity.Warning,
        signal_type: AdminAccountMonitoringSignalType.HighAiCost,
        status: AdminAccountMonitoringStatus.Watching,
        summary: 'High AI spend spike',
        total_count: '1',
        updated_at: '2026-05-21T09:05:00.000Z',
        user_email: 'jane@example.com',
        user_id: '01USER',
        user_name: 'Jane Doe',
      },
    ]);
    const service = new AdminService(createAdminDataSourceMock({ query }));

    const result = await service.listAccountMonitoringFlags({
      assignedAdminId: 'admin-ops',
      limit: 10,
      page: 1,
      query: 'jane_%',
      signalType: AdminAccountMonitoringSignalType.HighAiCost,
      status: AdminAccountMonitoringStatusFilter.Watching,
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WITH filtered_flags AS'),
      expect.arrayContaining([
        AdminAccountMonitoringStatus.Watching,
        AdminAccountMonitoringSignalType.HighAiCost,
        'admin-ops',
        '%jane\\_\\%%',
        10,
        0,
      ]),
    );
    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('JOIN users ON users.id = flags.user_id');
    expect(sql).toContain("ESCAPE '\\'");
    expect(sql).toContain('ORDER BY');
    expect(result).toEqual({
      flags: [
        expect.objectContaining({
          assignedAdmin: {
            email: 'ops@ritora.app',
            id: 'admin-ops',
            name: 'Ops Lead',
          },
          auditLogCount: 2,
          internalNote: 'Review AI cost trend before taking action.',
          latestSignal: 'AI spend crossed the daily review threshold.',
          resolutionNote: 'Cost returned to normal after review.',
          signalType: AdminAccountMonitoringSignalType.HighAiCost,
          status: AdminAccountMonitoringStatus.Watching,
          user: {
            email: 'jane@example.com',
            id: '01USER',
            name: 'Jane Doe',
          },
        }),
      ],
      hasNextPage: false,
      hasPreviousPage: false,
      limit: 10,
      page: 1,
      total: 1,
      totalPages: 1,
    });
    expect(JSON.stringify(result)).not.toContain('password');
  });

  it('creates account monitoring flags with duplicate protection and audited metadata only', async () => {
    const savedFlag = fakeMonitoringFlag({
      assigned_admin_id: 'admin-ops',
      created_by_admin_id: 'admin-ops',
      id: 'flag-1',
    });
    const monitoringCreate = jest.fn(
      (value: Partial<AdminAccountMonitoringFlag>) =>
        value as AdminAccountMonitoringFlag,
    );
    const monitoringSave = jest.fn(async () => savedFlag);
    const auditCreate = jest.fn(
      (value: Partial<AdminAuditLog>) => value as AdminAuditLog,
    );
    const service = new AdminService(
      createAdminDataSourceMock({
        auditLogsRepository: { create: auditCreate },
        monitoringRepository: {
          create: monitoringCreate,
          findOne: jest.fn(async () => null),
          save: monitoringSave,
        },
        usersRepository: {
          findOne: jest.fn(async () => fakeUser()),
        },
      }),
    );
    const actor = {
      email: 'ops@ritora.app',
      id: 'admin-ops',
      name: 'Ops Lead',
      role: AdminAccountRole.Admin,
      sessionId: 'admin-session',
      status: AdminAccountStatus.Active,
    };

    const result = await service.createAccountMonitoringFlag(
      actor,
      {
        internalNote: 'Review AI cost trend before taking action.',
        latestSignal: 'AI spend crossed the daily review threshold.',
        reason: 'AI cost spike needs manual review',
        severity: AdminAccountMonitoringSeverity.Warning,
        signalType: AdminAccountMonitoringSignalType.HighAiCost,
        summary: 'High AI spend spike',
        userIdentifier: 'jane@example.com',
      },
      { ip: '127.0.0.1', sessionId: 'admin-session', userAgent: 'Jest' },
    );

    expect(monitoringCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        assigned_admin_id: 'admin-ops',
        created_by_admin_id: 'admin-ops',
        internal_note: 'Review AI cost trend before taking action.',
        latest_signal: 'AI spend crossed the daily review threshold.',
        severity: AdminAccountMonitoringSeverity.Warning,
        signal_type: AdminAccountMonitoringSignalType.HighAiCost,
        status: AdminAccountMonitoringStatus.Open,
        summary: 'High AI spend spike',
        user_id: '01USER',
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AdminAuditAction.AccountMonitoringFlagCreated,
        actor_admin_id: 'admin-ops',
        metadata: {
          monitoringFlagId: 'flag-1',
          nextReviewAt: null,
          severity: AdminAccountMonitoringSeverity.Warning,
          signalType: AdminAccountMonitoringSignalType.HighAiCost,
          status: AdminAccountMonitoringStatus.Open,
        },
        reason: 'AI cost spike needs manual review',
        target_user_id: '01USER',
      }),
    );
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain(
      'Review AI cost trend before taking action',
    );
    expect(result).toMatchObject({
      assignedAdmin: {
        email: 'ops@ritora.app',
        id: 'admin-ops',
        name: 'Ops Lead',
      },
      id: 'flag-1',
      signalType: AdminAccountMonitoringSignalType.HighAiCost,
      user: {
        email: 'jane@example.com',
        id: '01USER',
        name: 'Jane Doe',
      },
    });
  });

  it('updates and resolves account monitoring flags with audited state transitions', async () => {
    const openFlag = fakeMonitoringFlag();
    const updatedFlag = fakeMonitoringFlag({
      status: AdminAccountMonitoringStatus.Watching,
    });
    const resolvedFlag = fakeMonitoringFlag({
      resolution_note: 'Cost returned to expected usage after review.',
      resolved_at: new Date('2026-05-21T10:00:00.000Z'),
      resolved_by_admin_id: 'admin-ops',
      status: AdminAccountMonitoringStatus.Resolved,
    });
    const monitoringFindOne = jest
      .fn()
      .mockResolvedValueOnce(openFlag)
      .mockResolvedValueOnce(updatedFlag);
    const monitoringSave = jest
      .fn()
      .mockResolvedValueOnce(updatedFlag)
      .mockResolvedValueOnce(resolvedFlag);
    const auditCreate = jest.fn(
      (value: Partial<AdminAuditLog>) => value as AdminAuditLog,
    );
    const query = jest
      .fn<Promise<Array<Record<string, unknown>>>, [string, unknown[]?]>()
      .mockResolvedValue([
        { email: 'ops@ritora.app', id: 'admin-ops', name: 'Ops Lead' },
      ]);
    const service = new AdminService(
      createAdminDataSourceMock({
        auditLogsRepository: { create: auditCreate },
        monitoringRepository: {
          findOne: monitoringFindOne,
          save: monitoringSave,
        },
        query,
        usersRepository: {
          findOne: jest.fn(async () => fakeUser()),
        },
      }),
    );
    const actor = {
      email: 'ops@ritora.app',
      id: 'admin-ops',
      name: 'Ops Lead',
      role: AdminAccountRole.Admin,
      sessionId: 'admin-session',
      status: AdminAccountStatus.Active,
    };

    await service.updateAccountMonitoringFlag(
      actor,
      'flag-1',
      {
        reason: 'Account is under active review',
        status: AdminAccountMonitoringStatus.Watching,
      },
      { ip: '127.0.0.1', sessionId: 'admin-session', userAgent: 'Jest' },
    );
    const resolved = await service.resolveAccountMonitoringFlag(
      actor,
      'flag-1',
      {
        reason: 'Manual review cleared account',
        resolutionNote: 'Cost returned to expected usage after review.',
      },
      { ip: '127.0.0.1', sessionId: 'admin-session', userAgent: 'Jest' },
    );

    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AdminAuditAction.AccountMonitoringFlagUpdated,
        metadata: expect.objectContaining({
          monitoringFlagId: 'flag-1',
          status: AdminAccountMonitoringStatus.Watching,
        }),
        reason: 'Account is under active review',
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AdminAuditAction.AccountMonitoringFlagResolved,
        metadata: {
          monitoringFlagId: 'flag-1',
          signalType: AdminAccountMonitoringSignalType.HighAiCost,
          status: AdminAccountMonitoringStatus.Resolved,
        },
        reason: 'Manual review cleared account',
      }),
    );
    expect(resolved.status).toBe(AdminAccountMonitoringStatus.Resolved);
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain(
      'Cost returned to expected usage after review',
    );
  });

  it('updates account monitoring thresholds with audit coverage', async () => {
    const auditCreate = jest.fn(
      (value: Partial<AdminAuditLog>) => value as AdminAuditLog,
    );
    const settingsSave = jest.fn(
      async (value: AdminAccountMonitoringSettings) => ({
        ...value,
        created_at: new Date('2026-05-22T09:00:00.000Z'),
        updated_at: new Date('2026-05-22T09:10:00.000Z'),
      }),
    );
    const service = new AdminService(
      createAdminDataSourceMock({
        auditLogsRepository: { create: auditCreate },
        monitoringSettingsRepository: {
          findOne: jest.fn(async () => null),
          save: settingsSave,
        },
      }),
    );
    const actor = {
      email: 'ops@ritora.app',
      id: 'admin-ops',
      name: 'Ops Lead',
      role: AdminAccountRole.Admin,
      sessionId: 'admin-session',
      status: AdminAccountStatus.Active,
    };

    const result = await service.updateAccountMonitoringSettings(
      actor,
      {
        reason: 'Tune monitoring thresholds after launch traffic review',
        thresholds: {
          aiCost24hCriticalUsd: 6,
          aiCost24hWarningUsd: 3,
          aiGenerations24hCritical: 40,
          aiGenerations24hWarning: 45,
          authFailures24hWarning: 9,
          deletionEvents30dWarning: 4,
          mediaCleanupAttempts24hWarning: 7,
          mediaCleanupFailures24hWarning: 4,
          passwordResets24hWarning: 6,
          productExtractions24hWarning: 22,
          safetyReactionSignals7dWarning: 4,
          unknownAuthFailures24hCritical: 12,
          unknownAuthFailures24hWarning: 10,
          uploadFailures24hWarning: 6,
        },
      },
      {
        ip: '127.0.0.1',
        sessionId: 'admin-session',
        userAgent: 'Jest',
      },
    );

    expect(settingsSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: ADMIN_ACCOUNT_MONITORING_SETTINGS_ID,
        thresholds: expect.objectContaining({
          aiGenerations24hCritical: 45,
          aiGenerations24hWarning: 45,
          unknownAuthFailures24hCritical: 12,
        }),
        updated_by_admin_id: 'admin-ops',
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AdminAuditAction.AccountMonitoringSettingsUpdated,
        metadata: expect.objectContaining({
          thresholds: expect.objectContaining({
            aiCost24hWarningUsd: 3,
            uploadFailures24hWarning: 6,
          }),
        }),
        reason: 'Tune monitoring thresholds after launch traffic review',
        target_user_id: null,
      }),
    );
    expect(result).toMatchObject({
      thresholds: expect.objectContaining({
        aiGenerations24hCritical: 45,
        aiGenerations24hWarning: 45,
      }),
      updatedByAdminId: 'admin-ops',
    });
  });

  it('runs automated account monitoring scan across documented candidate sources', async () => {
    const auditCreate = jest.fn(
      (value: Partial<AdminAuditLog>) => value as AdminAuditLog,
    );
    const monitoringSave = jest.fn(
      async (value: AdminAccountMonitoringFlag) =>
        ({
          ...value,
          created_at: new Date('2026-05-22T09:00:00.000Z'),
          id: 'flag-auto-1',
          updated_at: new Date('2026-05-22T09:00:00.000Z'),
        }) as AdminAccountMonitoringFlag,
    );
    const incidentSave = jest.fn(
      async (value: AdminOperationalIncident) =>
        ({
          ...value,
          created_at: new Date('2026-05-22T09:00:00.000Z'),
          id: 'incident-auto-1',
          updated_at: new Date('2026-05-22T09:00:00.000Z'),
        }) as AdminOperationalIncident,
    );
    const query = jest
      .fn<Promise<Array<Record<string, unknown>>>, [string, unknown[]?]>()
      .mockResolvedValueOnce([
        {
          cost_usd: '2.75',
          event_count: '31',
          latest_at: '2026-05-22T08:50:00.000Z',
          reason_code: 'ai_usage_threshold',
          severity: AdminAccountMonitoringSeverity.Warning,
          signal_type: AdminAccountMonitoringSignalType.HighAiCost,
          user_email: 'jane@example.com',
          user_id: '01USER',
          user_name: 'Jane Doe',
        },
      ])
      .mockResolvedValueOnce([
        {
          event_count: '12',
          latest_at: '2026-05-22T08:55:00.000Z',
          source_hash: 'abcdef1234567890abcdef1234567890abcdef1234567890',
          source_kind: 'login_ip',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { email: 'ops@ritora.app', id: 'admin-ops', name: 'Ops Lead' },
      ]);
    const service = new AdminService(
      createAdminDataSourceMock({
        auditLogsRepository: { create: auditCreate },
        incidentsRepository: {
          find: jest.fn(async () => []),
          save: incidentSave,
        },
        monitoringRepository: {
          find: jest.fn(async () => []),
          save: monitoringSave,
        },
        query,
      }),
    );
    const actor = {
      email: 'ops@ritora.app',
      id: 'admin-ops',
      name: 'Ops Lead',
      role: AdminAccountRole.Admin,
      sessionId: 'admin-session',
      status: AdminAccountStatus.Active,
    };

    const result = await service.runAccountMonitoringAutomatedScan(actor, {
      ip: '127.0.0.1',
      sessionId: 'admin-session',
      userAgent: 'Jest',
    });

    const userSignalSql = String(query.mock.calls[0]?.[0]);
    const platformSignalSql = String(query.mock.calls[1]?.[0]);
    expect(userSignalSql).toContain('skin_journal_entries');
    expect(userSignalSql).toContain('analysis_started_at >= $1');
    expect(userSignalSql).toContain('skin_journal_insight_generation_runs');
    expect(userSignalSql).toContain('completed_at >= $1');
    expect(userSignalSql).toContain('suggestion_instances');
    expect(userSignalSql).toContain('product_check_ai_review_metrics');
    expect(userSignalSql).toContain('smart_pick_snapshots');
    expect(userSignalSql).toMatch(
      /FROM smart_pick_snapshots\s+WHERE user_id IS NOT NULL AND generated_at >= \$1/,
    );
    expect(userSignalSql).toMatch(
      /FROM suggestion_instances\s+WHERE user_id IS NOT NULL AND generated_at >= \$1/,
    );
    expect(userSignalSql).toContain('smart_pick_generation_jobs');
    expect(userSignalSql).toContain(
      "updated_at >= $1 AND status = 'completed'",
    );
    expect(userSignalSql).toContain('skin_journal_analysis_jobs');
    expect(userSignalSql).toContain('suggestion_generation_jobs');
    expect(userSignalSql).toContain("analysis_status = 'completed'");
    expect(userSignalSql).toContain("generation_status = 'ready'");
    expect(userSignalSql).toContain("status = 'completed'");
    expect(userSignalSql).toContain("status = 'failed'");
    expect(userSignalSql).toContain('COALESCE(ai_estimated_cost_usd, 0)');
    expect(userSignalSql).toContain('account_monitoring_events');
    expect(userSignalSql).toContain("'oauth_login_failed'");
    expect(userSignalSql).toContain("'support_escalation_received'");
    expect(userSignalSql).toContain('GROUP BY user_id, email_hash');
    expect(userSignalSql).toContain('GROUP BY user_id, ip_address_hash');
    expect(userSignalSql).toContain('skin_journal_media_deletion_jobs');
    expect(userSignalSql).toContain('skin_journal_events');
    expect(platformSignalSql).toContain('user_id IS NULL');
    expect(platformSignalSql).toContain("'oauth_login_failed'");
    expect(platformSignalSql).toContain('GROUP BY ip_address_hash');
    expect(monitoringSave).toHaveBeenCalledWith(
      expect.objectContaining({
        assigned_admin_id: 'admin-ops',
        internal_note: expect.stringContaining(
          'Automated monitoring candidate',
        ),
        latest_signal: expect.stringContaining('AI activity crossed'),
        signal_type: AdminAccountMonitoringSignalType.HighAiCost,
        status: AdminAccountMonitoringStatus.Open,
        user_id: '01USER',
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AdminAuditAction.AccountMonitoringFlagCreated,
        metadata: expect.objectContaining({
          automated: true,
          eventCount: 31,
          monitoringFlagId: 'flag-auto-1',
          reasonCode: 'ai_usage_threshold',
        }),
        reason: 'Automated account monitoring threshold crossed',
        target_user_id: '01USER',
      }),
    );
    expect(incidentSave).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining(
          'Unknown-account authentication pressure',
        ),
        source_type: 'account-monitoring:unknown-auth',
        status: AdminOperationalIncidentStatus.Open,
        target_user_id: null,
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AdminAuditAction.OperationalIncidentCreated,
        metadata: expect.objectContaining({
          automated: true,
          eventCount: 12,
          incidentId: 'incident-auto-1',
          sourceType: 'account-monitoring:unknown-auth',
        }),
        target_user_id: null,
      }),
    );
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain(
      'AI activity crossed',
    );
    expect(result).toMatchObject({
      candidates: 1,
      created: 1,
      platformCandidates: 1,
      platformIncidentsCreated: 1,
      platformIncidentsRefreshed: 0,
      refreshed: 0,
      skipped: 0,
      flags: [
        expect.objectContaining({
          id: 'flag-auto-1',
          signalType: AdminAccountMonitoringSignalType.HighAiCost,
          user: {
            email: 'jane@example.com',
            id: '01USER',
            name: 'Jane Doe',
          },
        }),
      ],
    });
  });

  it('records support escalation events and opens a support monitoring flag', async () => {
    const notificationSave = jest.fn(async (value: AdminNotification) => value);
    const monitoringEventSave = jest.fn(
      async (value: AccountMonitoringEvent) => ({
        ...value,
        id: 'event-support-1',
      }),
    );
    const monitoringSave = jest.fn(
      async (value: AdminAccountMonitoringFlag) => ({
        ...fakeMonitoringFlag({
          assigned_admin_id: 'admin-ops',
          id: 'flag-support-1',
          signal_type: AdminAccountMonitoringSignalType.SupportEscalation,
          summary: value.summary,
          user_id: '01USER',
        }),
        ...value,
      }),
    );
    const auditCreate = jest.fn(
      (value: Partial<AdminAuditLog>) => value as AdminAuditLog,
    );
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        { email: 'ops@ritora.app', id: 'admin-ops', name: 'Ops Lead' },
      ]);
    const service = new AdminService(
      createAdminDataSourceMock({
        auditLogsRepository: { create: auditCreate },
        monitoringEventsRepository: { save: monitoringEventSave },
        monitoringRepository: {
          findOne: jest.fn(async () => null),
          save: monitoringSave,
        },
        notificationsRepository: { save: notificationSave },
        query,
        usersRepository: { findOne: jest.fn(async () => fakeUser()) },
      }),
    );
    const actor = {
      email: 'ops@ritora.app',
      id: 'admin-ops',
      name: 'Ops Lead',
      role: AdminAccountRole.Admin,
      sessionId: 'admin-session',
      status: AdminAccountStatus.Active,
    };

    const result = await service.createAccountMonitoringSupportEvent(
      actor,
      {
        internalNote: 'Support reported unusual account behaviour.',
        latestSignal: 'Support ticket SUP-123 reports suspicious activity.',
        reason: 'Support escalation received from protected support queue',
        severity: AdminAccountMonitoringSeverity.Warning,
        summary: 'Support escalation needs review',
        supportReference: 'SUP-123',
        userIdentifier: 'jane@example.com',
      },
      { sessionId: 'admin-session' },
    );

    expect(monitoringEventSave).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'support_escalation_received',
        metadata: expect.objectContaining({
          supportReference: 'SUP-123',
        }),
        user_id: '01USER',
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AdminAuditAction.AccountMonitoringFlagCreated,
        metadata: expect.objectContaining({
          eventId: 'event-support-1',
          supportReference: 'SUP-123',
        }),
      }),
    );
    expect(result).toMatchObject({
      id: 'flag-support-1',
      signalType: AdminAccountMonitoringSignalType.SupportEscalation,
    });
    expect(notificationSave).toHaveBeenCalledWith(
      expect.objectContaining({
        action_url: '/account-monitoring?status=active',
        admin_id: 'admin-ops',
        metadata: expect.objectContaining({ flagId: 'flag-support-1' }),
        type: AdminNotificationType.AccountMonitoringAlert,
      }),
    );
  });

  it('returns a privacy-safe event timeline for a monitoring flag', async () => {
    const flag = fakeMonitoringFlag({
      signal_type: AdminAccountMonitoringSignalType.RepeatedAuthFailures,
    });
    const monitoringEventsRepository = {
      find: jest.fn(async () => [
        {
          event_type: 'oauth_login_failed',
          id: 'event-1',
          metadata: {
            provider: 'google',
            reason: 'invalid_state',
            secret: 'must-not-leak',
          },
          occurred_at: new Date('2026-05-22T09:00:00.000Z'),
          user_id: '01USER',
        } as unknown as AccountMonitoringEvent,
      ]),
    };
    const query = jest.fn(async () => []);
    const service = new AdminService(
      createAdminDataSourceMock({
        monitoringEventsRepository,
        monitoringRepository: { findOne: jest.fn(async () => flag) },
        query,
      }),
    );

    const result = await service.getAccountMonitoringEventTimeline('flag-1');

    expect(monitoringEventsRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 20,
        where: expect.objectContaining({
          event_type: expect.any(Object),
          user_id: '01USER',
        }),
      }),
    );
    expect(JSON.stringify(result)).toContain('oauth_login_failed');
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  it('includes all AI cost sources in high cost monitoring timelines', async () => {
    const flag = fakeMonitoringFlag({
      signal_type: AdminAccountMonitoringSignalType.HighAiCost,
    });
    const monitoringEventsRepository = {
      find: jest.fn(async () => []),
    };
    const query = jest
      .fn<Promise<Array<Record<string, unknown>>>, [string, unknown[]?]>()
      .mockResolvedValueOnce([
        {
          event_type: 'skin_journal_insight_generation',
          id: 'insight-run-1',
          metadata: {
            costUsd: 0.012,
            secret: 'must-not-leak',
            source: 'skin_journal_insights',
          },
          occurred_at: new Date('2026-05-22T09:10:00.000Z'),
          source_type: 'skin_journal_insight_generation_runs',
          summary: 'Skin Journal insight generation cost was recorded.',
        },
      ]);
    const service = new AdminService(
      createAdminDataSourceMock({
        monitoringEventsRepository,
        monitoringRepository: { findOne: jest.fn(async () => flag) },
        query,
      }),
    );

    const result = await service.getAccountMonitoringEventTimeline('flag-1');
    const sql = query.mock.calls[0]?.[0] ?? '';

    expect(sql).toContain('skin_journal_insight_generation_runs');
    expect(sql).toContain('smart_pick_snapshots');
    expect(result.events).toEqual([
      expect.objectContaining({
        eventType: 'skin_journal_insight_generation',
        metadata: {
          costUsd: 0.012,
          source: 'skin_journal_insights',
        },
      }),
    ]);
  });

  it('aggregates operations monitoring work items without exposing encrypted payloads', async () => {
    const query = jest
      .fn<Promise<Array<Record<string, unknown>>>, [string, unknown[]?]>()
      .mockResolvedValueOnce([
        {
          failed: '0',
          id: 'journal-analysis',
          label: 'Journal analysis',
          oldest_queued_age_seconds: '620',
          queued: '3',
        },
        {
          failed: '1',
          id: 'smart-picks',
          label: 'Smart Picks',
          oldest_queued_age_seconds: null,
          queued: '0',
        },
        {
          failed: '0',
          id: 'suggestions',
          label: 'Daily suggestions',
          oldest_queued_age_seconds: '60',
          queued: '1',
        },
        {
          failed: '1',
          id: 'ingredient-analysis',
          label: 'Ingredient analysis',
          oldest_queued_age_seconds: '420',
          queued: '2',
        },
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
      ])
      .mockResolvedValueOnce([
        {
          error_rate: '0.5',
          p95_latency_ms: '220',
          request_count: '540',
        },
      ])
      .mockResolvedValueOnce([{ ok: 1 }])
      .mockResolvedValueOnce([
        {
          error_rate: '0.25',
          p95_latency_ms: '180',
          request_count: '480',
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
    expect(result.jobHealth).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'ingredient-analysis',
          label: 'Ingredient analysis',
        }),
      ]),
    );
    expect(result.compliance).toEqual({
      failedExportCount: 1,
      pendingDeletionCount: 2,
      sensitiveAccessEvents24h: 3,
    });
    expect(String(query.mock.calls[1]?.[0])).toContain(
      "event_type = 'data_accessed'",
    );
    expect(result.backendHealth).toEqual({
      checkedAt: '2026-05-20T10:00:00.000Z',
      components: expect.arrayContaining([
        expect.objectContaining({
          errorRate: 0.5,
          id: 'api',
          p95LatencyMs: 220,
          requestCount: 540,
          status: AdminJobStatus.Healthy,
          windowMinutes: 15,
        }),
        expect.objectContaining({
          id: 'database',
          status: AdminJobStatus.Healthy,
        }),
        expect.objectContaining({
          errorRate: 0.25,
          id: 'user-api-traffic',
          p95LatencyMs: 180,
          requestCount: 480,
          status: AdminJobStatus.Healthy,
          windowMinutes: 15,
        }),
      ]),
      status: AdminJobStatus.Healthy,
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
    expect(String(query.mock.calls[2]?.[0])).toContain(
      'ingredient_product_analysis_jobs',
    );
    expect(JSON.stringify(result)).not.toContain('payload');
  });

  it('lists operational incidents with pagination and actor context', async () => {
    const incident = {
      created_at: new Date('2026-05-21T08:00:00.000Z'),
      created_by_admin_id: 'admin-root',
      description: encryptedIncidentDescriptionTransformer.to(
        'Journal analysis has failed repeatedly for the user.',
      ),
      id: 'incident-1',
      resolution_summary: null,
      resolved_at: null,
      resolved_by_admin_id: null,
      severity: AdminOperationalIncidentSeverity.Critical,
      source_id: 'job-1',
      source_type: 'journal-analysis',
      status: AdminOperationalIncidentStatus.Open,
      target_user_id: '01USER',
      title: 'Journal analysis failed',
      updated_at: new Date('2026-05-21T08:00:00.000Z'),
    } as AdminOperationalIncident;
    const findAndCount = jest.fn(async () => [[incident], 1]);
    const query = jest
      .fn<Promise<Array<Record<string, unknown>>>, [string, unknown[]?]>()
      .mockResolvedValueOnce([
        { email: 'owner@ritora.app', id: 'admin-root', name: 'Root Admin' },
      ])
      .mockResolvedValueOnce([{ email: 'jane@example.com', id: '01USER' }]);
    const service = new AdminService(
      createAdminDataSourceMock({
        incidentsRepository: { findAndCount },
        query,
      }),
    );

    const result = await service.listOperationalIncidents({
      limit: 10,
      page: 1,
      status: AdminOperationalIncidentStatusFilter.Open,
    });

    expect(findAndCount).toHaveBeenCalledWith({
      order: { created_at: 'DESC', id: 'DESC' },
      skip: 0,
      take: 10,
      where: { status: AdminOperationalIncidentStatus.Open },
    });
    expect(result).toEqual({
      hasNextPage: false,
      hasPreviousPage: false,
      incidents: [
        {
          createdAt: '2026-05-21T08:00:00.000Z',
          createdBy: {
            email: 'owner@ritora.app',
            id: 'admin-root',
            name: 'Root Admin',
          },
          createdByAdminId: 'admin-root',
          description: 'Journal analysis has failed repeatedly for the user.',
          id: 'incident-1',
          resolutionSummary: null,
          resolvedAt: null,
          resolvedBy: null,
          resolvedByAdminId: null,
          severity: AdminOperationalIncidentSeverity.Critical,
          sourceId: 'job-1',
          sourceType: 'journal-analysis',
          status: AdminOperationalIncidentStatus.Open,
          targetUserEmail: 'jane@example.com',
          targetUserId: '01USER',
          title: 'Journal analysis failed',
          updatedAt: '2026-05-21T08:00:00.000Z',
        },
      ],
      limit: 10,
      page: 1,
      total: 1,
      totalPages: 1,
    });
    expect(JSON.stringify(result)).not.toContain('payload');
  });

  it('creates and resolves operational incidents with audited metadata only', async () => {
    const savedIncident = {
      created_by_admin_id: 'admin-root',
      description: 'Journal analysis has failed repeatedly for the user.',
      id: 'incident-1',
      resolution_summary: null,
      resolved_at: null,
      resolved_by_admin_id: null,
      severity: AdminOperationalIncidentSeverity.Critical,
      source_id: 'job-1',
      source_type: 'journal-analysis',
      status: AdminOperationalIncidentStatus.Open,
      target_user_id: '01USER',
      title: 'Journal analysis failed',
    } as AdminOperationalIncident;
    const resolvedIncident = {
      ...savedIncident,
      resolution_summary: encryptedIncidentResolutionTransformer.to(
        'Provider recovered and the queue drained.',
      ),
      resolved_at: new Date('2026-05-21T09:00:00.000Z'),
      resolved_by_admin_id: 'admin-root',
      status: AdminOperationalIncidentStatus.Resolved,
    } as AdminOperationalIncident;
    const incidentCreate = jest.fn(
      (value: Partial<AdminOperationalIncident>) =>
        value as AdminOperationalIncident,
    );
    const incidentSave = jest
      .fn()
      .mockResolvedValueOnce(savedIncident)
      .mockResolvedValueOnce(resolvedIncident);
    const auditCreate = jest.fn(
      (value: Partial<AdminAuditLog>) => value as AdminAuditLog,
    );
    const query = jest
      .fn<Promise<Array<Record<string, unknown>>>, [string, unknown[]?]>()
      .mockResolvedValueOnce([
        { email: 'owner@ritora.app', id: 'admin-root', name: 'Root Admin' },
      ]);
    const service = new AdminService(
      createAdminDataSourceMock({
        auditLogsRepository: { create: auditCreate },
        incidentsRepository: {
          create: incidentCreate,
          findOne: jest
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(savedIncident),
          save: incidentSave,
        },
        usersRepository: {
          findOne: jest.fn(async () => fakeUser()),
        },
        query,
      }),
    );
    const actor = {
      email: 'owner@ritora.app',
      id: 'admin-root',
      name: 'Root Admin',
      role: AdminAccountRole.Root,
      sessionId: 'admin-session',
      status: AdminAccountStatus.Active,
    };

    await service.createOperationalIncident(
      actor,
      {
        description: 'Journal analysis has failed repeatedly for the user.',
        severity: AdminOperationalIncidentSeverity.Critical,
        sourceId: 'job-1',
        sourceType: 'journal-analysis',
        targetUserId: '01USER',
        title: 'Journal analysis failed',
      },
      { ip: '127.0.0.1', sessionId: 'admin-session', userAgent: 'Jest' },
    );
    const resolved = await service.resolveOperationalIncident(
      actor,
      'incident-1',
      { resolutionSummary: 'Provider recovered and the queue drained.' },
      { ip: '127.0.0.1', sessionId: 'admin-session', userAgent: 'Jest' },
    );

    expect(incidentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        created_by_admin_id: 'admin-root',
        description: 'Journal analysis has failed repeatedly for the user.',
        severity: AdminOperationalIncidentSeverity.Critical,
        source_id: 'job-1',
        source_type: 'journal-analysis',
        status: AdminOperationalIncidentStatus.Open,
        target_user_id: '01USER',
        title: 'Journal analysis failed',
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AdminAuditAction.OperationalIncidentCreated,
        metadata: {
          incidentId: 'incident-1',
          severity: AdminOperationalIncidentSeverity.Critical,
          sourceId: 'job-1',
          sourceType: 'journal-analysis',
          title: 'Journal analysis failed',
          userEmail: 'jane@example.com',
        },
        reason: 'Operational incident opened',
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AdminAuditAction.OperationalIncidentResolved,
        metadata: {
          incidentId: 'incident-1',
          sourceId: 'job-1',
          sourceType: 'journal-analysis',
          title: 'Journal analysis failed',
        },
        reason: 'Operational incident resolved',
      }),
    );
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain(
      'Provider recovered and the queue drained.',
    );
    expect(resolved.status).toBe(AdminOperationalIncidentStatus.Resolved);
    expect(resolved.resolutionSummary).toBe(
      'Provider recovered and the queue drained.',
    );
  });

  it('upserts scheduled operational incidents from the monitoring queue', async () => {
    const savedIncident = {
      created_at: new Date('2026-05-22T09:00:00.000Z'),
      created_by_admin_id: 'admin-root',
      description: 'CloudWatch reported elevated media provider failures.',
      id: 'incident-sqs-1',
      resolution_summary: null,
      resolved_at: null,
      resolved_by_admin_id: null,
      severity: AdminOperationalIncidentSeverity.Critical,
      source_id: 'cloudwatch:media-provider-errors',
      source_type: 'aws:cloudwatch-alarm',
      status: AdminOperationalIncidentStatus.Open,
      target_user_id: null,
      title: 'Media provider errors elevated',
      updated_at: new Date('2026-05-22T09:00:00.000Z'),
    } as AdminOperationalIncident;
    const auditCreate = jest.fn(
      (value: Partial<AdminAuditLog>) => value as AdminAuditLog,
    );
    const incidentCreate = jest.fn(
      (value: Partial<AdminOperationalIncident>) =>
        value as AdminOperationalIncident,
    );
    const incidentSave = jest.fn(async () => savedIncident);
    const service = new AdminService(
      createAdminDataSourceMock({
        accountsRepository: {
          findOne: jest.fn(async () => ({
            email: 'owner@ritora.app',
            id: 'admin-root',
            name: 'Root Admin',
            role: AdminAccountRole.Root,
            status: AdminAccountStatus.Active,
          })),
        },
        auditLogsRepository: { create: auditCreate },
        incidentsRepository: {
          create: incidentCreate,
          findOne: jest.fn(async () => null),
          save: incidentSave,
        },
      }),
    );

    const result =
      await service.createScheduledAccountMonitoringOperationalIncident({
        description: 'CloudWatch reported elevated media provider failures.',
        severity: AdminOperationalIncidentSeverity.Critical,
        sourceId: 'cloudwatch:media-provider-errors',
        sourceType: 'aws:cloudwatch-alarm',
        title: 'Media provider errors elevated',
      });

    expect(incidentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        created_by_admin_id: 'admin-root',
        source_id: 'cloudwatch:media-provider-errors',
        source_type: 'aws:cloudwatch-alarm',
        status: AdminOperationalIncidentStatus.Open,
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AdminAuditAction.OperationalIncidentCreated,
        actor_session_id: ACCOUNT_MONITORING_INCIDENT_SESSION_ID,
        metadata: expect.objectContaining({
          automated: true,
          sourceId: 'cloudwatch:media-provider-errors',
          sourceType: 'aws:cloudwatch-alarm',
        }),
      }),
    );
    expect(result).toMatchObject({
      id: 'incident-sqs-1',
      severity: AdminOperationalIncidentSeverity.Critical,
      sourceType: 'aws:cloudwatch-alarm',
    });
  });

  it('resolves incidents created by another admin with complete actor context', async () => {
    const incident = {
      created_at: new Date('2026-05-21T08:00:00.000Z'),
      created_by_admin_id: 'admin-creator',
      description: 'Journal analysis has failed repeatedly for the user.',
      id: 'incident-1',
      resolution_summary: null,
      resolved_at: null,
      resolved_by_admin_id: null,
      severity: AdminOperationalIncidentSeverity.Critical,
      source_id: 'job-1',
      source_type: 'journal-analysis',
      status: AdminOperationalIncidentStatus.Open,
      target_user_id: '01USER',
      title: 'Journal analysis failed',
      updated_at: new Date('2026-05-21T08:00:00.000Z'),
    } as AdminOperationalIncident;
    const query = jest
      .fn<Promise<Array<Record<string, unknown>>>, [string, unknown[]?]>()
      .mockResolvedValueOnce([
        {
          email: 'creator@ritora.app',
          id: 'admin-creator',
          name: 'Creator Admin',
        },
        {
          email: 'resolver@ritora.app',
          id: 'admin-resolver',
          name: 'Resolver Admin',
        },
      ]);
    const service = new AdminService(
      createAdminDataSourceMock({
        incidentsRepository: {
          findOne: jest.fn(async () => incident),
        },
        query,
        usersRepository: {
          findOne: jest.fn(async () => fakeUser()),
        },
      }),
    );

    const result = await service.resolveOperationalIncident(
      {
        email: 'resolver@ritora.app',
        id: 'admin-resolver',
        name: 'Resolver Admin',
        role: AdminAccountRole.Admin,
        sessionId: 'resolver-session',
        status: AdminAccountStatus.Active,
      },
      'incident-1',
      { resolutionSummary: 'Provider recovered and the queue drained.' },
      { ip: '127.0.0.1', sessionId: 'resolver-session', userAgent: 'Jest' },
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM admin_accounts'),
      [['admin-creator', 'admin-resolver']],
    );
    expect(result.createdBy).toEqual({
      email: 'creator@ritora.app',
      id: 'admin-creator',
      name: 'Creator Admin',
    });
    expect(result.resolvedBy).toEqual({
      email: 'resolver@ritora.app',
      id: 'admin-resolver',
      name: 'Resolver Admin',
    });
  });

  it('maps concurrent duplicate operational incident creation to conflict', async () => {
    const incidentCreate = jest.fn(
      (value: Partial<AdminOperationalIncident>) =>
        value as AdminOperationalIncident,
    );
    const incidentSave = jest.fn(async () => {
      throw Object.assign(new Error('duplicate incident'), { code: '23505' });
    });
    const auditCreate = jest.fn(
      (value: Partial<AdminAuditLog>) => value as AdminAuditLog,
    );
    const service = new AdminService(
      createAdminDataSourceMock({
        auditLogsRepository: { create: auditCreate },
        incidentsRepository: {
          create: incidentCreate,
          findOne: jest.fn(async () => null),
          save: incidentSave,
        },
      }),
    );

    await expect(
      service.createOperationalIncident(
        {
          email: 'owner@ritora.app',
          id: 'admin-root',
          name: 'Root Admin',
          role: AdminAccountRole.Root,
          sessionId: 'admin-session',
          status: AdminAccountStatus.Active,
        },
        {
          description: 'Journal analysis has failed repeatedly for the user.',
          severity: AdminOperationalIncidentSeverity.Critical,
          sourceId: 'job-1',
          sourceType: 'journal-analysis',
          title: 'Journal analysis failed',
        },
        { ip: '127.0.0.1', sessionId: 'admin-session', userAgent: 'Jest' },
      ),
    ).rejects.toThrow(ConflictException);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('restricts a user with selected controls, revokes sessions when requested, and writes an admin audit log atomically', async () => {
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
        capabilities: [
          UserRestrictionCapability.DisableAiGeneration,
          UserRestrictionCapability.ForceLogout,
        ],
        expiresAt: '2099-06-20T09:00:00.000Z',
        internalNote:
          'Observed abnormal AI generation volume from this account.',
        ip: '127.0.0.1',
        reason: 'Suspicious automated activity',
        sessionId: 'admin-session',
        userMessage:
          'Some account actions are temporarily unavailable while we review activity.',
        userAgent: 'Jest',
      },
    );

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        account_restricted_at: expect.any(Date),
        account_restricted_by_admin_id: 'admin-root',
        account_restriction_capabilities: [
          UserRestrictionCapability.DisableAiGeneration,
          UserRestrictionCapability.ForceLogout,
        ],
        account_restriction_expires_at: new Date('2099-06-20T09:00:00.000Z'),
        account_restriction_internal_note:
          'Observed abnormal AI generation volume from this account.',
        account_restriction_reason: 'Suspicious automated activity',
        account_restriction_user_message:
          'Some account actions are temporarily unavailable while we review activity.',
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
        metadata: {
          capabilities: [
            UserRestrictionCapability.DisableAiGeneration,
            UserRestrictionCapability.ForceLogout,
          ],
          expiresAt: '2099-06-20T09:00:00.000Z',
          revokedSessions: true,
          userEmail: 'jane@example.com',
        },
        reason: 'Suspicious automated activity',
        target_user_id: '01USER',
      }),
    );
    expect(result.restrictedAt).toEqual(expect.any(String));
    expect(result.restrictionCapabilities).toEqual([
      UserRestrictionCapability.DisableAiGeneration,
      UserRestrictionCapability.ForceLogout,
    ]);
    expect(result.restrictionExpiresAt).toBe('2099-06-20T09:00:00.000Z');
  });

  it('does not revoke sessions for restrictions that keep app access available', async () => {
    const user = fakeUser();
    const sessionUpdate = jest.fn();
    const service = new AdminService(
      createAdminDataSourceMock({
        sessionsRepository: { update: sessionUpdate },
        usersRepository: {
          findOne: jest.fn(async () => user),
        },
      }),
    );

    await service.restrictUser(
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
        capabilities: [UserRestrictionCapability.DisableNotifications],
        internalNote: 'Notifications are paused during support review.',
        ip: '127.0.0.1',
        reason: 'Notification abuse review',
        sessionId: 'admin-session',
        userAgent: 'Jest',
      },
    );

    expect(sessionUpdate).not.toHaveBeenCalled();
  });

  it('unrestricts a user and keeps an audit trail', async () => {
    const user = fakeUser({
      account_restricted_at: new Date('2026-05-20T09:00:00.000Z'),
      account_restricted_by_admin_id: 'admin-root',
      account_restriction_capabilities: [
        UserRestrictionCapability.DisableLogin,
      ],
      account_restriction_expires_at: new Date('2099-06-20T09:00:00.000Z'),
      account_restriction_internal_note: 'Manual review note.',
      account_restriction_reason: 'Suspicious automated activity',
      account_restriction_user_message: 'Account is being reviewed.',
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
        account_restriction_capabilities: null,
        account_restriction_expires_at: null,
        account_restriction_internal_note: null,
        account_restriction_reason: null,
        account_restriction_user_message: null,
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

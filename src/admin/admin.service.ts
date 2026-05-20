import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { AuthSession } from '../auth/entities/auth-session.entity';
import {
  sanitizeIpAddress,
  sanitizeUserAgent,
} from '../auth/auth-session.utils';
import { toIsoString, toNullableIsoString } from '../common/utils/date';
import {
  AnalysisJobStatusValue,
  AnalysisStatusValue,
  ExportStatusValue,
} from '../skin-journal/skin-journal.constants';
import { SmartPicksGenerationJobStatus } from '../smart-picks/smart-picks.types';
import {
  SuggestionGenerationJobStatus,
  SuggestionGenerationStatus,
} from '../suggestions/suggestions.constants';
import { User } from '../users/entities/user.entity';
import {
  AdminAlertSeverity,
  type AdminAuditLogResponse,
  type AdminAuditLogListResponse,
  type AdminAuditLogQuery,
  AdminJobStatus,
  type AdminOperationsMonitoringResponse,
  type AdminOperationalWorkItemResponse,
  AdminPermission,
  type AdminAuthenticatedUser,
  type AdminMemberResponse,
  type AdminOverviewResponse,
  type AdminUserDetailResponse,
  type AdminUserListQuery,
  type AdminUserListResponse,
  type AdminUserResponse,
  AdminUserRestrictionFilter,
} from './admin.types';
import { buildPaginationMeta, normalizePagination } from './admin-pagination';
import {
  AdminAccount,
  AdminAccountRole,
  AdminAccountStatus,
} from './entities/admin-account.entity';
import {
  AdminAuditAction,
  AdminAuditLog,
} from './entities/admin-audit-log.entity';

type QueryRow = Record<string, unknown>;

type AdminUserAuditContext = {
  ip?: string;
  reason: string;
  sessionId: string;
  userAgent?: string;
};

type AdminUserMutationRepositories = {
  auditLogsRepository: Repository<AdminAuditLog>;
  sessionsRepository: Repository<AuthSession>;
  usersRepository: Repository<User>;
};

type JobHealthConfig = {
  activeStatuses: readonly string[];
  failedStatus: string;
  id: string;
  label: string;
  tableName: string;
};

const ADMIN_ROOT_PERMISSIONS = [
  AdminPermission.MetricsRead,
  AdminPermission.UsersRead,
  AdminPermission.UsersRestrict,
  AdminPermission.JobsWrite,
  AdminPermission.AuditRead,
] as const;

const ADMIN_STAFF_PERMISSIONS = [
  AdminPermission.MetricsRead,
  AdminPermission.UsersRead,
  AdminPermission.UsersRestrict,
  AdminPermission.JobsWrite,
  AdminPermission.AuditRead,
] as const;
const ADMIN_AUDIT_LOGS_DEFAULT_LIMIT = 25;
const ADMIN_AUDIT_LOGS_MAX_LIMIT = 100;
const ADMIN_AUDIT_LOG_SEARCH_MAX_LENGTH = 100;
const ADMIN_USERS_DEFAULT_LIMIT = 25;
const ADMIN_USERS_MAX_LIMIT = 100;
const ADMIN_USER_DETAIL_AUDIT_LIMIT = 5;
const ADMIN_OPERATIONS_WORK_ITEM_LIMIT = 20;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const JOB_WARNING_AGE_SECONDS = 5 * 60;
const JOB_CRITICAL_AGE_SECONDS = 10 * 60;
const JOB_WARNING_QUEUE_COUNT = 10;
const ADMIN_USER_SEARCH_MAX_LENGTH = 100;

const JOB_HEALTH_CONFIGS: readonly JobHealthConfig[] = [
  {
    activeStatuses: [
      AnalysisJobStatusValue.Queued,
      AnalysisJobStatusValue.Sent,
      AnalysisJobStatusValue.Running,
    ],
    failedStatus: AnalysisJobStatusValue.Failed,
    id: 'journal-analysis',
    label: 'Journal analysis',
    tableName: 'skin_journal_analysis_jobs',
  },
  {
    activeStatuses: [
      SmartPicksGenerationJobStatus.Queued,
      SmartPicksGenerationJobStatus.Sent,
      SmartPicksGenerationJobStatus.Running,
    ],
    failedStatus: SmartPicksGenerationJobStatus.Failed,
    id: 'smart-picks',
    label: 'Smart Picks',
    tableName: 'smart_pick_generation_jobs',
  },
  {
    activeStatuses: [
      SuggestionGenerationJobStatus.Queued,
      SuggestionGenerationJobStatus.Running,
    ],
    failedStatus: SuggestionGenerationJobStatus.Failed,
    id: 'suggestions',
    label: 'Daily suggestions',
    tableName: 'suggestion_generation_jobs',
  },
];

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return toNumber(value);
}

function toNullableIso(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'string' && value.trim()) {
    return new Date(value).toISOString();
  }

  return null;
}

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toNullableString(value: unknown): string | null {
  const text = toStringValue(value).trim();
  return text || null;
}

function toBooleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  return value === 'true';
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function normalizeSearch(
  value: string | undefined,
  maxLength = ADMIN_USER_SEARCH_MAX_LENGTH,
): string | null {
  const search = value?.trim().replace(/\s+/g, ' ').slice(0, maxLength);
  return search && search.length > 0 ? search : null;
}

function isQueryRow(value: unknown): value is QueryRow {
  return typeof value === 'object' && value !== null;
}

function toQueryRows(value: unknown): QueryRow[] {
  return Array.isArray(value) ? value.filter(isQueryRow) : [];
}

function toMetadata(value: unknown): Record<string, unknown> | null {
  return isQueryRow(value) && !Array.isArray(value) ? value : null;
}

function percentage(part: number, total: number): number {
  if (total <= 0) {
    return 0;
  }

  return Math.round((part / total) * 100);
}

function monthStart(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0),
  );
}

function resolveJobStatus(
  queued: number,
  failed: number,
  oldestQueuedAgeSeconds: number | null,
): AdminJobStatus {
  if (
    failed > 0 ||
    (oldestQueuedAgeSeconds !== null &&
      oldestQueuedAgeSeconds >= JOB_CRITICAL_AGE_SECONDS)
  ) {
    return AdminJobStatus.Critical;
  }

  if (
    queued >= JOB_WARNING_QUEUE_COUNT ||
    (oldestQueuedAgeSeconds !== null &&
      oldestQueuedAgeSeconds >= JOB_WARNING_AGE_SECONDS)
  ) {
    return AdminJobStatus.Warning;
  }

  return AdminJobStatus.Healthy;
}

@Injectable()
export class AdminService {
  constructor(private readonly dataSource: DataSource) {}

  getCurrentAdmin(
    user: AdminAuthenticatedUser | AdminAccount,
  ): AdminMemberResponse {
    return {
      acceptedAt:
        'accepted_at' in user ? toNullableIsoString(user.accepted_at) : null,
      createdAt:
        'created_at' in user
          ? toIsoString(user.created_at)
          : toIsoString(new Date()),
      createdByAdminId:
        'created_by_admin_id' in user ? user.created_by_admin_id : null,
      email: user.email,
      id: user.id,
      invitedAt:
        'created_at' in user && user.status === AdminAccountStatus.Invited
          ? toIsoString(user.created_at)
          : null,
      lastLoginAt:
        'last_login_at' in user
          ? toNullableIsoString(user.last_login_at)
          : null,
      name: user.name,
      permissions:
        user.role === AdminAccountRole.Root
          ? [...ADMIN_ROOT_PERMISSIONS]
          : [...ADMIN_STAFF_PERMISSIONS],
      role: user.role,
      roles: [user.role],
      status: user.status,
    };
  }

  async getOverview(now = new Date()): Promise<AdminOverviewResponse> {
    const sinceWeek = new Date(now.getTime() - WEEK_MS);
    const sinceDay = new Date(now.getTime() - DAY_MS);
    const sinceMonth = monthStart(now);
    const metricsRow = await this.queryOne(
      `
        SELECT
          (SELECT COUNT(*) FROM users)::int AS registered_users,
          (SELECT COUNT(*) FROM users WHERE email_verified = true)::int AS verified_users,
          (
            SELECT COUNT(DISTINCT user_id)
            FROM auth_sessions
            WHERE revoked_at IS NULL AND last_used_at >= $1
          )::int AS weekly_active_users,
          (SELECT COUNT(*) FROM skin_profiles)::int AS skin_profile_users,
          (
            SELECT COUNT(DISTINCT user_id)
            FROM suggestion_instances
            WHERE generation_status = $4
          )::int AS routine_users,
          (
            SELECT COUNT(DISTINCT user_id)
            FROM skin_journal_entries
            WHERE created_at >= $1
          )::int AS weekly_checkin_users,
          (
            SELECT COUNT(DISTINCT user_id)
            FROM suggestion_instances
          )::int AS suggestion_users,
          (
            SELECT COUNT(DISTINCT user_id)
            FROM skin_journal_entries
          )::int AS journal_users,
          (
            SELECT COUNT(*)
            FROM users
            WHERE account_deletion_scheduled_for IS NOT NULL
          )::int AS pending_deletion_count,
          (
            SELECT COUNT(*)
            FROM users
            WHERE account_restricted_at IS NOT NULL
          )::int AS active_restrictions,
          (
            SELECT COUNT(*)
            FROM skin_journal_export_jobs
            WHERE status = $5
          )::int AS failed_export_count,
          (
            SELECT COUNT(*)
            FROM user_data_access_logs
            WHERE created_at >= $2
          )::int AS sensitive_access_events_24h,
          (
            SELECT COUNT(*)
            FROM skin_journal_entries
            WHERE analysis_status = $6
          )::int AS analysis_completed_count,
          (
            SELECT COUNT(*)
            FROM skin_journal_entries
            WHERE analysis_status = $7
          )::int AS analysis_failed_count,
          (
            SELECT COALESCE(SUM(analysis_estimated_cost_usd), 0)
            FROM skin_journal_entries
            WHERE analysis_started_at >= $3
          )::float AS journal_ai_cost_mtd,
          (
            SELECT COALESCE(SUM(ai_estimated_cost_usd), 0)
            FROM suggestion_instances
            WHERE generated_at >= $3
          )::float AS suggestion_ai_cost_mtd
      `,
      [
        sinceWeek,
        sinceDay,
        sinceMonth,
        SuggestionGenerationStatus.Ready,
        ExportStatusValue.Failed,
        AnalysisStatusValue.Completed,
        AnalysisStatusValue.Failed,
      ],
    );
    const jobHealth = await Promise.all(
      JOB_HEALTH_CONFIGS.map((config) => this.getJobHealth(config, now)),
    );

    return this.buildOverview(metricsRow, jobHealth, now);
  }

  async listUsers(
    query: AdminUserListQuery = {},
  ): Promise<AdminUserListResponse> {
    const pagination = normalizePagination({
      defaultLimit: ADMIN_USERS_DEFAULT_LIMIT,
      limit: query.limit,
      maxLimit: ADMIN_USERS_MAX_LIMIT,
      page: query.page,
    });
    const whereClauses = ['1 = 1'];
    const params: Array<number | string> = [];

    const search = normalizeSearch(query.query);
    if (search) {
      params.push(`%${escapeLikePattern(search)}%`);
      const searchIndex = params.length;
      whereClauses.push(`(
        users.canonical_email ILIKE $${searchIndex} ESCAPE '\\'
        OR users.first_name ILIKE $${searchIndex} ESCAPE '\\'
        OR users.last_name ILIKE $${searchIndex} ESCAPE '\\'
      )`);
    }

    if (query.restriction === AdminUserRestrictionFilter.Restricted) {
      whereClauses.push('users.account_restricted_at IS NOT NULL');
    } else if (query.restriction === AdminUserRestrictionFilter.Unrestricted) {
      whereClauses.push('users.account_restricted_at IS NULL');
    }

    params.push(pagination.limit);
    const limitIndex = params.length;
    params.push(pagination.offset);
    const offsetIndex = params.length;
    const queryResult: unknown = await this.dataSource.query(
      `
        WITH filtered_users AS (
          SELECT
            users.id,
            users.email,
            users.first_name,
            users.last_name,
            users.email_verified,
            users.preferred_language,
            users.time_zone,
            users.account_deletion_scheduled_for,
            users.account_restricted_at,
            users.account_restriction_reason,
            users.account_restricted_by_admin_id,
            users.created_at,
            users.updated_at
          FROM users
          WHERE ${whereClauses.join(' AND ')}
        ),
        counted_users AS (
          SELECT COUNT(*)::int AS total_count
          FROM filtered_users
        ),
        paged_users AS (
          SELECT *
          FROM filtered_users
          ORDER BY created_at DESC, id DESC
          LIMIT $${limitIndex}
          OFFSET $${offsetIndex}
        )
        SELECT
          counted_users.total_count,
          paged_users.*,
          last_session.last_active_at
        FROM counted_users
        LEFT JOIN paged_users ON true
        LEFT JOIN LATERAL (
          SELECT auth_sessions.last_used_at AS last_active_at
          FROM auth_sessions
          WHERE auth_sessions.user_id = paged_users.id
          ORDER BY auth_sessions.last_used_at DESC
          LIMIT 1
        ) last_session ON paged_users.id IS NOT NULL
        ORDER BY paged_users.created_at DESC NULLS LAST, paged_users.id DESC NULLS LAST
      `,
      params,
    );
    const rows = toQueryRows(queryResult);
    const total = toNumber(rows[0]?.total_count);

    return {
      users: rows
        .filter((row) => typeof row.id === 'string')
        .map((row) => this.toAdminUserResponse(row)),
      ...buildPaginationMeta(total, pagination),
    };
  }

  async getUser(userId: string): Promise<AdminUserDetailResponse> {
    const sinceDay = new Date(Date.now() - DAY_MS);
    const row = await this.queryOne(
      `
        SELECT
          users.id,
          users.email,
          users.first_name,
          users.last_name,
          users.email_verified,
          users.preferred_language,
          users.time_zone,
          users.account_deletion_scheduled_for,
          users.account_restricted_at,
          users.account_restriction_reason,
          users.account_restricted_by_admin_id,
          users.created_at,
          users.updated_at,
          last_session.last_active_at,
          (
            SELECT COUNT(*)
            FROM auth_sessions
            WHERE auth_sessions.user_id = users.id
          )::int AS total_session_count,
          (
            SELECT COUNT(*)
            FROM auth_sessions
            WHERE auth_sessions.user_id = users.id
              AND auth_sessions.revoked_at IS NULL
              AND auth_sessions.expires_at > now()
          )::int AS active_session_count,
          EXISTS (
            SELECT 1
            FROM skin_profiles
            WHERE skin_profiles.user_id = users.id
          ) AS has_skin_profile,
          (
            SELECT COUNT(*)
            FROM skin_journal_entries
            WHERE skin_journal_entries.user_id = users.id
          )::int AS journal_entry_count,
          (
            SELECT MAX(created_at)
            FROM skin_journal_entries
            WHERE skin_journal_entries.user_id = users.id
          ) AS latest_journal_entry_at,
          (
            SELECT COUNT(*)
            FROM skin_journal_entries
            WHERE skin_journal_entries.user_id = users.id
              AND skin_journal_entries.analysis_status = $2
          )::int AS analysis_completed_count,
          (
            SELECT COUNT(*)
            FROM skin_journal_entries
            WHERE skin_journal_entries.user_id = users.id
              AND skin_journal_entries.analysis_status = $3
          )::int AS analysis_failed_count,
          (
            SELECT COUNT(*)
            FROM suggestion_instances
            WHERE suggestion_instances.user_id = users.id
          )::int AS suggestion_count,
          (
            SELECT MAX(generated_at)
            FROM suggestion_instances
            WHERE suggestion_instances.user_id = users.id
          ) AS latest_suggestion_at,
          (
            SELECT COUNT(*)
            FROM skin_journal_export_jobs
            WHERE skin_journal_export_jobs.user_id = users.id
              AND skin_journal_export_jobs.status = $4
          )::int AS failed_export_count,
          (
            SELECT COUNT(*)
            FROM user_data_access_logs
            WHERE user_data_access_logs.user_id = users.id
              AND user_data_access_logs.created_at >= $5
          )::int AS sensitive_access_events_24h
        FROM users
        LEFT JOIN LATERAL (
          SELECT auth_sessions.last_used_at AS last_active_at
          FROM auth_sessions
          WHERE auth_sessions.user_id = users.id
          ORDER BY auth_sessions.last_used_at DESC
          LIMIT 1
        ) last_session ON true
        WHERE users.id = $1
      `,
      [
        userId,
        AnalysisStatusValue.Completed,
        AnalysisStatusValue.Failed,
        ExportStatusValue.Failed,
        sinceDay,
      ],
    );

    if (typeof row.id !== 'string') {
      throw new NotFoundException('User not found');
    }

    const recentAuditLogs = await this.listAuditLogs({
      limit: ADMIN_USER_DETAIL_AUDIT_LIMIT,
      page: 1,
      targetUserId: userId,
    });

    return {
      ...this.toAdminUserResponse(row),
      activity: {
        activeSessionCount: toNumber(row.active_session_count),
        analysisCompletedCount: toNumber(row.analysis_completed_count),
        analysisFailedCount: toNumber(row.analysis_failed_count),
        hasSkinProfile: toBooleanValue(row.has_skin_profile),
        journalEntryCount: toNumber(row.journal_entry_count),
        latestJournalEntryAt: toNullableIso(row.latest_journal_entry_at),
        latestSuggestionAt: toNullableIso(row.latest_suggestion_at),
        suggestionCount: toNumber(row.suggestion_count),
        totalSessionCount: toNumber(row.total_session_count),
      },
      recentAuditLogs: recentAuditLogs.logs,
      safety: {
        failedExportCount: toNumber(row.failed_export_count),
        sensitiveAccessEvents24h: toNumber(row.sensitive_access_events_24h),
      },
    };
  }

  async listAuditLogs(
    query: AdminAuditLogQuery = {},
  ): Promise<AdminAuditLogListResponse> {
    const pagination = normalizePagination({
      defaultLimit: ADMIN_AUDIT_LOGS_DEFAULT_LIMIT,
      limit: query.limit,
      maxLimit: ADMIN_AUDIT_LOGS_MAX_LIMIT,
      page: query.page,
    });
    const whereClauses = ['1 = 1'];
    const params: Array<number | string> = [];

    if (query.action) {
      params.push(query.action);
      whereClauses.push(`logs.action = $${params.length}`);
    }

    if (query.targetAdminId) {
      params.push(query.targetAdminId);
      whereClauses.push(`logs.target_admin_id = $${params.length}`);
    }

    if (query.targetUserId) {
      params.push(query.targetUserId);
      whereClauses.push(`logs.target_user_id = $${params.length}`);
    }

    const search = normalizeSearch(
      query.query,
      ADMIN_AUDIT_LOG_SEARCH_MAX_LENGTH,
    );
    if (search) {
      params.push(`%${escapeLikePattern(search)}%`);
      const searchIndex = params.length;
      whereClauses.push(`(
        actor.canonical_email ILIKE $${searchIndex} ESCAPE '\\'
        OR actor.name ILIKE $${searchIndex} ESCAPE '\\'
        OR target_admin.canonical_email ILIKE $${searchIndex} ESCAPE '\\'
        OR target_admin.name ILIKE $${searchIndex} ESCAPE '\\'
        OR target_user.canonical_email ILIKE $${searchIndex} ESCAPE '\\'
        OR target_user.first_name ILIKE $${searchIndex} ESCAPE '\\'
        OR target_user.last_name ILIKE $${searchIndex} ESCAPE '\\'
        OR logs.reason ILIKE $${searchIndex} ESCAPE '\\'
      )`);
    }

    params.push(pagination.limit);
    const limitIndex = params.length;
    params.push(pagination.offset);
    const offsetIndex = params.length;
    const result: unknown = await this.dataSource.query(
      `
        WITH filtered_logs AS (
          SELECT
            logs.id,
            logs.action,
            logs.actor_admin_id,
            logs.actor_session_id,
            logs.target_admin_id,
            logs.target_user_id,
            logs.reason,
            logs.ip_address,
            logs.user_agent,
            logs.metadata,
            logs.created_at,
            actor.email AS actor_admin_email,
            actor.name AS actor_admin_name,
            target_admin.email AS target_admin_email,
            target_admin.name AS target_admin_name,
            target_user.email AS target_user_email,
            NULLIF(
              CONCAT_WS(' ', target_user.first_name, target_user.last_name),
              ''
            ) AS target_user_name
          FROM admin_audit_logs logs
          JOIN admin_accounts actor ON actor.id = logs.actor_admin_id
          LEFT JOIN admin_accounts target_admin
            ON target_admin.id = logs.target_admin_id
          LEFT JOIN users target_user ON target_user.id = logs.target_user_id
          WHERE ${whereClauses.join(' AND ')}
        ),
        counted_logs AS (
          SELECT COUNT(*)::int AS total_count
          FROM filtered_logs
        ),
        paged_logs AS (
          SELECT *
          FROM filtered_logs
          ORDER BY created_at DESC, id DESC
          LIMIT $${limitIndex}
          OFFSET $${offsetIndex}
        )
        SELECT counted_logs.total_count, paged_logs.*
        FROM counted_logs
        LEFT JOIN paged_logs ON true
        ORDER BY paged_logs.created_at DESC NULLS LAST,
          paged_logs.id DESC NULLS LAST
      `,
      params,
    );
    const rows = toQueryRows(result);
    const total = toNumber(rows[0]?.total_count);

    return {
      logs: rows
        .filter((row) => typeof row.id === 'string')
        .map((row) => this.toAdminAuditLogResponse(row)),
      ...buildPaginationMeta(total, pagination),
    };
  }

  async getOperationsMonitoring(
    now = new Date(),
  ): Promise<AdminOperationsMonitoringResponse> {
    const [jobHealth, compliance, workItems] = await Promise.all([
      Promise.all(
        JOB_HEALTH_CONFIGS.map((config) => this.getJobHealth(config, now)),
      ),
      this.getOperationsCompliance(now),
      this.getOperationalWorkItems(now),
    ]);

    return {
      compliance,
      generatedAt: now.toISOString(),
      jobHealth,
      workItems,
    };
  }

  async restrictUser(
    actor: AdminAuthenticatedUser,
    userId: string,
    context: AdminUserAuditContext,
  ): Promise<AdminUserResponse> {
    const reason = this.normalizeAuditReason(context.reason);

    return this.runUserMutation(async (repositories) => {
      const user = await this.findUserForRestriction(
        repositories.usersRepository,
        userId,
      );
      const restrictedAt = new Date();

      user.account_restricted_at = restrictedAt;
      user.account_restriction_reason = reason;
      user.account_restricted_by_admin_id = actor.id;
      const savedUser = await repositories.usersRepository.save(user);

      await repositories.sessionsRepository.update(
        { revoked_at: IsNull(), user_id: user.id },
        { revoked_at: restrictedAt },
      );
      await this.writeUserAuditLog(repositories.auditLogsRepository, {
        action: AdminAuditAction.UserRestricted,
        actor,
        context: { ...context, reason },
        metadata: {
          userEmail: savedUser.email,
        },
        targetUserId: savedUser.id,
      });

      return this.toAdminUserResponse(savedUser);
    });
  }

  async unrestrictUser(
    actor: AdminAuthenticatedUser,
    userId: string,
    context: AdminUserAuditContext,
  ): Promise<AdminUserResponse> {
    const reason = this.normalizeAuditReason(context.reason);

    return this.runUserMutation(async (repositories) => {
      const user = await this.findUserForRestriction(
        repositories.usersRepository,
        userId,
      );

      user.account_restricted_at = null;
      user.account_restriction_reason = null;
      user.account_restricted_by_admin_id = null;
      const savedUser = await repositories.usersRepository.save(user);

      await this.writeUserAuditLog(repositories.auditLogsRepository, {
        action: AdminAuditAction.UserUnrestricted,
        actor,
        context: { ...context, reason },
        metadata: {
          userEmail: savedUser.email,
        },
        targetUserId: savedUser.id,
      });

      return this.toAdminUserResponse(savedUser);
    });
  }

  private async queryOne(sql: string, params: unknown[]): Promise<QueryRow> {
    const result = (await this.dataSource.query(sql, params)) as unknown;
    const rows: readonly unknown[] = Array.isArray(result)
      ? (result as readonly unknown[])
      : [];
    const firstRow: unknown = rows[0];
    return firstRow && typeof firstRow === 'object'
      ? (firstRow as QueryRow)
      : {};
  }

  private async getJobHealth(config: JobHealthConfig, now: Date) {
    const row = await this.queryOne(
      `
        SELECT
          (
            SELECT COUNT(*)
            FROM ${config.tableName}
            WHERE status = ANY($1::text[])
          )::int AS queued,
          (
            SELECT COUNT(*)
            FROM ${config.tableName}
            WHERE status = $2
          )::int AS failed,
          (
            SELECT FLOOR(EXTRACT(EPOCH FROM ($3::timestamptz - MIN(run_after))))
            FROM ${config.tableName}
            WHERE status = ANY($1::text[])
          )::int AS oldest_queued_age_seconds
      `,
      [[...config.activeStatuses], config.failedStatus, now],
    );
    const queued = toNumber(row.queued);
    const failed = toNumber(row.failed);
    const oldestQueuedAgeSeconds = toNullableNumber(
      row.oldest_queued_age_seconds,
    );

    return {
      id: config.id,
      label: config.label,
      status: resolveJobStatus(queued, failed, oldestQueuedAgeSeconds),
      queued,
      failed,
      oldestQueuedAgeSeconds,
    };
  }

  private buildOverview(
    row: QueryRow,
    jobHealth: AdminOverviewResponse['jobHealth'],
    now: Date,
  ): AdminOverviewResponse {
    const registeredUsers = toNumber(row.registered_users);
    const verifiedUsers = toNumber(row.verified_users);
    const weeklyActiveUsers = toNumber(row.weekly_active_users);
    const skinProfileUsers = toNumber(row.skin_profile_users);
    const routineUsers = toNumber(row.routine_users);
    const weeklyCheckinUsers = toNumber(row.weekly_checkin_users);
    const suggestionUsers = toNumber(row.suggestion_users);
    const journalUsers = toNumber(row.journal_users);
    const analysisCompletedCount = toNumber(row.analysis_completed_count);
    const analysisFailedCount = toNumber(row.analysis_failed_count);
    const failedExportCount = toNumber(row.failed_export_count);
    const pendingDeletionCount = toNumber(row.pending_deletion_count);
    const sensitiveAccessEvents24h = toNumber(row.sensitive_access_events_24h);
    const activeRestrictions = toNumber(row.active_restrictions);
    const aiTotalCount = analysisCompletedCount + analysisFailedCount;
    const monthToDateAiCostUsd =
      toNumber(row.journal_ai_cost_mtd) + toNumber(row.suggestion_ai_cost_mtd);

    return {
      generatedAt: now.toISOString(),
      metrics: {
        registeredUsers,
        verifiedUsers,
        weeklyActiveUsers,
        activationRate: percentage(skinProfileUsers, registeredUsers),
        routineAcceptanceRate: percentage(routineUsers, registeredUsers),
        dailyCheckInRate: percentage(weeklyCheckinUsers, registeredUsers),
        aiSuccessRate: percentage(analysisCompletedCount, aiTotalCount),
        monthToDateAiCostUsd,
        activeRestrictions,
      },
      activationFunnel: [
        {
          stage: 'account_created',
          label: 'Account created',
          count: registeredUsers,
        },
        {
          stage: 'skin_profile_created',
          label: 'Skin profile created',
          count: skinProfileUsers,
        },
        {
          stage: 'first_suggestion_recorded',
          label: 'First suggestion recorded',
          count: suggestionUsers,
        },
        {
          stage: 'journal_check_in_recorded',
          label: 'Journal check-in recorded',
          count: journalUsers,
        },
      ],
      alerts: this.buildAlerts({
        failedExportCount,
        jobHealth,
        pendingDeletionCount,
        sensitiveAccessEvents24h,
      }),
      jobHealth,
      compliance: {
        pendingDeletionCount,
        failedExportCount,
        sensitiveAccessEvents24h,
      },
    };
  }

  private buildAlerts(input: {
    failedExportCount: number;
    jobHealth: AdminOverviewResponse['jobHealth'];
    pendingDeletionCount: number;
    sensitiveAccessEvents24h: number;
  }): AdminOverviewResponse['alerts'] {
    const alerts: AdminOverviewResponse['alerts'] = [];
    const delayedJob = input.jobHealth.find(
      (job) => job.status === AdminJobStatus.Critical,
    );

    if (delayedJob) {
      alerts.push({
        id: `job-${delayedJob.id}`,
        severity: AdminAlertSeverity.Critical,
        title:
          delayedJob.id === 'journal-analysis'
            ? 'Analysis queue delayed'
            : `${delayedJob.label} queue delayed`,
        description: `${delayedJob.label} has ${delayedJob.queued} queued and ${delayedJob.failed} failed jobs.`,
      });
    }

    if (input.failedExportCount > 0) {
      alerts.push({
        id: 'failed-journal-exports',
        severity: AdminAlertSeverity.Critical,
        title: 'Journal exports failing',
        description: `${input.failedExportCount} journal export jobs need review.`,
      });
    }

    if (input.pendingDeletionCount > 0) {
      alerts.push({
        id: 'pending-account-deletions',
        severity: AdminAlertSeverity.Warning,
        title: 'Pending deletions',
        description: `${input.pendingDeletionCount} account deletion requests are scheduled.`,
      });
    }

    if (input.sensitiveAccessEvents24h > 0) {
      alerts.push({
        id: 'sensitive-access-events',
        severity: AdminAlertSeverity.Info,
        title: 'Sensitive access recorded',
        description: `${input.sensitiveAccessEvents24h} sensitive data access events were logged in the last 24 hours.`,
      });
    }

    return alerts;
  }

  private async getOperationsCompliance(
    now: Date,
  ): Promise<AdminOperationsMonitoringResponse['compliance']> {
    const sinceDay = new Date(now.getTime() - DAY_MS);
    const row = await this.queryOne(
      `
        SELECT
          (
            SELECT COUNT(*)
            FROM users
            WHERE account_deletion_scheduled_for IS NOT NULL
          )::int AS pending_deletion_count,
          (
            SELECT COUNT(*)
            FROM skin_journal_export_jobs
            WHERE status = $1
          )::int AS failed_export_count,
          (
            SELECT COUNT(*)
            FROM user_data_access_logs
            WHERE created_at >= $2
          )::int AS sensitive_access_events_24h
      `,
      [ExportStatusValue.Failed, sinceDay],
    );

    return {
      failedExportCount: toNumber(row.failed_export_count),
      pendingDeletionCount: toNumber(row.pending_deletion_count),
      sensitiveAccessEvents24h: toNumber(row.sensitive_access_events_24h),
    };
  }

  private async getOperationalWorkItems(
    now: Date,
  ): Promise<AdminOperationalWorkItemResponse[]> {
    const delayedBefore = new Date(
      now.getTime() - JOB_WARNING_AGE_SECONDS * 1000,
    );
    const rows = toQueryRows(
      await this.dataSource.query(
        `
          SELECT *
          FROM (
            SELECT
              'journal-analysis' AS type,
              'Journal analysis' AS label,
              jobs.id,
              jobs.user_id,
              users.email AS user_email,
              jobs.status::text AS status,
              jobs.attempt_count,
              jobs.run_after,
              jobs.last_error,
              jobs.created_at,
              jobs.updated_at,
              CASE
                WHEN jobs.status = $1 THEN 'critical'
                ELSE 'warning'
              END AS severity
            FROM skin_journal_analysis_jobs jobs
            LEFT JOIN users ON users.id = jobs.user_id
            WHERE jobs.status = $1
              OR (jobs.status = ANY($2::text[]) AND jobs.run_after <= $3)

            UNION ALL

            SELECT
              'smart-picks' AS type,
              'Smart Picks' AS label,
              jobs.id,
              jobs.user_id,
              users.email AS user_email,
              jobs.status::text AS status,
              jobs.attempt_count,
              jobs.run_after,
              jobs.last_error,
              jobs.created_at,
              jobs.updated_at,
              CASE
                WHEN jobs.status = $4 THEN 'critical'
                ELSE 'warning'
              END AS severity
            FROM smart_pick_generation_jobs jobs
            LEFT JOIN users ON users.id = jobs.user_id
            WHERE jobs.status = $4
              OR (jobs.status = ANY($5::text[]) AND jobs.run_after <= $3)

            UNION ALL

            SELECT
              'suggestions' AS type,
              'Daily suggestions' AS label,
              jobs.id,
              jobs.user_id,
              users.email AS user_email,
              jobs.status::text AS status,
              jobs.attempt_count,
              jobs.run_after,
              jobs.last_error,
              jobs.created_at,
              jobs.updated_at,
              CASE
                WHEN jobs.status = $6 THEN 'critical'
                ELSE 'warning'
              END AS severity
            FROM suggestion_generation_jobs jobs
            LEFT JOIN users ON users.id = jobs.user_id
            WHERE jobs.status = $6
              OR (jobs.status = ANY($7::text[]) AND jobs.run_after <= $3)

            UNION ALL

            SELECT
              'journal-export' AS type,
              'Journal export' AS label,
              exports.id,
              exports.user_id,
              users.email AS user_email,
              exports.status::text AS status,
              NULL::int AS attempt_count,
              NULL::timestamptz AS run_after,
              NULL::text AS last_error,
              exports.created_at,
              exports.created_at AS updated_at,
              'critical' AS severity
            FROM skin_journal_export_jobs exports
            LEFT JOIN users ON users.id = exports.user_id
            WHERE exports.status = $8

            UNION ALL

            SELECT
              'account-deletion' AS type,
              'Account deletion' AS label,
              users.id,
              users.id AS user_id,
              users.email AS user_email,
              'scheduled' AS status,
              NULL::int AS attempt_count,
              users.account_deletion_scheduled_for AS run_after,
              NULL::text AS last_error,
              users.created_at,
              users.updated_at,
              CASE
                WHEN users.account_deletion_scheduled_for <= $9 THEN 'critical'
                ELSE 'warning'
              END AS severity
            FROM users
            WHERE users.account_deletion_scheduled_for IS NOT NULL
          ) work_items
          ORDER BY
            CASE work_items.severity
              WHEN 'critical' THEN 0
              WHEN 'warning' THEN 1
              ELSE 2
            END,
            work_items.run_after ASC NULLS LAST,
            work_items.updated_at DESC NULLS LAST
          LIMIT $10
        `,
        [
          AnalysisJobStatusValue.Failed,
          [
            AnalysisJobStatusValue.Queued,
            AnalysisJobStatusValue.Sent,
            AnalysisJobStatusValue.Running,
          ],
          delayedBefore,
          SmartPicksGenerationJobStatus.Failed,
          [
            SmartPicksGenerationJobStatus.Queued,
            SmartPicksGenerationJobStatus.Sent,
            SmartPicksGenerationJobStatus.Running,
          ],
          SuggestionGenerationJobStatus.Failed,
          [
            SuggestionGenerationJobStatus.Queued,
            SuggestionGenerationJobStatus.Running,
          ],
          ExportStatusValue.Failed,
          now,
          ADMIN_OPERATIONS_WORK_ITEM_LIMIT,
        ],
      ),
    );

    return rows.map((row) => this.toOperationalWorkItemResponse(row));
  }

  private toAdminAuditLogResponse(row: QueryRow): AdminAuditLogResponse {
    const targetAdminId = toNullableString(row.target_admin_id);
    const targetUserId = toNullableString(row.target_user_id);

    return {
      action: toStringValue(row.action),
      actor: {
        email: toStringValue(row.actor_admin_email),
        id: toStringValue(row.actor_admin_id),
        name: toStringValue(row.actor_admin_name),
      },
      actorAdminId: toStringValue(row.actor_admin_id),
      actorSessionId: toStringValue(row.actor_session_id),
      createdAt: toNullableIso(row.created_at) ?? toIsoString(new Date(0)),
      id: toStringValue(row.id),
      ipAddress: toNullableString(row.ip_address),
      metadata: toMetadata(row.metadata),
      reason: toStringValue(row.reason),
      target: this.toAuditTargetResponse(row, targetAdminId, targetUserId),
      targetAdminId,
      targetUserId,
      userAgent: toNullableString(row.user_agent),
    };
  }

  private toAuditTargetResponse(
    row: QueryRow,
    targetAdminId: string | null,
    targetUserId: string | null,
  ): AdminAuditLogResponse['target'] {
    if (targetAdminId) {
      return {
        email: toStringValue(row.target_admin_email),
        id: targetAdminId,
        name: toStringValue(row.target_admin_name),
        type: 'admin',
      };
    }

    if (targetUserId) {
      return {
        email: toStringValue(row.target_user_email),
        id: targetUserId,
        name: toStringValue(row.target_user_name),
        type: 'user',
      };
    }

    return {
      email: null,
      id: null,
      name: null,
      type: 'system',
    };
  }

  private toOperationalWorkItemResponse(
    row: QueryRow,
  ): AdminOperationalWorkItemResponse {
    return {
      attemptCount: toNullableNumber(row.attempt_count),
      createdAt: toNullableIso(row.created_at) ?? toIsoString(new Date(0)),
      id: toStringValue(row.id),
      label: toStringValue(row.label),
      lastError: toNullableString(row.last_error),
      runAfter: toNullableIso(row.run_after),
      severity:
        toStringValue(row.severity) === AdminJobStatus.Critical
          ? AdminJobStatus.Critical
          : AdminJobStatus.Warning,
      status: toStringValue(row.status),
      type: toStringValue(row.type),
      updatedAt: toNullableIso(row.updated_at),
      userEmail: toNullableString(row.user_email),
      userId: toNullableString(row.user_id),
    };
  }

  private toAdminUserResponse(user: User | QueryRow): AdminUserResponse {
    return {
      accountDeletionScheduledFor: toNullableIso(
        'account_deletion_scheduled_for' in user
          ? user.account_deletion_scheduled_for
          : null,
      ),
      createdAt:
        toNullableIso('created_at' in user ? user.created_at : null) ??
        toIsoString(new Date()),
      email: toStringValue(user.email),
      emailVerified: toBooleanValue(user.email_verified),
      firstName: toStringValue(user.first_name),
      id: toStringValue(user.id),
      lastActiveAt: toNullableIso(
        'last_active_at' in user ? user.last_active_at : null,
      ),
      lastName: toStringValue(user.last_name),
      preferredLanguage: toStringValue(user.preferred_language),
      restrictedAt: toNullableIso(
        'account_restricted_at' in user ? user.account_restricted_at : null,
      ),
      restrictedByAdminId: toNullableString(
        'account_restricted_by_admin_id' in user
          ? user.account_restricted_by_admin_id
          : null,
      ),
      restrictionReason: toNullableString(
        'account_restriction_reason' in user
          ? user.account_restriction_reason
          : null,
      ),
      timeZone: toNullableString('time_zone' in user ? user.time_zone : null),
      updatedAt:
        toNullableIso('updated_at' in user ? user.updated_at : null) ??
        toIsoString(new Date()),
    };
  }

  private async findUserForRestriction(
    usersRepository: Repository<User>,
    userId: string,
  ): Promise<User> {
    const user = await usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  private normalizeAuditReason(reason: string): string {
    const trimmed = reason.trim();
    if (!trimmed) {
      throw new BadRequestException('Admin audit reason is required');
    }

    return trimmed;
  }

  private async writeUserAuditLog(
    auditLogsRepository: Repository<AdminAuditLog>,
    input: {
      action: AdminAuditAction;
      actor: AdminAuthenticatedUser;
      context: AdminUserAuditContext;
      metadata: Record<string, unknown>;
      targetUserId: string;
    },
  ): Promise<void> {
    const auditLog = auditLogsRepository.create({
      action: input.action,
      actor_admin_id: input.actor.id,
      actor_session_id: input.context.sessionId,
      ip_address: sanitizeIpAddress(input.context.ip),
      metadata: input.metadata,
      reason: input.context.reason,
      target_admin_id: null,
      target_user_id: input.targetUserId,
      user_agent: sanitizeUserAgent(input.context.userAgent),
    });

    await auditLogsRepository.save(auditLog);
  }

  private async runUserMutation<T>(
    operation: (repositories: AdminUserMutationRepositories) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction((manager) =>
      operation(this.getUserMutationRepositories(manager)),
    );
  }

  private getUserMutationRepositories(
    manager: EntityManager,
  ): AdminUserMutationRepositories {
    return {
      auditLogsRepository: manager.getRepository(AdminAuditLog),
      sessionsRepository: manager.getRepository(AuthSession),
      usersRepository: manager.getRepository(User),
    };
  }
}

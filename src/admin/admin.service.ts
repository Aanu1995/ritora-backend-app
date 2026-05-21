import {
  BadRequestException,
  ConflictException,
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
import { isPostgresUniqueConstraintError } from '../common/utils/database-errors';
import {
  AnalysisJobStatusValue,
  AnalysisStatusValue,
  ExportStatusValue,
  InsightGenerationStatusValue,
} from '../skin-journal/skin-journal.constants';
import { SmartPicksGenerationJobStatus } from '../smart-picks/smart-picks.types';
import {
  SuggestionGenerationJobStatus,
  SuggestionGenerationStatus,
} from '../suggestions/suggestions.constants';
import { User } from '../users/entities/user.entity';
import {
  AdminAlertSeverity,
  AdminAiCostFeatureFilter,
  AdminAiCostPeriod,
  type AdminAiCostByUserListResponse,
  type AdminAiCostUserListQuery,
  type AdminAuditLogResponse,
  type AdminAuditLogListResponse,
  type AdminAuditLogQuery,
  AdminJobStatus,
  AdminMetricSource,
  type AdminOperationsMonitoringResponse,
  type AdminOperationalIncidentListQuery,
  type AdminOperationalIncidentListResponse,
  type AdminOperationalIncidentResponse,
  type AdminOperationalWorkItemResponse,
  AdminPermission,
  type AdminAuthenticatedUser,
  type AdminMemberResponse,
  type AdminOverviewResponse,
  type AdminUserDetailResponse,
  type AdminUserListQuery,
  type AdminUserListResponse,
  type AdminUserNoteAuthorResponse,
  type AdminUserNoteListQuery,
  type AdminUserNoteListResponse,
  type AdminUserNoteResponse,
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
import {
  AdminOperationalIncident,
  AdminOperationalIncidentSeverity,
  AdminOperationalIncidentStatus,
} from './entities/admin-operational-incident.entity';
import { AdminUserNote } from './entities/admin-user-note.entity';
import { AdminOperationalIncidentStatusFilter } from './dto/admin-operational-incident.dto';

type QueryRow = Record<string, unknown>;

type AdminRequestContext = {
  ip?: string;
  sessionId: string;
  userAgent?: string;
};

type AdminUserAuditContext = AdminRequestContext & {
  reason: string;
};

type AdminUserMutationRepositories = {
  auditLogsRepository: Repository<AdminAuditLog>;
  incidentsRepository: Repository<AdminOperationalIncident>;
  notesRepository: Repository<AdminUserNote>;
  sessionsRepository: Repository<AuthSession>;
  usersRepository: Repository<User>;
};

type AdminOperationalIncidentActor = {
  email: string;
  id: string;
  name: string;
};

type JobHealthConfig = {
  activeStatuses: readonly string[];
  failedStatus: string;
  id: string;
  label: string;
  tableName: string;
};

type AdminAiCostMetricFeature = Exclude<
  AdminAiCostFeatureFilter,
  typeof AdminAiCostFeatureFilter.All
>;

type AiCostRollupSqlFactory = (
  joinCandidateUsers: (tableAlias: string) => string,
  requireUserId: (tableAlias: string) => string,
) => string;

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
const ADMIN_AI_COST_USERS_DEFAULT_LIMIT = 10;
const ADMIN_AI_COST_USERS_MAX_LIMIT = 100;
const ADMIN_USER_DETAIL_AUDIT_LIMIT = 5;
const ADMIN_USER_NOTES_DEFAULT_LIMIT = 10;
const ADMIN_USER_NOTES_MAX_LIMIT = 50;
const ADMIN_USER_NOTE_BODY_MAX_LENGTH = 2000;
const ADMIN_OPERATIONAL_INCIDENTS_DEFAULT_LIMIT = 10;
const ADMIN_OPERATIONAL_INCIDENTS_MAX_LIMIT = 50;
const ADMIN_OPERATIONAL_INCIDENT_TITLE_MAX_LENGTH = 160;
const ADMIN_OPERATIONAL_INCIDENT_DESCRIPTION_MAX_LENGTH = 1000;
const ADMIN_OPERATIONS_WORK_ITEM_LIMIT = 20;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;
const OVERVIEW_TREND_DAYS = 14;
const JOB_WARNING_AGE_SECONDS = 5 * 60;
const JOB_CRITICAL_AGE_SECONDS = 10 * 60;
const JOB_WARNING_QUEUE_COUNT = 10;
const ADMIN_USER_SEARCH_MAX_LENGTH = 100;
const ENDPOINT_WARNING_ERROR_RATE = 1;
const ENDPOINT_CRITICAL_ERROR_RATE = 5;
const ENDPOINT_WARNING_P95_MS = 500;
const ENDPOINT_CRITICAL_P95_MS = 1000;
const USER_API_HEALTH_WINDOW_MINUTES = 15;
const DATABASE_WARNING_LATENCY_MS = 250;
const DATABASE_CRITICAL_LATENCY_MS = 1000;

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

const ADMIN_AI_COST_FEATURES = [
  AdminAiCostFeatureFilter.JournalAnalysis,
  AdminAiCostFeatureFilter.JournalInsights,
  AdminAiCostFeatureFilter.DailySuggestions,
  AdminAiCostFeatureFilter.QuickCheck,
  AdminAiCostFeatureFilter.SmartPicks,
] as const satisfies readonly AdminAiCostMetricFeature[];

const ADMIN_AI_COST_ROLLUP_SQL: Record<
  AdminAiCostMetricFeature,
  AiCostRollupSqlFactory
> = {
  [AdminAiCostFeatureFilter.JournalAnalysis]: (
    joinCandidateUsers,
    requireUserId,
  ) => `
          SELECT
            entries.user_id,
            'journal_analysis' AS feature,
            COALESCE(SUM(entries.analysis_estimated_cost_usd), 0)::float AS month_to_date_cost_usd,
            COALESCE(
              SUM(entries.analysis_estimated_cost_usd) FILTER (
                WHERE entries.analysis_started_at >= bounds.today_start
                  AND entries.analysis_started_at < bounds.tomorrow_start
              ),
              0
            )::float AS today_cost_usd
          FROM skin_journal_entries entries
          ${joinCandidateUsers('entries')}
          CROSS JOIN bounds
          WHERE entries.analysis_started_at >= bounds.since_month
            ${requireUserId('entries')}
            AND entries.analysis_estimated_cost_usd IS NOT NULL
          GROUP BY entries.user_id
        `,
  [AdminAiCostFeatureFilter.JournalInsights]: (
    joinCandidateUsers,
    requireUserId,
  ) => `
          SELECT
            runs.user_id,
            'journal_insights' AS feature,
            COALESCE(SUM(runs.ai_estimated_cost_usd), 0)::float AS month_to_date_cost_usd,
            COALESCE(
              SUM(runs.ai_estimated_cost_usd) FILTER (
                WHERE runs.completed_at >= bounds.today_start
                  AND runs.completed_at < bounds.tomorrow_start
              ),
              0
            )::float AS today_cost_usd
          FROM skin_journal_insight_generation_runs runs
          ${joinCandidateUsers('runs')}
          CROSS JOIN bounds
          WHERE runs.completed_at >= bounds.since_month
            ${requireUserId('runs')}
            AND runs.ai_estimated_cost_usd IS NOT NULL
          GROUP BY runs.user_id
        `,
  [AdminAiCostFeatureFilter.DailySuggestions]: (
    joinCandidateUsers,
    requireUserId,
  ) => `
          SELECT
            suggestions.user_id,
            'daily_suggestions' AS feature,
            COALESCE(SUM(suggestions.ai_estimated_cost_usd), 0)::float AS month_to_date_cost_usd,
            COALESCE(
              SUM(suggestions.ai_estimated_cost_usd) FILTER (
                WHERE suggestions.generated_at >= bounds.today_start
                  AND suggestions.generated_at < bounds.tomorrow_start
              ),
              0
            )::float AS today_cost_usd
          FROM suggestion_instances suggestions
          ${joinCandidateUsers('suggestions')}
          CROSS JOIN bounds
          WHERE suggestions.generated_at >= bounds.since_month
            ${requireUserId('suggestions')}
            AND suggestions.ai_estimated_cost_usd IS NOT NULL
          GROUP BY suggestions.user_id
        `,
  [AdminAiCostFeatureFilter.QuickCheck]: (
    joinCandidateUsers,
    requireUserId,
  ) => `
          SELECT
            quick_checks.user_id,
            'quick_check' AS feature,
            COALESCE(SUM(quick_checks.ai_estimated_cost_usd), 0)::float AS month_to_date_cost_usd,
            COALESCE(
              SUM(quick_checks.ai_estimated_cost_usd) FILTER (
                WHERE quick_checks.occurred_at >= bounds.today_start
                  AND quick_checks.occurred_at < bounds.tomorrow_start
              ),
              0
            )::float AS today_cost_usd
          FROM product_check_ai_review_metrics quick_checks
          ${joinCandidateUsers('quick_checks')}
          CROSS JOIN bounds
          WHERE quick_checks.occurred_at >= bounds.since_month
            ${requireUserId('quick_checks')}
            AND quick_checks.ai_estimated_cost_usd IS NOT NULL
          GROUP BY quick_checks.user_id
        `,
  [AdminAiCostFeatureFilter.SmartPicks]: (
    joinCandidateUsers,
    requireUserId,
  ) => `
          SELECT
            smart_pick_events.user_id,
            'smart_picks' AS feature,
            COALESCE(SUM(smart_pick_events.cost_usd), 0)::float AS month_to_date_cost_usd,
            COALESCE(
              SUM(smart_pick_events.cost_usd) FILTER (
                WHERE smart_pick_events.occurred_at >= bounds.today_start
                  AND smart_pick_events.occurred_at < bounds.tomorrow_start
              ),
              0
            )::float AS today_cost_usd
          FROM (
            SELECT
              snapshots.user_id,
              snapshots.generated_at AS occurred_at,
              snapshots.ai_estimated_cost_usd AS cost_usd
            FROM smart_pick_snapshots snapshots
            ${joinCandidateUsers('snapshots')}
            CROSS JOIN bounds
            WHERE snapshots.generated_at >= bounds.since_month
              ${requireUserId('snapshots')}
              AND snapshots.ai_estimated_cost_usd IS NOT NULL
            UNION ALL
            SELECT
              jobs.user_id,
              jobs.updated_at AS occurred_at,
              jobs.ai_estimated_cost_usd AS cost_usd
            FROM smart_pick_generation_jobs jobs
            ${joinCandidateUsers('jobs')}
            CROSS JOIN bounds
            WHERE jobs.updated_at >= bounds.since_month
              ${requireUserId('jobs')}
              AND jobs.ai_estimated_cost_usd IS NOT NULL
          ) smart_pick_events
          CROSS JOIN bounds
          GROUP BY smart_pick_events.user_id
        `,
};
const ADMIN_AI_COST_FEATURE_FILTER_VALUES = new Set<string>(
  Object.values(AdminAiCostFeatureFilter),
);
const ADMIN_AI_COST_PERIOD_VALUES = new Set<string>(
  Object.values(AdminAiCostPeriod),
);

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

function normalizeAiCostFeature(
  value: AdminAiCostFeatureFilter | undefined,
): AdminAiCostFeatureFilter {
  return value && ADMIN_AI_COST_FEATURE_FILTER_VALUES.has(value)
    ? value
    : AdminAiCostFeatureFilter.All;
}

function normalizeAiCostPeriod(
  value: AdminAiCostPeriod | undefined,
): AdminAiCostPeriod {
  return value && ADMIN_AI_COST_PERIOD_VALUES.has(value)
    ? value
    : AdminAiCostPeriod.MonthToDate;
}

function getAiCostFeaturesForFilter(
  feature: AdminAiCostFeatureFilter,
): readonly AdminAiCostMetricFeature[] {
  return feature === AdminAiCostFeatureFilter.All
    ? ADMIN_AI_COST_FEATURES
    : [feature];
}

function getAiCostOrderBy(period: AdminAiCostPeriod): string {
  return period === AdminAiCostPeriod.Today
    ? 'rollup.today_cost_usd DESC, rollup.month_to_date_cost_usd DESC'
    : 'rollup.month_to_date_cost_usd DESC, rollup.today_cost_usd DESC';
}

function getAiCostSpendColumn(period: AdminAiCostPeriod): string {
  return period === AdminAiCostPeriod.Today
    ? 'today_cost_usd'
    : 'month_to_date_cost_usd';
}

function isQueryRow(value: unknown): value is QueryRow {
  return typeof value === 'object' && value !== null;
}

function toQueryRows(value: unknown): QueryRow[] {
  return Array.isArray(value) ? value.filter(isQueryRow) : [];
}

function toDateCountPoints(
  value: unknown,
): AdminOverviewResponse['signupTrend'] {
  return toQueryRows(value)
    .map((row) => ({
      count: toNumber(row.count),
      date: toStringValue(row.date),
    }))
    .filter((point) => point.date.length > 0);
}

function toActiveUserTrendPoints(
  value: unknown,
): AdminOverviewResponse['activeUserTrend'] {
  return toQueryRows(value)
    .map((row) => ({
      dailyActiveUsers: toNumber(row.dailyActiveUsers),
      date: toStringValue(row.date),
      monthlyActiveUsers: toNumber(row.monthlyActiveUsers),
      weeklyActiveUsers: toNumber(row.weeklyActiveUsers),
    }))
    .filter((point) => point.date.length > 0);
}

function toRetentionCohorts(
  value: unknown,
): AdminOverviewResponse['retentionCohorts'] {
  return toQueryRows(value)
    .map((row) => {
      const eligibleUsers = toNumber(row.eligibleUsers);
      const retainedUsers = toNumber(row.retainedUsers);

      return {
        eligibleUsers,
        id: toStringValue(row.id),
        label: toStringValue(row.label),
        rate: percentage(retainedUsers, eligibleUsers),
        retainedUsers,
      };
    })
    .filter((cohort) => cohort.id.length > 0 && cohort.label.length > 0);
}

function resolveEndpointStatus(
  errorRate: number,
  p95LatencyMs: number,
): AdminJobStatus {
  if (
    errorRate >= ENDPOINT_CRITICAL_ERROR_RATE ||
    p95LatencyMs >= ENDPOINT_CRITICAL_P95_MS
  ) {
    return AdminJobStatus.Critical;
  }

  if (
    errorRate >= ENDPOINT_WARNING_ERROR_RATE ||
    p95LatencyMs >= ENDPOINT_WARNING_P95_MS
  ) {
    return AdminJobStatus.Warning;
  }

  return AdminJobStatus.Healthy;
}

function resolveDatabaseStatus(latencyMs: number): AdminJobStatus {
  if (latencyMs >= DATABASE_CRITICAL_LATENCY_MS) {
    return AdminJobStatus.Critical;
  }

  if (latencyMs >= DATABASE_WARNING_LATENCY_MS) {
    return AdminJobStatus.Warning;
  }

  return AdminJobStatus.Healthy;
}

function resolveAggregateStatus(
  statuses: readonly AdminJobStatus[],
): AdminJobStatus {
  if (statuses.includes(AdminJobStatus.Critical)) {
    return AdminJobStatus.Critical;
  }

  if (statuses.includes(AdminJobStatus.Warning)) {
    return AdminJobStatus.Warning;
  }

  return AdminJobStatus.Healthy;
}

function toEndpointHealth(
  value: unknown,
): AdminOverviewResponse['endpointHealth'] {
  return toQueryRows(value)
    .map((row) => {
      const method = toStringValue(row.method).toUpperCase();
      const route = toStringValue(row.route).slice(0, 180);
      const errorRate = toNumber(row.errorRate);
      const p95LatencyMs = toNumber(row.p95LatencyMs);

      return {
        errorRate,
        id: `${method} ${route}`,
        method,
        p95LatencyMs,
        requestCount: toNumber(row.requestCount),
        route,
        status: resolveEndpointStatus(errorRate, p95LatencyMs),
      };
    })
    .filter(
      (endpoint) => endpoint.method.length > 0 && endpoint.route.length > 0,
    );
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

function dayStart(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      0,
      0,
      0,
      0,
    ),
  );
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
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
      mfaEnabled:
        'mfa_enabled_at' in user ? Boolean(user.mfa_enabled_at) : false,
      mfaEnabledAt:
        'mfa_enabled_at' in user
          ? toNullableIsoString(user.mfa_enabled_at)
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
    const sinceThirtyDays = new Date(now.getTime() - MONTH_MS);
    const sinceMonth = monthStart(now);
    const todayStart = dayStart(now);
    const tomorrowStart = addDays(todayStart, 1);
    const trendStart = addDays(todayStart, -(OVERVIEW_TREND_DAYS - 1));
    const metricsRow = await this.queryOne(
      `
        WITH bounds AS (
          SELECT
            $1::timestamptz AS since_week,
            $2::timestamptz AS since_day,
            $3::timestamptz AS since_month,
            $8::timestamptz AS since_thirty_days,
            $9::timestamptz AS today_start,
            $10::timestamptz AS trend_start,
            $11::timestamptz AS tomorrow_start,
            $12::timestamptz AS now_at
        ),
        product_event_counts AS (
          SELECT
            COUNT(DISTINCT user_id) FILTER (
              WHERE event_type = 'skin_profile_created'
            )::int AS skin_profile_users,
            COUNT(DISTINCT user_id) FILTER (
              WHERE event_type = 'inventory_product_created'
            )::int AS product_users,
            COUNT(DISTINCT user_id) FILTER (
              WHERE event_type = 'schedule_slot_created'
            )::int AS schedule_users,
            COUNT(DISTINCT user_id) FILTER (
              WHERE event_type = 'suggestion_generated'
            )::int AS suggestion_generated_users,
            COUNT(DISTINCT user_id) FILTER (
              WHERE event_type = 'routine_logged'
            )::int AS routine_users,
            COUNT(DISTINCT user_id) FILTER (
              WHERE event_type = 'journal_check_in_created'
                AND occurred_at >= bounds.since_day
            )::int AS daily_checkin_users,
            COUNT(DISTINCT user_id) FILTER (
              WHERE event_type = 'journal_check_in_created'
                AND occurred_at >= bounds.since_week
            )::int AS weekly_checkin_users,
            COUNT(DISTINCT user_id) FILTER (
              WHERE event_type = 'journal_check_in_created'
            )::int AS journal_users,
            COUNT(DISTINCT user_id) FILTER (
              WHERE event_type = 'notification_preferences_enabled'
            )::int AS notification_users,
            COUNT(DISTINCT user_id) FILTER (
              WHERE event_type IN (
                'smart_pick_snapshot_generated',
                'smart_pick_product_generated'
              )
            )::int AS smart_pick_users
          FROM product_analytics_events, bounds
          WHERE event_type IN (
            'skin_profile_created',
            'inventory_product_created',
            'schedule_slot_created',
            'suggestion_generated',
            'routine_logged',
            'journal_check_in_created',
            'notification_preferences_enabled',
            'smart_pick_snapshot_generated',
            'smart_pick_product_generated'
          )
        ),
        active_session_days AS (
          SELECT DISTINCT
            auth_sessions.user_id,
            date_trunc('day', auth_sessions.last_used_at)::date AS active_day
          FROM auth_sessions, bounds
          WHERE auth_sessions.revoked_at IS NULL
            AND auth_sessions.last_used_at >= bounds.trend_start - interval '29 days'
            AND auth_sessions.last_used_at < bounds.tomorrow_start
        ),
        counts AS (
          SELECT
            (SELECT COUNT(*) FROM users)::int AS registered_users,
            (SELECT COUNT(*) FROM users WHERE email_verified = true)::int AS verified_users,
            (
              SELECT COUNT(*)
              FROM users, bounds
              WHERE users.created_at >= bounds.today_start
                AND users.created_at < bounds.tomorrow_start
            )::int AS new_signups_today,
            (
              SELECT COUNT(*)
              FROM users, bounds
              WHERE users.created_at >= bounds.since_week
            )::int AS new_signups_7d,
            (
              SELECT COUNT(*)
              FROM users, bounds
              WHERE users.created_at >= bounds.since_thirty_days
            )::int AS new_signups_30d,
            (
              SELECT COUNT(DISTINCT user_id)
              FROM auth_sessions, bounds
              WHERE revoked_at IS NULL AND last_used_at >= bounds.since_day
            )::int AS daily_active_users,
            (
              SELECT COUNT(DISTINCT user_id)
              FROM auth_sessions, bounds
              WHERE revoked_at IS NULL AND last_used_at >= bounds.since_week
            )::int AS weekly_active_users,
            (
              SELECT COUNT(DISTINCT user_id)
              FROM auth_sessions, bounds
              WHERE revoked_at IS NULL AND last_used_at >= bounds.since_thirty_days
            )::int AS monthly_active_users,
            product_event_counts.skin_profile_users,
            product_event_counts.product_users,
            product_event_counts.schedule_users,
            (
              SELECT COUNT(*)
              FROM suggestion_instances
              WHERE generation_status = $4
            )::int AS suggestion_ready_count,
            product_event_counts.suggestion_generated_users,
            (
              SELECT COUNT(*)
              FROM suggestion_instances
              WHERE generation_status = $13
            )::int AS suggestion_failed_count,
            product_event_counts.routine_users,
            (
              SELECT COUNT(*)
              FROM application_logs
            )::int AS routine_recorded_count,
            product_event_counts.daily_checkin_users,
            product_event_counts.weekly_checkin_users,
            product_event_counts.journal_users,
            product_event_counts.notification_users,
            product_event_counts.smart_pick_users,
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
              FROM user_data_access_logs, bounds
              WHERE created_at >= bounds.since_day
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
              SELECT COUNT(*)
              FROM skin_journal_insight_generation_runs
              WHERE status = $16
            )::int AS insight_completed_count,
            (
              SELECT COUNT(*)
              FROM skin_journal_insight_generation_runs
              WHERE status = $17
            )::int AS insight_failed_count,
            (
              SELECT COALESCE(SUM(analysis_estimated_cost_usd), 0)
              FROM skin_journal_entries, bounds
              WHERE analysis_started_at >= bounds.today_start
                AND analysis_started_at < bounds.tomorrow_start
                AND analysis_estimated_cost_usd IS NOT NULL
            )::float AS journal_ai_cost_today,
            (
              SELECT COALESCE(SUM(analysis_estimated_cost_usd), 0)
              FROM skin_journal_entries, bounds
              WHERE analysis_started_at >= bounds.since_month
                AND analysis_estimated_cost_usd IS NOT NULL
            )::float AS journal_ai_cost_mtd,
            (
              SELECT COALESCE(SUM(ai_estimated_cost_usd), 0)
              FROM skin_journal_insight_generation_runs, bounds
              WHERE completed_at >= bounds.today_start
                AND completed_at < bounds.tomorrow_start
                AND ai_estimated_cost_usd IS NOT NULL
            )::float AS journal_insights_ai_cost_today,
            (
              SELECT COALESCE(SUM(ai_estimated_cost_usd), 0)
              FROM skin_journal_insight_generation_runs, bounds
              WHERE completed_at >= bounds.since_month
                AND ai_estimated_cost_usd IS NOT NULL
            )::float AS journal_insights_ai_cost_mtd,
            (
              SELECT COALESCE(SUM(ai_estimated_cost_usd), 0)
              FROM suggestion_instances, bounds
              WHERE generated_at >= bounds.today_start
                AND generated_at < bounds.tomorrow_start
                AND ai_estimated_cost_usd IS NOT NULL
            )::float AS suggestion_ai_cost_today,
            (
              SELECT COALESCE(SUM(ai_estimated_cost_usd), 0)
              FROM suggestion_instances, bounds
              WHERE generated_at >= bounds.since_month
                AND ai_estimated_cost_usd IS NOT NULL
            )::float AS suggestion_ai_cost_mtd,
            (
              SELECT COUNT(*)
              FROM product_check_ai_review_metrics
              WHERE status = 'reviewed'
            )::int AS product_check_reviewed_count,
            (
              SELECT COUNT(*)
              FROM product_check_ai_review_metrics
              WHERE status <> 'reviewed'
            )::int AS product_check_failed_count,
            (
              SELECT COALESCE(SUM(ai_estimated_cost_usd), 0)
              FROM product_check_ai_review_metrics, bounds
              WHERE occurred_at >= bounds.today_start
                AND occurred_at < bounds.tomorrow_start
                AND ai_estimated_cost_usd IS NOT NULL
            )::float AS product_check_ai_cost_today,
            (
              SELECT COALESCE(SUM(ai_estimated_cost_usd), 0)
              FROM product_check_ai_review_metrics, bounds
              WHERE occurred_at >= bounds.since_month
                AND ai_estimated_cost_usd IS NOT NULL
            )::float AS product_check_ai_cost_mtd,
            (
              SELECT COUNT(*)
              FROM smart_pick_generation_jobs
              WHERE status = $14
            )::int AS smart_pick_completed_count,
            (
              SELECT COUNT(*)
              FROM smart_pick_generation_jobs
              WHERE status = $15
            )::int AS smart_pick_failed_count,
            (
              SELECT COALESCE(SUM(cost_usd), 0)
              FROM (
                SELECT ai_estimated_cost_usd AS cost_usd
                FROM smart_pick_snapshots, bounds
                WHERE generated_at >= bounds.today_start
                  AND generated_at < bounds.tomorrow_start
                  AND ai_estimated_cost_usd IS NOT NULL
                UNION ALL
                SELECT ai_estimated_cost_usd AS cost_usd
                FROM smart_pick_generation_jobs, bounds
                WHERE updated_at >= bounds.today_start
                  AND updated_at < bounds.tomorrow_start
                  AND ai_estimated_cost_usd IS NOT NULL
              ) smart_pick_costs
            )::float AS smart_pick_ai_cost_today,
            (
              SELECT COALESCE(SUM(cost_usd), 0)
              FROM (
                SELECT ai_estimated_cost_usd AS cost_usd
                FROM smart_pick_snapshots, bounds
                WHERE generated_at >= bounds.since_month
                  AND ai_estimated_cost_usd IS NOT NULL
                UNION ALL
                SELECT ai_estimated_cost_usd AS cost_usd
                FROM smart_pick_generation_jobs, bounds
                WHERE updated_at >= bounds.since_month
                  AND ai_estimated_cost_usd IS NOT NULL
              ) smart_pick_costs
            )::float AS smart_pick_ai_cost_mtd
          FROM product_event_counts
        )
        SELECT
          counts.*,
          (
            WITH days AS (
              SELECT generate_series(
                (SELECT trend_start FROM bounds)::date,
                (SELECT today_start FROM bounds)::date,
                interval '1 day'
              )::date AS day
            ),
            signups AS (
              SELECT date_trunc('day', occurred_at)::date AS day, COUNT(*)::int AS count
              FROM product_analytics_events, bounds
              WHERE event_type = 'account_created'
                AND occurred_at >= bounds.trend_start
                AND occurred_at < bounds.tomorrow_start
              GROUP BY 1
            )
            SELECT COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'date', days.day::text,
                  'count', COALESCE(signups.count, 0)
                )
                ORDER BY days.day
              ),
              '[]'::jsonb
            )
            FROM days
            LEFT JOIN signups ON signups.day = days.day
          ) AS signup_trend,
          (
            WITH days AS (
              SELECT generate_series(
                (SELECT trend_start FROM bounds)::date,
                (SELECT today_start FROM bounds)::date,
                interval '1 day'
              )::date AS day
            )
            SELECT COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'date', days.day::text,
                  'dailyActiveUsers', COALESCE(daily.count, 0),
                  'weeklyActiveUsers', COALESCE(weekly.count, 0),
                  'monthlyActiveUsers', COALESCE(monthly.count, 0)
                )
                ORDER BY days.day
              ),
              '[]'::jsonb
            )
            FROM days
            LEFT JOIN LATERAL (
              SELECT COUNT(DISTINCT user_id)::int AS count
              FROM active_session_days
              WHERE active_day = days.day
            ) daily ON TRUE
            LEFT JOIN LATERAL (
              SELECT COUNT(DISTINCT user_id)::int AS count
              FROM active_session_days
              WHERE active_day >= days.day - 6
                AND active_day <= days.day
            ) weekly ON TRUE
            LEFT JOIN LATERAL (
              SELECT COUNT(DISTINCT user_id)::int AS count
              FROM active_session_days
              WHERE active_day >= days.day - 29
                AND active_day <= days.day
            ) monthly ON TRUE
          ) AS active_user_trend,
          (
            WITH endpoint_rollup AS (
              SELECT
                method,
                route,
                COUNT(*)::int AS request_count,
                ROUND(
                  (
                    SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END)::numeric
                    / NULLIF(COUNT(*), 0)
                  ) * 100,
                  2
                )::float AS error_rate,
                COALESCE(
                  percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms),
                  0
                )::int AS p95_latency_ms
              FROM http_request_metrics, bounds
              WHERE occurred_at >= bounds.since_day
              GROUP BY method, route
              ORDER BY error_rate DESC, p95_latency_ms DESC, request_count DESC
              LIMIT 8
            )
            SELECT COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'method', endpoint_rollup.method,
                  'route', endpoint_rollup.route,
                  'requestCount', endpoint_rollup.request_count,
                  'errorRate', endpoint_rollup.error_rate,
                  'p95LatencyMs', endpoint_rollup.p95_latency_ms
                )
                ORDER BY
                  endpoint_rollup.error_rate DESC,
                  endpoint_rollup.p95_latency_ms DESC,
                  endpoint_rollup.request_count DESC
              ),
              '[]'::jsonb
            )
            FROM endpoint_rollup
          ) AS endpoint_health,
          (
            SELECT jsonb_build_array(
              jsonb_build_object(
                'id', 'day_1',
                'label', 'Day 1',
                'eligibleUsers', (
                  SELECT COUNT(*)::int
                  FROM product_analytics_events accounts, bounds
                  WHERE accounts.event_type = 'account_created'
                    AND accounts.occurred_at <= bounds.now_at - interval '1 day'
                ),
                'retainedUsers', (
                  SELECT COUNT(*)::int
                  FROM product_analytics_events accounts, bounds
                  WHERE accounts.event_type = 'account_created'
                    AND accounts.occurred_at <= bounds.now_at - interval '1 day'
                    AND EXISTS (
                      SELECT 1
                      FROM product_analytics_events actions
                      WHERE actions.user_id = accounts.user_id
                        AND actions.event_type <> 'account_created'
                        AND actions.occurred_at >= accounts.occurred_at + interval '1 day'
                        AND actions.occurred_at < accounts.occurred_at + interval '2 day'
                    )
                )
              ),
              jsonb_build_object(
                'id', 'day_7',
                'label', 'Day 7',
                'eligibleUsers', (
                  SELECT COUNT(*)::int
                  FROM product_analytics_events accounts, bounds
                  WHERE accounts.event_type = 'account_created'
                    AND accounts.occurred_at <= bounds.now_at - interval '7 days'
                ),
                'retainedUsers', (
                  SELECT COUNT(*)::int
                  FROM product_analytics_events accounts, bounds
                  WHERE accounts.event_type = 'account_created'
                    AND accounts.occurred_at <= bounds.now_at - interval '7 days'
                    AND EXISTS (
                      SELECT 1
                      FROM product_analytics_events actions
                      WHERE actions.user_id = accounts.user_id
                        AND actions.event_type <> 'account_created'
                        AND actions.occurred_at >= accounts.occurred_at + interval '7 days'
                        AND actions.occurred_at < accounts.occurred_at + interval '8 days'
                    )
                )
              ),
              jsonb_build_object(
                'id', 'day_30',
                'label', 'Day 30',
                'eligibleUsers', (
                  SELECT COUNT(*)::int
                  FROM product_analytics_events accounts, bounds
                  WHERE accounts.event_type = 'account_created'
                    AND accounts.occurred_at <= bounds.now_at - interval '30 days'
                ),
                'retainedUsers', (
                  SELECT COUNT(*)::int
                  FROM product_analytics_events accounts, bounds
                  WHERE accounts.event_type = 'account_created'
                    AND accounts.occurred_at <= bounds.now_at - interval '30 days'
                    AND EXISTS (
                      SELECT 1
                      FROM product_analytics_events actions
                      WHERE actions.user_id = accounts.user_id
                        AND actions.event_type <> 'account_created'
                        AND actions.occurred_at >= accounts.occurred_at + interval '30 days'
                        AND actions.occurred_at < accounts.occurred_at + interval '31 days'
                    )
                )
              )
            )
          ) AS retention_cohorts
        FROM counts
      `,
      [
        sinceWeek,
        sinceDay,
        sinceMonth,
        SuggestionGenerationStatus.Ready,
        ExportStatusValue.Failed,
        AnalysisStatusValue.Completed,
        AnalysisStatusValue.Failed,
        sinceThirtyDays,
        todayStart,
        trendStart,
        tomorrowStart,
        now,
        SuggestionGenerationStatus.Failed,
        SmartPicksGenerationJobStatus.Completed,
        SmartPicksGenerationJobStatus.Failed,
        InsightGenerationStatusValue.Completed,
        InsightGenerationStatusValue.Failed,
      ],
    );
    const jobHealth = await this.getJobHealthSummaries(now);

    return this.buildOverview(metricsRow, jobHealth, now);
  }

  async listAiCostByUsers(
    query: AdminAiCostUserListQuery = {},
    now = new Date(),
  ): Promise<AdminAiCostByUserListResponse> {
    const pagination = normalizePagination({
      defaultLimit: ADMIN_AI_COST_USERS_DEFAULT_LIMIT,
      limit: query.limit,
      maxLimit: ADMIN_AI_COST_USERS_MAX_LIMIT,
      page: query.page,
    });
    const sinceMonth = monthStart(now);
    const todayStart = dayStart(now);
    const tomorrowStart = addDays(todayStart, 1);
    const feature = normalizeAiCostFeature(query.feature);
    const period = normalizeAiCostPeriod(query.period);
    const spendColumn = getAiCostSpendColumn(period);
    const orderBy = getAiCostOrderBy(period);
    const params: Array<Date | number | string> = [
      sinceMonth,
      todayStart,
      tomorrowStart,
    ];
    const search = normalizeSearch(query.query);
    let candidateUsersCte = '';
    if (search) {
      params.push(`%${escapeLikePattern(search)}%`);
      const searchIndex = params.length;
      candidateUsersCte = `
        candidate_users AS (
          SELECT id, email, first_name, last_name
          FROM users
          WHERE canonical_email ILIKE $${searchIndex} ESCAPE '\\'
            OR first_name ILIKE $${searchIndex} ESCAPE '\\'
            OR last_name ILIKE $${searchIndex} ESCAPE '\\'
        ),
      `;
    }
    const joinCandidateUsers = (tableAlias: string) =>
      search
        ? `INNER JOIN candidate_users cost_users ON cost_users.id = ${tableAlias}.user_id`
        : '';
    const requireUserId = (tableAlias: string) =>
      search ? '' : `AND ${tableAlias}.user_id IS NOT NULL`;
    const finalUsersSource = search ? 'candidate_users' : 'users';
    const featureRollupSelects = getAiCostFeaturesForFilter(feature)
      .map((selectedFeature) =>
        ADMIN_AI_COST_ROLLUP_SQL[selectedFeature](
          joinCandidateUsers,
          requireUserId,
        ),
      )
      .join('\n          UNION ALL\n');

    params.push(pagination.limit);
    const limitIndex = params.length;
    params.push(pagination.offset);
    const offsetIndex = params.length;

    const rows: unknown = await this.dataSource.query(
      `
        WITH bounds AS (
          SELECT
            $1::timestamptz AS since_month,
            $2::timestamptz AS today_start,
            $3::timestamptz AS tomorrow_start
        ),
        ${candidateUsersCte}
        feature_rollups AS (
          ${featureRollupSelects}
        ),
        rollup AS (
          SELECT
            user_id,
            COALESCE(SUM(month_to_date_cost_usd), 0)::float AS month_to_date_cost_usd,
            COALESCE(SUM(today_cost_usd), 0)::float AS today_cost_usd,
            COALESCE(SUM(month_to_date_cost_usd) FILTER (WHERE feature = 'journal_analysis'), 0)::float AS journal_analysis_cost_mtd,
            COALESCE(SUM(today_cost_usd) FILTER (WHERE feature = 'journal_analysis'), 0)::float AS journal_analysis_cost_today,
            COALESCE(SUM(month_to_date_cost_usd) FILTER (WHERE feature = 'daily_suggestions'), 0)::float AS daily_suggestions_cost_mtd,
            COALESCE(SUM(today_cost_usd) FILTER (WHERE feature = 'daily_suggestions'), 0)::float AS daily_suggestions_cost_today,
            COALESCE(SUM(month_to_date_cost_usd) FILTER (WHERE feature = 'journal_insights'), 0)::float AS journal_insights_cost_mtd,
            COALESCE(SUM(today_cost_usd) FILTER (WHERE feature = 'journal_insights'), 0)::float AS journal_insights_cost_today,
            COALESCE(SUM(month_to_date_cost_usd) FILTER (WHERE feature = 'quick_check'), 0)::float AS quick_check_cost_mtd,
            COALESCE(SUM(today_cost_usd) FILTER (WHERE feature = 'quick_check'), 0)::float AS quick_check_cost_today,
            COALESCE(SUM(month_to_date_cost_usd) FILTER (WHERE feature = 'smart_picks'), 0)::float AS smart_picks_cost_mtd,
            COALESCE(SUM(today_cost_usd) FILTER (WHERE feature = 'smart_picks'), 0)::float AS smart_picks_cost_today
          FROM feature_rollups
          GROUP BY user_id
        )
        SELECT
          COUNT(*) OVER()::int AS total_count,
          users.id AS user_id,
          users.email,
          users.first_name,
          users.last_name,
          rollup.month_to_date_cost_usd,
          rollup.today_cost_usd,
          rollup.journal_analysis_cost_mtd,
          rollup.journal_analysis_cost_today,
          rollup.daily_suggestions_cost_mtd,
          rollup.daily_suggestions_cost_today,
          rollup.journal_insights_cost_mtd,
          rollup.journal_insights_cost_today,
          rollup.quick_check_cost_mtd,
          rollup.quick_check_cost_today,
          rollup.smart_picks_cost_mtd,
          rollup.smart_picks_cost_today
        FROM rollup
        INNER JOIN ${finalUsersSource} users ON users.id = rollup.user_id
        WHERE rollup.${spendColumn} > 0
        ORDER BY ${orderBy}, users.id ASC
        LIMIT $${limitIndex}
        OFFSET $${offsetIndex}
      `,
      params,
    );
    const queryRows = toQueryRows(rows);
    const total = toNumber(queryRows[0]?.total_count);

    return {
      ...buildPaginationMeta(total, pagination),
      users: queryRows.map((row) => this.toAiCostByUserResponse(row)),
    };
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

  async listUserNotes(
    userId: string,
    query: AdminUserNoteListQuery = {},
  ): Promise<AdminUserNoteListResponse> {
    await this.ensureUserExists(userId);

    const pagination = normalizePagination({
      defaultLimit: ADMIN_USER_NOTES_DEFAULT_LIMIT,
      limit: query.limit,
      maxLimit: ADMIN_USER_NOTES_MAX_LIMIT,
      page: query.page,
    });
    const notesRepository = this.dataSource.getRepository(AdminUserNote);
    const [notes, total] = await notesRepository.findAndCount({
      order: { created_at: 'DESC', id: 'DESC' },
      skip: pagination.offset,
      take: pagination.limit,
      where: { user_id: userId },
    });
    const authors = await this.getNoteAuthors(
      notes.map((note) => note.author_admin_id),
    );

    return {
      notes: notes.map((note) => this.toAdminUserNoteResponse(note, authors)),
      ...buildPaginationMeta(total, pagination),
    };
  }

  async createUserNote(
    actor: AdminAuthenticatedUser,
    userId: string,
    input: { body: string },
    context: AdminRequestContext,
  ): Promise<AdminUserNoteResponse> {
    const body = this.normalizeUserNoteBody(input.body);

    return this.runUserMutation(async (repositories) => {
      const user = await this.findUserForAdminMutation(
        repositories.usersRepository,
        userId,
      );
      const note = repositories.notesRepository.create({
        author_admin_id: actor.id,
        body,
        user_id: user.id,
      });
      const savedNote = await repositories.notesRepository.save(note);

      await this.writeUserAuditLog(repositories.auditLogsRepository, {
        action: AdminAuditAction.UserNoteCreated,
        actor,
        context: {
          ...context,
          reason: 'Internal account note added',
        },
        metadata: {
          noteId: savedNote.id,
          userEmail: user.email,
        },
        targetUserId: user.id,
      });

      return this.toAdminUserNoteResponse(
        savedNote,
        new Map([
          [
            actor.id,
            {
              email: actor.email,
              id: actor.id,
              name: actor.name,
            },
          ],
        ]),
      );
    });
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
    const filteredLogJoins: string[] = [];

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
      filteredLogJoins.push(`
        JOIN admin_accounts actor ON actor.id = logs.actor_admin_id
        LEFT JOIN admin_accounts target_admin
          ON target_admin.id = logs.target_admin_id
        LEFT JOIN users target_user ON target_user.id = logs.target_user_id
      `);
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
            logs.created_at
          FROM admin_audit_logs logs
          ${filteredLogJoins.join('\n')}
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
        SELECT
          counted_logs.total_count,
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
        FROM counted_logs
        LEFT JOIN paged_logs ON true
        LEFT JOIN admin_audit_logs logs ON logs.id = paged_logs.id
        LEFT JOIN admin_accounts actor ON actor.id = logs.actor_admin_id
        LEFT JOIN admin_accounts target_admin
          ON target_admin.id = logs.target_admin_id
        LEFT JOIN users target_user ON target_user.id = logs.target_user_id
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
    const [jobHealth, compliance, workItems, backendHealth] = await Promise.all(
      [
        this.getJobHealthSummaries(now),
        this.getOperationsCompliance(now),
        this.getOperationalWorkItems(now),
        this.getBackendHealth(now),
      ],
    );

    return {
      backendHealth,
      compliance,
      generatedAt: now.toISOString(),
      jobHealth,
      workItems,
    };
  }

  async listOperationalIncidents(
    query: AdminOperationalIncidentListQuery = {},
  ): Promise<AdminOperationalIncidentListResponse> {
    const pagination = normalizePagination({
      defaultLimit: ADMIN_OPERATIONAL_INCIDENTS_DEFAULT_LIMIT,
      limit: query.limit,
      maxLimit: ADMIN_OPERATIONAL_INCIDENTS_MAX_LIMIT,
      page: query.page,
    });
    const incidentsRepository = this.dataSource.getRepository(
      AdminOperationalIncident,
    );
    const where =
      query.status && query.status !== AdminOperationalIncidentStatusFilter.All
        ? {
            status:
              query.status === AdminOperationalIncidentStatusFilter.Resolved
                ? AdminOperationalIncidentStatus.Resolved
                : AdminOperationalIncidentStatus.Open,
          }
        : {};
    const [incidents, total] = await incidentsRepository.findAndCount({
      order: { created_at: 'DESC', id: 'DESC' },
      skip: pagination.offset,
      take: pagination.limit,
      where,
    });
    const [admins, users] = await Promise.all([
      this.getIncidentAdmins(incidents),
      this.getIncidentUsers(incidents),
    ]);

    return {
      incidents: incidents.map((incident) =>
        this.toOperationalIncidentResponse(incident, admins, users),
      ),
      ...buildPaginationMeta(total, pagination),
    };
  }

  async createOperationalIncident(
    actor: AdminAuthenticatedUser,
    input: {
      description: string;
      severity: AdminOperationalIncidentSeverity;
      sourceId: string;
      sourceType: string;
      targetUserId?: string | null;
      title: string;
    },
    context: AdminRequestContext,
  ): Promise<AdminOperationalIncidentResponse> {
    const title = this.normalizeOperationalIncidentText(
      input.title,
      'Operational incident title is required',
      ADMIN_OPERATIONAL_INCIDENT_TITLE_MAX_LENGTH,
    );
    const description = this.normalizeOperationalIncidentText(
      input.description,
      'Operational incident description is required',
      ADMIN_OPERATIONAL_INCIDENT_DESCRIPTION_MAX_LENGTH,
      8,
    );
    const sourceType = this.normalizeOperationalIncidentText(
      input.sourceType,
      'Operational incident source type is required',
      80,
      2,
    );
    const sourceId = this.normalizeOperationalIncidentText(
      input.sourceId,
      'Operational incident source id is required',
      120,
    );
    const severity = this.normalizeOperationalIncidentSeverity(input.severity);

    return this.runUserMutation(async (repositories) => {
      const existingIncident = await repositories.incidentsRepository.findOne({
        where: {
          source_id: sourceId,
          source_type: sourceType,
          status: AdminOperationalIncidentStatus.Open,
        },
      });
      if (existingIncident) {
        throw new ConflictException(
          'An open incident already exists for this work item',
        );
      }

      const targetUser = input.targetUserId
        ? await this.findUserForAdminMutation(
            repositories.usersRepository,
            input.targetUserId,
          )
        : null;
      const incident = repositories.incidentsRepository.create({
        created_by_admin_id: actor.id,
        description,
        resolution_summary: null,
        resolved_at: null,
        resolved_by_admin_id: null,
        severity,
        source_id: sourceId,
        source_type: sourceType,
        status: AdminOperationalIncidentStatus.Open,
        target_user_id: targetUser?.id ?? null,
        title,
      });
      let savedIncident: AdminOperationalIncident;
      try {
        savedIncident = await repositories.incidentsRepository.save(incident);
      } catch (error) {
        if (isPostgresUniqueConstraintError(error)) {
          throw new ConflictException(
            'An open incident already exists for this work item',
          );
        }

        throw error;
      }

      await this.writeUserAuditLog(repositories.auditLogsRepository, {
        action: AdminAuditAction.OperationalIncidentCreated,
        actor,
        context: {
          ...context,
          reason: 'Operational incident opened',
        },
        metadata: {
          incidentId: savedIncident.id,
          severity,
          sourceId,
          sourceType,
          title,
          ...(targetUser ? { userEmail: targetUser.email } : {}),
        },
        targetUserId: targetUser?.id ?? null,
      });

      return this.toOperationalIncidentResponse(
        savedIncident,
        this.actorMap(actor),
        targetUser ? this.userMap(targetUser) : new Map(),
      );
    });
  }

  async resolveOperationalIncident(
    actor: AdminAuthenticatedUser,
    incidentId: string,
    input: { resolutionSummary: string },
    context: AdminRequestContext,
  ): Promise<AdminOperationalIncidentResponse> {
    const resolutionSummary = this.normalizeOperationalIncidentText(
      input.resolutionSummary,
      'Operational incident resolution is required',
      ADMIN_OPERATIONAL_INCIDENT_DESCRIPTION_MAX_LENGTH,
      8,
    );

    return this.runUserMutation(async (repositories) => {
      const incident = await repositories.incidentsRepository.findOne({
        where: { id: incidentId },
      });
      if (!incident) {
        throw new NotFoundException('Operational incident not found');
      }

      if (incident.status !== AdminOperationalIncidentStatus.Resolved) {
        incident.status = AdminOperationalIncidentStatus.Resolved;
        incident.resolved_at = new Date();
        incident.resolved_by_admin_id = actor.id;
        incident.resolution_summary = resolutionSummary;
        await repositories.incidentsRepository.save(incident);

        await this.writeUserAuditLog(repositories.auditLogsRepository, {
          action: AdminAuditAction.OperationalIncidentResolved,
          actor,
          context: {
            ...context,
            reason: 'Operational incident resolved',
          },
          metadata: {
            incidentId: incident.id,
            sourceId: incident.source_id,
            sourceType: incident.source_type,
            title: incident.title,
          },
          targetUserId: incident.target_user_id,
        });
      }

      const targetUser = incident.target_user_id
        ? await repositories.usersRepository.findOne({
            where: { id: incident.target_user_id },
          })
        : null;
      const admins = await this.getIncidentAdmins([incident]);
      if (!admins.has(actor.id)) {
        admins.set(actor.id, {
          email: actor.email,
          id: actor.id,
          name: actor.name,
        });
      }

      return this.toOperationalIncidentResponse(
        incident,
        admins,
        targetUser ? this.userMap(targetUser) : new Map(),
      );
    });
  }

  async restrictUser(
    actor: AdminAuthenticatedUser,
    userId: string,
    context: AdminUserAuditContext,
  ): Promise<AdminUserResponse> {
    const reason = this.normalizeAuditReason(context.reason);

    return this.runUserMutation(async (repositories) => {
      const user = await this.findUserForAdminMutation(
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
      const user = await this.findUserForAdminMutation(
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

  private async getJobHealthSummaries(
    now: Date,
  ): Promise<AdminOverviewResponse['jobHealth']> {
    const rows = toQueryRows(
      await this.dataSource.query(
        `
        SELECT
          id,
          label,
          queued,
          failed,
          oldest_queued_age_seconds
        FROM (
          SELECT
            0 AS sort_order,
            'journal-analysis' AS id,
            'Journal analysis' AS label,
            COUNT(*) FILTER (WHERE status = ANY($1::text[]))::int AS queued,
            COUNT(*) FILTER (WHERE status = $2)::int AS failed,
            FLOOR(
              EXTRACT(
                EPOCH FROM (
                  $7::timestamptz -
                  MIN(run_after) FILTER (WHERE status = ANY($1::text[]))
                )
              )
            )::int AS oldest_queued_age_seconds
          FROM skin_journal_analysis_jobs

          UNION ALL

          SELECT
            1 AS sort_order,
            'smart-picks' AS id,
            'Smart Picks' AS label,
            COUNT(*) FILTER (WHERE status = ANY($3::text[]))::int AS queued,
            COUNT(*) FILTER (WHERE status = $4)::int AS failed,
            FLOOR(
              EXTRACT(
                EPOCH FROM (
                  $7::timestamptz -
                  MIN(run_after) FILTER (WHERE status = ANY($3::text[]))
                )
              )
            )::int AS oldest_queued_age_seconds
          FROM smart_pick_generation_jobs

          UNION ALL

          SELECT
            2 AS sort_order,
            'suggestions' AS id,
            'Daily suggestions' AS label,
            COUNT(*) FILTER (WHERE status = ANY($5::text[]))::int AS queued,
            COUNT(*) FILTER (WHERE status = $6)::int AS failed,
            FLOOR(
              EXTRACT(
                EPOCH FROM (
                  $7::timestamptz -
                  MIN(run_after) FILTER (WHERE status = ANY($5::text[]))
                )
              )
            )::int AS oldest_queued_age_seconds
          FROM suggestion_generation_jobs
        ) job_health
        ORDER BY sort_order
      `,
        [
          [...JOB_HEALTH_CONFIGS[0].activeStatuses],
          JOB_HEALTH_CONFIGS[0].failedStatus,
          [...JOB_HEALTH_CONFIGS[1].activeStatuses],
          JOB_HEALTH_CONFIGS[1].failedStatus,
          [...JOB_HEALTH_CONFIGS[2].activeStatuses],
          JOB_HEALTH_CONFIGS[2].failedStatus,
          now,
        ],
      ),
    );
    const healthById = new Map(rows.map((row) => [toStringValue(row.id), row]));

    return JOB_HEALTH_CONFIGS.map((config) => {
      const row = healthById.get(config.id) ?? {};
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
    });
  }

  private buildOverview(
    row: QueryRow,
    jobHealth: AdminOverviewResponse['jobHealth'],
    now: Date,
  ): AdminOverviewResponse {
    const registeredUsers = toNumber(row.registered_users);
    const verifiedUsers = toNumber(row.verified_users);
    const newSignupsToday = toNumber(row.new_signups_today);
    const newSignups7d = toNumber(row.new_signups_7d);
    const newSignups30d = toNumber(row.new_signups_30d);
    const dailyActiveUsers = toNumber(row.daily_active_users);
    const weeklyActiveUsers = toNumber(row.weekly_active_users);
    const monthlyActiveUsers = toNumber(row.monthly_active_users);
    const skinProfileUsers = toNumber(row.skin_profile_users);
    const productUsers = toNumber(row.product_users);
    const scheduleUsers = toNumber(row.schedule_users);
    const routineUsers = toNumber(row.routine_users);
    const routineRecordedCount = toNumber(row.routine_recorded_count);
    const suggestionReadyCount = toNumber(row.suggestion_ready_count);
    const suggestionFailedCount = toNumber(row.suggestion_failed_count);
    const suggestionGeneratedUsers = toNumber(row.suggestion_generated_users);
    const dailyCheckinUsers = toNumber(row.daily_checkin_users);
    const journalUsers = toNumber(row.journal_users);
    const notificationUsers = toNumber(row.notification_users);
    const smartPickUsers = toNumber(row.smart_pick_users);
    const analysisCompletedCount = toNumber(row.analysis_completed_count);
    const analysisFailedCount = toNumber(row.analysis_failed_count);
    const insightCompletedCount = toNumber(row.insight_completed_count);
    const insightFailedCount = toNumber(row.insight_failed_count);
    const productCheckReviewedCount = toNumber(
      row.product_check_reviewed_count,
    );
    const productCheckFailedCount = toNumber(row.product_check_failed_count);
    const smartPickCompletedCount = toNumber(row.smart_pick_completed_count);
    const smartPickFailedCount = toNumber(row.smart_pick_failed_count);
    const failedExportCount = toNumber(row.failed_export_count);
    const pendingDeletionCount = toNumber(row.pending_deletion_count);
    const sensitiveAccessEvents24h = toNumber(row.sensitive_access_events_24h);
    const activeRestrictions = toNumber(row.active_restrictions);
    const aiSuccessfulCount =
      analysisCompletedCount +
      suggestionReadyCount +
      insightCompletedCount +
      productCheckReviewedCount +
      smartPickCompletedCount;
    const aiFailedCount =
      analysisFailedCount +
      suggestionFailedCount +
      insightFailedCount +
      productCheckFailedCount +
      smartPickFailedCount;
    const aiTotalCount = aiSuccessfulCount + aiFailedCount;
    const todayAiCostUsd =
      toNumber(row.journal_ai_cost_today) +
      toNumber(row.suggestion_ai_cost_today) +
      toNumber(row.journal_insights_ai_cost_today) +
      toNumber(row.product_check_ai_cost_today) +
      toNumber(row.smart_pick_ai_cost_today);
    const monthToDateAiCostUsd =
      toNumber(row.journal_ai_cost_mtd) +
      toNumber(row.suggestion_ai_cost_mtd) +
      toNumber(row.journal_insights_ai_cost_mtd) +
      toNumber(row.product_check_ai_cost_mtd) +
      toNumber(row.smart_pick_ai_cost_mtd);
    const alerts = this.buildAlerts({
      failedExportCount,
      jobHealth,
      pendingDeletionCount,
      sensitiveAccessEvents24h,
    });
    const endpointHealth = toEndpointHealth(row.endpoint_health);

    return {
      generatedAt: now.toISOString(),
      metrics: {
        activeRestrictions,
        activationRate: percentage(skinProfileUsers, registeredUsers),
        aiSuccessRate: percentage(aiSuccessfulCount, aiTotalCount),
        criticalAlerts: alerts.filter(
          (alert) => alert.severity === AdminAlertSeverity.Critical,
        ).length,
        dailyActiveUsers,
        dailyCheckInRate: percentage(dailyCheckinUsers, registeredUsers),
        monthToDateAiCostUsd,
        monthlyActiveUsers,
        newSignups30d,
        newSignups7d,
        newSignupsToday,
        productAddSuccessRate: percentage(productUsers, registeredUsers),
        registeredUsers,
        routineAcceptanceRate: percentage(
          routineRecordedCount,
          suggestionReadyCount,
        ),
        todayAiCostUsd,
        verifiedUsers,
        weeklyActiveUsers,
      },
      activationFunnel: [
        {
          stage: 'account_created',
          label: 'Account created',
          count: registeredUsers,
        },
        {
          stage: 'email_verified',
          label: 'Email verified',
          count: verifiedUsers,
        },
        {
          stage: 'skin_profile_created',
          label: 'Skin profile created',
          count: skinProfileUsers,
        },
        {
          stage: 'first_product_added',
          label: 'First product added',
          count: productUsers,
        },
        {
          stage: 'first_schedule_slot_created',
          label: 'First schedule slot created',
          count: scheduleUsers,
        },
        {
          stage: 'first_suggestion_generated',
          label: 'First suggestion generated',
          count: suggestionGeneratedUsers,
        },
        {
          stage: 'first_suggestion_recorded',
          label: 'First suggestion recorded',
          count: routineUsers,
        },
        {
          stage: 'journal_check_in_recorded',
          label: 'Journal check-in recorded',
          count: journalUsers,
        },
        {
          stage: 'notification_preference_enabled',
          label: 'Notification preference enabled',
          count: notificationUsers,
        },
      ],
      signupTrend: toDateCountPoints(row.signup_trend),
      activeUserTrend: toActiveUserTrendPoints(row.active_user_trend),
      retentionCohorts: toRetentionCohorts(row.retention_cohorts),
      featureAdoption: [
        {
          id: 'shelf',
          label: 'Shelf products',
          users: productUsers,
          rate: percentage(productUsers, registeredUsers),
        },
        {
          id: 'schedule',
          label: 'Schedule slots',
          users: scheduleUsers,
          rate: percentage(scheduleUsers, registeredUsers),
        },
        {
          id: 'suggestions',
          label: 'Suggestions generated',
          users: suggestionGeneratedUsers,
          rate: percentage(suggestionGeneratedUsers, registeredUsers),
        },
        {
          id: 'routine_tracking',
          label: 'Routine tracking',
          users: routineUsers,
          rate: percentage(routineUsers, registeredUsers),
        },
        {
          id: 'journal',
          label: 'Skin Journal',
          users: journalUsers,
          rate: percentage(journalUsers, registeredUsers),
        },
        {
          id: 'smart_picks',
          label: 'Smart Picks',
          users: smartPickUsers,
          rate: percentage(smartPickUsers, registeredUsers),
        },
        {
          id: 'notifications',
          label: 'Notification preferences',
          users: notificationUsers,
          rate: percentage(notificationUsers, registeredUsers),
        },
      ],
      aiCostByFeature: [
        {
          id: 'journal_analysis',
          label: 'Journal analysis',
          todayCostUsd: toNumber(row.journal_ai_cost_today),
          monthToDateCostUsd: toNumber(row.journal_ai_cost_mtd),
          successRate: percentage(
            analysisCompletedCount,
            analysisCompletedCount + analysisFailedCount,
          ),
        },
        {
          id: 'daily_suggestions',
          label: 'Daily suggestions',
          todayCostUsd: toNumber(row.suggestion_ai_cost_today),
          monthToDateCostUsd: toNumber(row.suggestion_ai_cost_mtd),
          successRate: percentage(
            suggestionReadyCount,
            suggestionReadyCount + suggestionFailedCount,
          ),
        },
        {
          id: 'journal_insights',
          label: 'AI Insights',
          todayCostUsd: toNumber(row.journal_insights_ai_cost_today),
          monthToDateCostUsd: toNumber(row.journal_insights_ai_cost_mtd),
          successRate: percentage(
            insightCompletedCount,
            insightCompletedCount + insightFailedCount,
          ),
        },
        {
          id: 'quick_check',
          label: 'Quick Check',
          todayCostUsd: toNumber(row.product_check_ai_cost_today),
          monthToDateCostUsd: toNumber(row.product_check_ai_cost_mtd),
          successRate: percentage(
            productCheckReviewedCount,
            productCheckReviewedCount + productCheckFailedCount,
          ),
        },
        {
          id: 'smart_picks',
          label: 'Smart Picks',
          todayCostUsd: toNumber(row.smart_pick_ai_cost_today),
          monthToDateCostUsd: toNumber(row.smart_pick_ai_cost_mtd),
          successRate: percentage(
            smartPickCompletedCount,
            smartPickCompletedCount + smartPickFailedCount,
          ),
        },
      ],
      endpointHealth,
      metricSources: [
        {
          id: 'endpoint_health',
          source:
            endpointHealth.length > 0
              ? AdminMetricSource.Event
              : AdminMetricSource.Unavailable,
        },
        {
          id: 'feature_adoption',
          source: AdminMetricSource.Event,
        },
        {
          id: 'retention',
          source: AdminMetricSource.Event,
        },
        {
          id: 'product_add_success',
          source: AdminMetricSource.Event,
        },
        {
          id: 'smart_picks_ai_cost',
          source: AdminMetricSource.Table,
        },
        {
          id: 'journal_insights_ai_cost',
          source: AdminMetricSource.Table,
        },
        {
          id: 'quick_check_ai_cost',
          source: AdminMetricSource.Table,
        },
      ],
      alerts,
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

  private async getBackendHealth(
    now: Date,
  ): Promise<AdminOperationsMonitoringResponse['backendHealth']> {
    const checkedAt = now.toISOString();
    const [database, userTraffic] = await Promise.all([
      this.getDatabaseHealthComponent(checkedAt),
      this.getUserApiTrafficHealthComponent(now, checkedAt),
    ]);
    const api: AdminOperationsMonitoringResponse['backendHealth']['components'][number] =
      {
        checkedAt,
        errorRate: null,
        id: 'api',
        label: 'Backend API',
        latencyMs: null,
        message: 'The Ritora API process responded to admin monitoring.',
        p95LatencyMs: null,
        requestCount: null,
        status: AdminJobStatus.Healthy,
        windowMinutes: null,
      };
    const components = [api, database, userTraffic];

    return {
      checkedAt,
      components,
      status: resolveAggregateStatus(
        components.map((component) => component.status),
      ),
    };
  }

  private async getDatabaseHealthComponent(
    checkedAt: string,
  ): Promise<
    AdminOperationsMonitoringResponse['backendHealth']['components'][number]
  > {
    const startedAt = Date.now();

    try {
      await this.dataSource.query('SELECT 1');
      const latencyMs = Math.max(Date.now() - startedAt, 0);
      const status = resolveDatabaseStatus(latencyMs);

      return {
        checkedAt,
        errorRate: null,
        id: 'database',
        label: 'Database',
        latencyMs,
        message:
          status === AdminJobStatus.Healthy
            ? 'Database readiness check completed.'
            : 'Database responded, but latency is elevated.',
        p95LatencyMs: null,
        requestCount: null,
        status,
        windowMinutes: null,
      };
    } catch {
      return {
        checkedAt,
        errorRate: null,
        id: 'database',
        label: 'Database',
        latencyMs: Math.max(Date.now() - startedAt, 0),
        message: 'Database readiness check failed.',
        p95LatencyMs: null,
        requestCount: null,
        status: AdminJobStatus.Critical,
        windowMinutes: null,
      };
    }
  }

  private async getUserApiTrafficHealthComponent(
    now: Date,
    checkedAt: string,
  ): Promise<
    AdminOperationsMonitoringResponse['backendHealth']['components'][number]
  > {
    const since = new Date(
      now.getTime() - USER_API_HEALTH_WINDOW_MINUTES * 60 * 1000,
    );

    try {
      const row = await this.queryOne(
        `
          SELECT
            COUNT(*)::int AS request_count,
            COALESCE(
              ROUND(
                (
                  SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END)::numeric
                  / NULLIF(COUNT(*), 0)
                ) * 100,
                2
              ),
              0
            )::float AS error_rate,
            COALESCE(
              percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms),
              0
            )::int AS p95_latency_ms
          FROM http_request_metrics
          WHERE occurred_at >= $1
            AND route NOT LIKE '/admin%'
            AND route NOT LIKE '/api/v1/admin%'
            AND route NOT LIKE '/health%'
            AND route NOT LIKE '/api/v1/health%'
        `,
        [since],
      );
      const requestCount = toNumber(row.request_count);
      const errorRate = toNumber(row.error_rate);
      const p95LatencyMs = toNumber(row.p95_latency_ms);
      const status =
        requestCount === 0
          ? AdminJobStatus.Warning
          : resolveEndpointStatus(errorRate, p95LatencyMs);

      return {
        checkedAt,
        errorRate,
        id: 'user-api-traffic',
        label: 'User API traffic',
        latencyMs: null,
        message:
          requestCount === 0
            ? 'No recent user API traffic has been recorded.'
            : 'Recent user API traffic is being observed.',
        p95LatencyMs,
        requestCount,
        status,
        windowMinutes: USER_API_HEALTH_WINDOW_MINUTES,
      };
    } catch {
      return {
        checkedAt,
        errorRate: null,
        id: 'user-api-traffic',
        label: 'User API traffic',
        latencyMs: null,
        message: 'User API telemetry is unavailable.',
        p95LatencyMs: null,
        requestCount: null,
        status: AdminJobStatus.Warning,
        windowMinutes: USER_API_HEALTH_WINDOW_MINUTES,
      };
    }
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

  private toOperationalIncidentResponse(
    incident: AdminOperationalIncident,
    admins: ReadonlyMap<string, AdminOperationalIncidentActor>,
    users: ReadonlyMap<string, { email: string; id: string }>,
  ): AdminOperationalIncidentResponse {
    const resolvedByAdminId = toNullableString(incident.resolved_by_admin_id);
    const targetUserId = toNullableString(incident.target_user_id);
    const createdBy = admins.get(incident.created_by_admin_id);
    const resolvedBy = resolvedByAdminId ? admins.get(resolvedByAdminId) : null;

    return {
      createdAt: toNullableIso(incident.created_at) ?? toIsoString(new Date(0)),
      createdBy: {
        email: createdBy?.email ?? '',
        id: incident.created_by_admin_id,
        name: createdBy?.name ?? '',
      },
      createdByAdminId: incident.created_by_admin_id,
      description: toStringValue(incident.description),
      id: toStringValue(incident.id),
      resolutionSummary: toNullableString(incident.resolution_summary),
      resolvedAt: toNullableIso(incident.resolved_at),
      resolvedBy: resolvedByAdminId
        ? {
            email: resolvedBy?.email ?? '',
            id: resolvedByAdminId,
            name: resolvedBy?.name ?? '',
          }
        : null,
      resolvedByAdminId,
      severity: incident.severity,
      sourceId: toStringValue(incident.source_id),
      sourceType: toStringValue(incident.source_type),
      status: incident.status,
      targetUserEmail: targetUserId
        ? (users.get(targetUserId)?.email ?? null)
        : null,
      targetUserId,
      title: toStringValue(incident.title),
      updatedAt: toNullableIso(incident.updated_at) ?? toIsoString(new Date(0)),
    };
  }

  private async getIncidentAdmins(
    incidents: readonly AdminOperationalIncident[],
  ): Promise<Map<string, AdminOperationalIncidentActor>> {
    const adminIds = [
      ...new Set(
        incidents.flatMap((incident) => [
          incident.created_by_admin_id,
          incident.resolved_by_admin_id,
        ]),
      ),
    ].filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (adminIds.length === 0) {
      return new Map();
    }

    const rows = toQueryRows(
      await this.dataSource.query(
        `
          SELECT id, email, name, role, status
          FROM admin_accounts
          WHERE id = ANY($1::varchar[])
        `,
        [adminIds],
      ),
    );

    return new Map(
      rows
        .filter((row) => typeof row.id === 'string')
        .map((row) => [
          toStringValue(row.id),
          {
            email: toStringValue(row.email),
            id: toStringValue(row.id),
            name: toStringValue(row.name),
          },
        ]),
    );
  }

  private async getIncidentUsers(
    incidents: readonly AdminOperationalIncident[],
  ): Promise<Map<string, { email: string; id: string }>> {
    const userIds = [
      ...new Set(incidents.map((incident) => incident.target_user_id)),
    ].filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (userIds.length === 0) {
      return new Map();
    }

    const rows = toQueryRows(
      await this.dataSource.query(
        `
          SELECT id, email
          FROM users
          WHERE id = ANY($1::varchar[])
        `,
        [userIds],
      ),
    );

    return new Map(
      rows
        .filter((row) => typeof row.id === 'string')
        .map((row) => [
          toStringValue(row.id),
          { email: toStringValue(row.email), id: toStringValue(row.id) },
        ]),
    );
  }

  private actorMap(
    actor: AdminAuthenticatedUser,
  ): Map<string, AdminOperationalIncidentActor> {
    return new Map([
      [
        actor.id,
        {
          email: actor.email,
          id: actor.id,
          name: actor.name,
        },
      ],
    ]);
  }

  private userMap(user: User): Map<string, { email: string; id: string }> {
    return new Map([[user.id, { email: user.email, id: user.id }]]);
  }

  private toAiCostByUserResponse(
    row: QueryRow,
  ): AdminAiCostByUserListResponse['users'][number] {
    const firstName = toStringValue(row.first_name);
    const lastName = toStringValue(row.last_name);
    const name = [firstName, lastName].filter(Boolean).join(' ').trim();

    return {
      email: toStringValue(row.email),
      featureCosts: [
        {
          id: 'journal_analysis',
          label: 'Journal analysis',
          monthToDateCostUsd: toNumber(row.journal_analysis_cost_mtd),
          todayCostUsd: toNumber(row.journal_analysis_cost_today),
        },
        {
          id: 'daily_suggestions',
          label: 'Daily suggestions',
          monthToDateCostUsd: toNumber(row.daily_suggestions_cost_mtd),
          todayCostUsd: toNumber(row.daily_suggestions_cost_today),
        },
        {
          id: 'journal_insights',
          label: 'AI Insights',
          monthToDateCostUsd: toNumber(row.journal_insights_cost_mtd),
          todayCostUsd: toNumber(row.journal_insights_cost_today),
        },
        {
          id: 'quick_check',
          label: 'Quick Check',
          monthToDateCostUsd: toNumber(row.quick_check_cost_mtd),
          todayCostUsd: toNumber(row.quick_check_cost_today),
        },
        {
          id: 'smart_picks',
          label: 'Smart Picks',
          monthToDateCostUsd: toNumber(row.smart_picks_cost_mtd),
          todayCostUsd: toNumber(row.smart_picks_cost_today),
        },
      ],
      monthToDateCostUsd: toNumber(row.month_to_date_cost_usd),
      name: name || toStringValue(row.email),
      todayCostUsd: toNumber(row.today_cost_usd),
      userId: toStringValue(row.user_id),
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

  private toAdminUserNoteResponse(
    note: AdminUserNote,
    authors: ReadonlyMap<string, AdminUserNoteAuthorResponse>,
  ): AdminUserNoteResponse {
    const authorAdminId = toStringValue(note.author_admin_id);

    return {
      author: authors.get(authorAdminId) ?? null,
      authorAdminId,
      body: toStringValue(note.body),
      createdAt: toNullableIso(note.created_at) ?? toIsoString(new Date(0)),
      id: toStringValue(note.id),
      updatedAt: toNullableIso(note.updated_at) ?? toIsoString(new Date(0)),
      userId: toStringValue(note.user_id),
    };
  }

  private async getNoteAuthors(
    authorAdminIds: readonly string[],
  ): Promise<Map<string, AdminUserNoteAuthorResponse>> {
    const uniqueIds = [...new Set(authorAdminIds.filter(Boolean))];
    if (uniqueIds.length === 0) {
      return new Map();
    }

    const rows = toQueryRows(
      await this.dataSource.query(
        `
          SELECT id, email, name
          FROM admin_accounts
          WHERE id = ANY($1::varchar[])
        `,
        [uniqueIds],
      ),
    );

    return new Map(
      rows
        .filter((row) => typeof row.id === 'string')
        .map((row) => [
          toStringValue(row.id),
          {
            email: toStringValue(row.email),
            id: toStringValue(row.id),
            name: toStringValue(row.name),
          },
        ]),
    );
  }

  private async ensureUserExists(userId: string): Promise<void> {
    const row = await this.queryOne(
      `
        SELECT id
        FROM users
        WHERE id = $1
      `,
      [userId],
    );

    if (typeof row.id !== 'string') {
      throw new NotFoundException('User not found');
    }
  }

  private async findUserForAdminMutation(
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

  private normalizeUserNoteBody(body: string): string {
    const trimmed = body.trim();
    if (trimmed.length < 3) {
      throw new BadRequestException('Admin user note is required');
    }

    if (trimmed.length > ADMIN_USER_NOTE_BODY_MAX_LENGTH) {
      throw new BadRequestException('Admin user note is too long');
    }

    return trimmed;
  }

  private normalizeOperationalIncidentText(
    value: string,
    requiredMessage: string,
    maxLength: number,
    minLength = 1,
  ): string {
    const trimmed = value.trim().replace(/\s+/g, ' ');
    if (trimmed.length < minLength) {
      throw new BadRequestException(requiredMessage);
    }

    if (trimmed.length > maxLength) {
      throw new BadRequestException('Operational incident text is too long');
    }

    return trimmed;
  }

  private normalizeOperationalIncidentSeverity(
    severity: AdminOperationalIncidentSeverity,
  ): AdminOperationalIncidentSeverity {
    if (
      severity !== AdminOperationalIncidentSeverity.Warning &&
      severity !== AdminOperationalIncidentSeverity.Critical
    ) {
      throw new BadRequestException('Operational incident severity is invalid');
    }

    return severity;
  }

  private async writeUserAuditLog(
    auditLogsRepository: Repository<AdminAuditLog>,
    input: {
      action: AdminAuditAction;
      actor: AdminAuthenticatedUser;
      context: AdminUserAuditContext;
      metadata: Record<string, unknown>;
      targetUserId: string | null;
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
      incidentsRepository: manager.getRepository(AdminOperationalIncident),
      notesRepository: manager.getRepository(AdminUserNote),
      sessionsRepository: manager.getRepository(AuthSession),
      usersRepository: manager.getRepository(User),
    };
  }
}

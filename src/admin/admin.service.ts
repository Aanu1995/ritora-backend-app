import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  Repository,
  type ValueTransformer,
} from 'typeorm';
import { ulid } from 'ulid';
import { AuthSession } from '../auth/entities/auth-session.entity';
import {
  sanitizeIpAddress,
  sanitizeUserAgent,
} from '../auth/auth-session.utils';
import {
  nowDate,
  toIsoString,
  toNullableIsoString,
} from '../common/utils/date';
import { isPostgresUniqueConstraintError } from '../common/utils/database-errors';
import { MailService } from '../mail/mail.service';
import { encryptedNullableStringFieldTransformer } from '../skin-profile/skin-profile-field-encryption';
import {
  isPlatformGlobalRestrictionCapability,
  PLATFORM_GLOBAL_RESTRICTION_CAPABILITIES,
  PlatformGlobalRestrictionCapability,
} from '../platform-controls/platform-global-restrictions';
import { platformGlobalRestrictionInternalNoteTransformer } from '../platform-controls/entities/platform-global-restriction.entity';
import { canonicalizeEmailForIdentity } from '../users/users.service.utils';
import {
  AnalysisJobStatusValue,
  AnalysisFeedbackVoteValue,
  AnalysisStatusValue,
  ExportStatusValue,
  InsightGenerationStatusValue,
} from '../skin-journal/skin-journal.constants';
import { SkinJournalAnalysisFeedback } from '../skin-journal/entities/skin-journal-analysis-feedback.entity';
import { SmartPicksGenerationJobStatus } from '../smart-picks/smart-picks.types';
import {
  SuggestionGenerationJobStatus,
  SuggestionGenerationStatus,
} from '../suggestions/suggestions.constants';
import { User } from '../users/entities/user.entity';
import { IngredientProductAnalysisJobStatus } from '../ingredients/entities/ingredient-product-analysis-job.entity';
import {
  AccountMonitoringEvent,
  AccountMonitoringEventType,
} from '../users/entities/account-monitoring-event.entity';
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
  type AdminNotificationListResponse,
  type AdminNotificationResponse,
  type AdminOperationalWorkItemResponse,
  AdminPermission,
  type AdminAuthenticatedUser,
  type AdminAccountMonitoringAutomatedScanResponse,
  type AdminAccountMonitoringEventTimelineItemResponse,
  type AdminAccountMonitoringEventTimelineResponse,
  type AdminAccountMonitoringFlagListResponse,
  type AdminAccountMonitoringFlagResponse,
  type AdminAccountMonitoringListQuery,
  type AdminAccountMonitoringSettingsResponse,
  type AdminMemberResponse,
  type AdminOverviewResponse,
  type AdminPlatformGlobalRestrictionListResponse,
  type AdminPlatformGlobalRestrictionResponse,
  type AdminSkinJournalAnalysisFeedbackCountResponse,
  type AdminSkinJournalAnalysisFeedbackCoverageResponse,
  type AdminSkinJournalAnalysisFeedbackItemResponse,
  type AdminSkinJournalAnalysisFeedbackReportResponse,
  type AdminSkinJournalAnalysisFeedbackSummaryResponse,
  AdminUserAccountStatus,
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
import {
  getEffectiveUserRestrictionCapabilities,
  hasActiveUserRestrictionCapability,
  isUserRestrictionActive,
  normalizeUserRestrictionCapabilities,
  UserRestrictionCapability,
} from '../users/user-restrictions';
import { buildPaginationMeta, normalizePagination } from './admin-pagination';
import {
  AdminAccount,
  AdminAccountRole,
  AdminAccountStatus,
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
  type AdminAccountMonitoringThresholds,
} from './entities/admin-account-monitoring-settings.entity';
import {
  AdminAuditAction,
  AdminAuditLog,
} from './entities/admin-audit-log.entity';
import { AdminAccountMonitoringStatusFilter } from './dto/admin-account-monitoring.dto';
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
import { AdminOperationalIncidentStatusFilter } from './dto/admin-operational-incident.dto';

type QueryRow = Record<string, unknown>;

const ENCRYPTED_STRING_PREFIX = 'ritora:v1:';
export const ACCOUNT_MONITORING_SCAN_SESSION_ID = 'sys-acct-mon-scan';
export const ACCOUNT_MONITORING_SUPPORT_SESSION_ID = 'sys-acct-mon-support';
export const ACCOUNT_MONITORING_INCIDENT_SESSION_ID = 'sys-acct-mon-incident';
const userRestrictionInternalNoteTransformer =
  encryptedNullableStringFieldTransformer(
    'users.account_restriction_internal_note',
  );
const userRestrictionMessageTransformer =
  encryptedNullableStringFieldTransformer(
    'users.account_restriction_user_message',
  );

type AdminRequestContext = {
  ip?: string;
  sessionId: string;
  userAgent?: string;
};

type AdminUserAuditContext = AdminRequestContext & {
  reason: string;
};

type AdminUserRestrictionContext = AdminUserAuditContext & {
  capabilities?: readonly UserRestrictionCapability[];
  expiresAt?: string | null;
  internalNote?: string | null;
  userMessage?: string | null;
};

type AdminPlatformGlobalRestrictionEnableContext = AdminUserAuditContext & {
  expiresAt?: string | null;
  internalNote?: string | null;
};

type AdminUserMutationRepositories = {
  accountsRepository: Repository<AdminAccount>;
  auditLogsRepository: Repository<AdminAuditLog>;
  incidentsRepository: Repository<AdminOperationalIncident>;
  notificationsRepository: Repository<AdminNotification>;
  monitoringEventsRepository: Repository<AccountMonitoringEvent>;
  monitoringRepository: Repository<AdminAccountMonitoringFlag>;
  monitoringSettingsRepository: Repository<AdminAccountMonitoringSettings>;
  notesRepository: Repository<AdminUserNote>;
  sessionsRepository: Repository<AuthSession>;
  usersRepository: Repository<User>;
};

type AdminOperationalIncidentActor = {
  email: string;
  id: string;
  name: string;
};

type AccountMonitoringAutomatedCandidate = {
  costUsd: number;
  eventCount: number;
  latestAt: string | null;
  reasonCode: string;
  severity: AdminAccountMonitoringSeverity;
  signalType: AdminAccountMonitoringSignalType;
  userEmail: string;
  userId: string;
  userName: string;
};

type AccountMonitoringSecurityIncidentCandidate = {
  description: string;
  eventCount: number;
  latestAt: string | null;
  severity: AdminOperationalIncidentSeverity;
  sourceId: string;
  sourceType: string;
  title: string;
};

type AccountMonitoringOwnerNotificationReason =
  | 'created'
  | 'refreshed'
  | 'assigned';

type AccountMonitoringOwnerNotification = {
  flag: AdminAccountMonitoringFlagResponse;
  reason: AccountMonitoringOwnerNotificationReason;
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
const ADMIN_ANALYSIS_FEEDBACK_WINDOW_DAYS = 30;
const ADMIN_ANALYSIS_FEEDBACK_REVIEW_MIN_RESPONSES = 10;
const ADMIN_ANALYSIS_FEEDBACK_REVIEW_HELPFUL_RATE = 70;
const ADMIN_ANALYSIS_FEEDBACK_RECENT_LIMIT = 25;
const ADMIN_ANALYSIS_FEEDBACK_EXPORT_LIMIT = 5000;
const ADMIN_ACCOUNT_MONITORING_DEFAULT_LIMIT = 10;
const ADMIN_ACCOUNT_MONITORING_MAX_LIMIT = 50;
const ADMIN_ACCOUNT_MONITORING_SUMMARY_MAX_LENGTH = 160;
const ADMIN_ACCOUNT_MONITORING_BODY_MAX_LENGTH = 1000;
const ADMIN_ACCOUNT_MONITORING_AUTOMATED_SCAN_LIMIT = 100;
const DEFAULT_ACCOUNT_MONITORING_THRESHOLDS: AdminAccountMonitoringThresholds =
  {
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
  };

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
const BACKEND_API_HEALTH_WINDOW_MINUTES = 15;
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
  {
    activeStatuses: [
      IngredientProductAnalysisJobStatus.Queued,
      IngredientProductAnalysisJobStatus.Sent,
      IngredientProductAnalysisJobStatus.Running,
    ],
    failedStatus: IngredientProductAnalysisJobStatus.Failed,
    id: 'ingredient-analysis',
    label: 'Ingredient analysis',
    tableName: 'ingredient_product_analysis_jobs',
  },
];

const ADMIN_AI_COST_FEATURES = [
  AdminAiCostFeatureFilter.JournalAnalysis,
  AdminAiCostFeatureFilter.JournalInsights,
  AdminAiCostFeatureFilter.DailySuggestions,
  AdminAiCostFeatureFilter.QuickCheck,
  AdminAiCostFeatureFilter.IngredientAnalysis,
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
  [AdminAiCostFeatureFilter.IngredientAnalysis]: (
    joinCandidateUsers,
    requireUserId,
  ) => `
          SELECT
            ingredient_usage.user_id,
            'ingredient_analysis' AS feature,
            COALESCE(SUM(ingredient_usage.ai_estimated_cost_usd), 0)::float AS month_to_date_cost_usd,
            COALESCE(
              SUM(ingredient_usage.ai_estimated_cost_usd) FILTER (
                WHERE ingredient_usage.occurred_at >= bounds.today_start
                  AND ingredient_usage.occurred_at < bounds.tomorrow_start
              ),
              0
            )::float AS today_cost_usd
          FROM ingredient_analysis_ai_usage_metrics ingredient_usage
          ${joinCandidateUsers('ingredient_usage')}
          CROSS JOIN bounds
          WHERE ingredient_usage.occurred_at >= bounds.since_month
            ${requireUserId('ingredient_usage')}
            AND ingredient_usage.status = 'completed'
            AND ingredient_usage.ai_estimated_cost_usd IS NOT NULL
          GROUP BY ingredient_usage.user_id
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

function toRate(part: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.round((part / total) * 1000) / 10;
}

function csvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const rawText =
    typeof value === 'string'
      ? value
      : typeof value === 'number' ||
          typeof value === 'boolean' ||
          typeof value === 'bigint'
        ? value.toString()
        : value instanceof Date
          ? value.toISOString()
          : (JSON.stringify(value) ?? '');
  const text = /^[\s]*[=+\-@]/.test(rawText) ? `'${rawText}` : rawText;
  if (!/[",\n\r]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
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

function toDateLike(value: unknown): Date | string | null {
  return value instanceof Date || typeof value === 'string' ? value : null;
}

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toNullableString(value: unknown): string | null {
  const text = toStringValue(value).trim();
  return text || null;
}

function toNullableEncryptedString(
  value: unknown,
  transformer: ValueTransformer,
): string | null {
  const text = toNullableString(value);
  if (!text) {
    return null;
  }

  if (!text.startsWith(ENCRYPTED_STRING_PREFIX)) {
    return text;
  }

  try {
    const decrypted: unknown = transformer.from(text);
    return typeof decrypted === 'string' && decrypted.trim()
      ? decrypted.trim()
      : null;
  } catch {
    return null;
  }
}

function toDecryptedStringValue(
  value: unknown,
  transformer: ValueTransformer,
): string {
  return toNullableEncryptedString(value, transformer) ?? '';
}

function toNullableRestrictionText(
  value: unknown,
  transformer: ValueTransformer,
): string | null {
  return toNullableEncryptedString(value, transformer);
}

function toBooleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  return value === 'true';
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
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
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly mailService?: MailService,
  ) {}

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
                AND (
                  account_restriction_expires_at IS NULL
                  OR account_restriction_expires_at > now()
                )
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
                AND event_type = 'data_accessed'
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
              FROM ingredient_analysis_ai_usage_metrics
              WHERE status = 'completed'
            )::int AS ingredient_analysis_completed_count,
            (
              SELECT COUNT(*)
              FROM ingredient_analysis_ai_usage_metrics
              WHERE status = 'failed'
            )::int AS ingredient_analysis_failed_count,
            (
              SELECT COALESCE(SUM(ai_estimated_cost_usd), 0)
              FROM ingredient_analysis_ai_usage_metrics, bounds
              WHERE occurred_at >= bounds.today_start
                AND occurred_at < bounds.tomorrow_start
                AND status = 'completed'
                AND ai_estimated_cost_usd IS NOT NULL
            )::float AS ingredient_analysis_ai_cost_today,
            (
              SELECT COALESCE(SUM(ai_estimated_cost_usd), 0)
              FROM ingredient_analysis_ai_usage_metrics, bounds
              WHERE occurred_at >= bounds.since_month
                AND status = 'completed'
                AND ai_estimated_cost_usd IS NOT NULL
            )::float AS ingredient_analysis_ai_cost_mtd,
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
            COALESCE(SUM(month_to_date_cost_usd) FILTER (WHERE feature = 'ingredient_analysis'), 0)::float AS ingredient_analysis_cost_mtd,
            COALESCE(SUM(today_cost_usd) FILTER (WHERE feature = 'ingredient_analysis'), 0)::float AS ingredient_analysis_cost_today,
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
          rollup.ingredient_analysis_cost_mtd,
          rollup.ingredient_analysis_cost_today,
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
      whereClauses.push(`(
        users.account_restricted_at IS NOT NULL
        AND (
          users.account_restriction_expires_at IS NULL
          OR users.account_restriction_expires_at > now()
        )
      )`);
    } else if (query.restriction === AdminUserRestrictionFilter.Unrestricted) {
      whereClauses.push(`(
        users.account_restricted_at IS NULL
        OR users.account_restriction_expires_at <= now()
      )`);
    }

    params.push(pagination.limit);
    const limitIndex = params.length;
    params.push(pagination.offset);
    const offsetIndex = params.length;
    const queryResult: unknown = await this.dataSource.query(
      `
        WITH expired_user_restrictions AS (
          UPDATE users
          SET
            account_restricted_at = NULL,
            account_restriction_reason = NULL,
            account_restricted_by_admin_id = NULL,
            account_restriction_capabilities = NULL,
            account_restriction_expires_at = NULL,
            account_restriction_internal_note = NULL,
            account_restriction_user_message = NULL,
            updated_at = now()
          WHERE account_restricted_at IS NOT NULL
            AND account_restriction_expires_at IS NOT NULL
            AND account_restriction_expires_at <= now()
          RETURNING id
        ),
        filtered_users AS (
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
            users.account_restriction_capabilities,
            users.account_restriction_expires_at,
            NULL::text AS account_restriction_internal_note,
            users.account_restriction_reason,
            NULL::text AS account_restriction_user_message,
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
        WITH expired_user_restrictions AS (
          UPDATE users
          SET
            account_restricted_at = NULL,
            account_restriction_reason = NULL,
            account_restricted_by_admin_id = NULL,
            account_restriction_capabilities = NULL,
            account_restriction_expires_at = NULL,
            account_restriction_internal_note = NULL,
            account_restriction_user_message = NULL,
            updated_at = now()
          WHERE id = $1
            AND account_restricted_at IS NOT NULL
            AND account_restriction_expires_at IS NOT NULL
            AND account_restriction_expires_at <= now()
          RETURNING id
        )
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
          users.account_restriction_capabilities,
          users.account_restriction_expires_at,
          users.account_restriction_internal_note,
          users.account_restriction_reason,
          users.account_restriction_user_message,
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
              AND user_data_access_logs.event_type = 'data_accessed'
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

    const response = await this.runUserMutation(async (repositories) => {
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
    return response;
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

    if (query.monitoringFlagId) {
      params.push(query.monitoringFlagId);
      whereClauses.push(
        `logs.metadata ->> 'monitoringFlagId' = $${params.length}`,
      );
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

  async listAccountMonitoringFlags(
    query: AdminAccountMonitoringListQuery = {},
  ): Promise<AdminAccountMonitoringFlagListResponse> {
    const pagination = normalizePagination({
      defaultLimit: ADMIN_ACCOUNT_MONITORING_DEFAULT_LIMIT,
      limit: query.limit,
      maxLimit: ADMIN_ACCOUNT_MONITORING_MAX_LIMIT,
      page: query.page,
    });
    const whereClauses = ['1 = 1'];
    const params: Array<number | string> = [];

    if (query.status === AdminAccountMonitoringStatusFilter.All) {
      // Intentionally no status predicate.
    } else if (query.status === AdminAccountMonitoringStatusFilter.Resolved) {
      params.push(AdminAccountMonitoringStatus.Resolved);
      whereClauses.push(`flags.status = $${params.length}`);
    } else if (query.status === AdminAccountMonitoringStatusFilter.Open) {
      params.push(AdminAccountMonitoringStatus.Open);
      whereClauses.push(`flags.status = $${params.length}`);
    } else if (query.status === AdminAccountMonitoringStatusFilter.Watching) {
      params.push(AdminAccountMonitoringStatus.Watching);
      whereClauses.push(`flags.status = $${params.length}`);
    } else {
      params.push(AdminAccountMonitoringStatus.Open);
      const openStatusIndex = params.length;
      params.push(AdminAccountMonitoringStatus.Watching);
      const watchingStatusIndex = params.length;
      whereClauses.push(
        `flags.status IN ($${openStatusIndex}, $${watchingStatusIndex})`,
      );
    }

    if (query.signalType) {
      params.push(query.signalType);
      whereClauses.push(`flags.signal_type = $${params.length}`);
    }

    if (query.assignedAdminId) {
      params.push(query.assignedAdminId);
      whereClauses.push(`flags.assigned_admin_id = $${params.length}`);
    }

    const search = normalizeSearch(query.query);
    if (search) {
      params.push(`%${escapeLikePattern(search)}%`);
      const searchIndex = params.length;
      whereClauses.push(`(
        users.canonical_email ILIKE $${searchIndex} ESCAPE '\\'
        OR users.first_name ILIKE $${searchIndex} ESCAPE '\\'
        OR users.last_name ILIKE $${searchIndex} ESCAPE '\\'
        OR flags.summary ILIKE $${searchIndex} ESCAPE '\\'
      )`);
    }
    const filteredUsersJoin = search
      ? 'JOIN users ON users.id = flags.user_id'
      : '';

    params.push(pagination.limit);
    const limitIndex = params.length;
    params.push(pagination.offset);
    const offsetIndex = params.length;

    const result: unknown = await this.dataSource.query(
      `
        WITH filtered_flags AS (
          SELECT
            flags.id,
            flags.created_at,
            flags.next_review_at
          FROM admin_account_monitoring_flags flags
          ${filteredUsersJoin}
          WHERE ${whereClauses.join(' AND ')}
        ),
        counted_flags AS (
          SELECT COUNT(*)::int AS total_count
          FROM filtered_flags
        ),
        paged_flags AS (
          SELECT *
          FROM filtered_flags
          ORDER BY
            next_review_at ASC NULLS LAST,
            created_at DESC,
            id DESC
          LIMIT $${limitIndex}
          OFFSET $${offsetIndex}
        )
        SELECT
          counted_flags.total_count,
          flags.id,
          flags.user_id,
          flags.signal_type,
          flags.status,
          flags.severity,
          flags.summary,
          flags.latest_signal,
          flags.internal_note,
          flags.assigned_admin_id,
          flags.created_by_admin_id,
          flags.resolved_by_admin_id,
          flags.next_review_at,
          flags.resolved_at,
          flags.resolution_note,
          flags.created_at,
          flags.updated_at,
          users.email AS user_email,
          NULLIF(CONCAT_WS(' ', users.first_name, users.last_name), '') AS user_name,
          assigned_admin.email AS assigned_admin_email,
          assigned_admin.name AS assigned_admin_name,
          created_admin.email AS created_by_admin_email,
          created_admin.name AS created_by_admin_name,
          resolved_admin.email AS resolved_by_admin_email,
          resolved_admin.name AS resolved_by_admin_name,
          COALESCE(audit_counts.audit_log_count, 0)::int AS audit_log_count
        FROM counted_flags
        LEFT JOIN paged_flags ON true
        LEFT JOIN admin_account_monitoring_flags flags
          ON flags.id = paged_flags.id
        LEFT JOIN users ON users.id = flags.user_id
        LEFT JOIN admin_accounts assigned_admin
          ON assigned_admin.id = flags.assigned_admin_id
        LEFT JOIN admin_accounts created_admin
          ON created_admin.id = flags.created_by_admin_id
        LEFT JOIN admin_accounts resolved_admin
          ON resolved_admin.id = flags.resolved_by_admin_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS audit_log_count
          FROM admin_audit_logs logs
          WHERE logs.target_user_id = flags.user_id
            AND logs.action IN (
              'account_monitoring_flag_created',
              'account_monitoring_flag_updated',
              'account_monitoring_flag_resolved'
            )
            AND logs.metadata ->> 'monitoringFlagId' = flags.id
        ) audit_counts ON flags.id IS NOT NULL
        ORDER BY
          paged_flags.next_review_at ASC NULLS LAST,
          paged_flags.created_at DESC NULLS LAST,
          paged_flags.id DESC NULLS LAST
      `,
      params,
    );
    const rows = toQueryRows(result);
    const total = toNumber(rows[0]?.total_count);

    return {
      flags: rows
        .filter((row) => typeof row.id === 'string')
        .map((row) => this.toAccountMonitoringFlagResponse(row)),
      ...buildPaginationMeta(total, pagination),
    };
  }

  async createAccountMonitoringFlag(
    actor: AdminAuthenticatedUser,
    input: {
      internalNote: string;
      latestSignal: string;
      nextReviewAt?: string | null;
      reason: string;
      severity: AdminAccountMonitoringSeverity;
      signalType: AdminAccountMonitoringSignalType;
      summary: string;
      userIdentifier: string;
    },
    context: AdminRequestContext,
  ): Promise<AdminAccountMonitoringFlagResponse> {
    const reason = this.normalizeAuditReason(input.reason);
    const signalType = this.normalizeMonitoringSignalType(input.signalType);
    const severity = this.normalizeMonitoringSeverity(input.severity);
    const summary = this.normalizeMonitoringText(
      input.summary,
      'Account monitoring summary is required',
      ADMIN_ACCOUNT_MONITORING_SUMMARY_MAX_LENGTH,
      3,
    );
    const latestSignal = this.normalizeMonitoringText(
      input.latestSignal,
      'Account monitoring signal is required',
      ADMIN_ACCOUNT_MONITORING_BODY_MAX_LENGTH,
      8,
    );
    const internalNote = this.normalizeMonitoringText(
      input.internalNote,
      'Account monitoring internal note is required',
      ADMIN_ACCOUNT_MONITORING_BODY_MAX_LENGTH,
      8,
    );
    const nextReviewAt = this.normalizeFutureReviewDate(input.nextReviewAt);

    const response = await this.runUserMutation(async (repositories) => {
      const user = await this.findUserByAdminIdentifierForMutation(
        repositories.usersRepository,
        input.userIdentifier,
      );
      const existingFlag = await repositories.monitoringRepository.findOne({
        where: {
          signal_type: signalType,
          status: In([
            AdminAccountMonitoringStatus.Open,
            AdminAccountMonitoringStatus.Watching,
          ]),
          user_id: user.id,
        },
      });
      if (existingFlag) {
        throw new ConflictException(
          'An active monitoring flag already exists for this account signal',
        );
      }

      const flag = repositories.monitoringRepository.create({
        assigned_admin_id: actor.id,
        created_by_admin_id: actor.id,
        internal_note: internalNote,
        latest_signal: latestSignal,
        next_review_at: nextReviewAt,
        resolution_note: null,
        resolved_at: null,
        resolved_by_admin_id: null,
        severity,
        signal_type: signalType,
        status: AdminAccountMonitoringStatus.Open,
        summary,
        user_id: user.id,
      });
      let savedFlag: AdminAccountMonitoringFlag;
      try {
        savedFlag = await repositories.monitoringRepository.save(flag);
      } catch (error) {
        if (isPostgresUniqueConstraintError(error)) {
          throw new ConflictException(
            'An active monitoring flag already exists for this account signal',
          );
        }

        throw error;
      }

      await this.writeUserAuditLog(repositories.auditLogsRepository, {
        action: AdminAuditAction.AccountMonitoringFlagCreated,
        actor,
        context: { ...context, reason },
        metadata: {
          monitoringFlagId: savedFlag.id,
          nextReviewAt: nextReviewAt ? nextReviewAt.toISOString() : null,
          severity,
          signalType,
          status: savedFlag.status,
        },
        targetUserId: user.id,
      });

      return this.toAccountMonitoringFlagResponseFromEntity(savedFlag, user, {
        [actor.id]: {
          email: actor.email,
          id: actor.id,
          name: actor.name,
        },
      });
    });
    await this.notifyAccountMonitoringOwner({
      flag: response,
      reason: 'created',
    });
    return response;
  }

  async runAccountMonitoringAutomatedScan(
    actor: AdminAuthenticatedUser,
    context: AdminRequestContext,
  ): Promise<AdminAccountMonitoringAutomatedScanResponse> {
    const scannedAt = nowDate();
    const thresholds = await this.loadAccountMonitoringThresholds();
    const [candidates, platformCandidates] = await Promise.all([
      this.loadAutomatedMonitoringCandidates(scannedAt, thresholds),
      this.loadPlatformMonitoringIncidentCandidates(scannedAt, thresholds),
    ]);
    if (candidates.length === 0 && platformCandidates.length === 0) {
      return {
        candidates: 0,
        created: 0,
        flags: [],
        platformCandidates: 0,
        platformIncidentsCreated: 0,
        platformIncidentsRefreshed: 0,
        refreshed: 0,
        scannedAt: toIsoString(scannedAt),
        skipped: 0,
      };
    }

    const ownerNotificationReasons = new Map<
      string,
      AccountMonitoringOwnerNotificationReason
    >();
    const response = await this.runUserMutation(async (repositories) => {
      const candidateUserIds = [
        ...new Set(candidates.map((item) => item.userId)),
      ];
      const existingFlags =
        candidateUserIds.length > 0
          ? await repositories.monitoringRepository.find({
              where: {
                status: In([
                  AdminAccountMonitoringStatus.Open,
                  AdminAccountMonitoringStatus.Watching,
                ]),
                user_id: In(candidateUserIds),
              },
            })
          : [];
      const existingByKey = new Map(
        existingFlags.map((flag) => [
          this.accountMonitoringCandidateKey(flag.user_id, flag.signal_type),
          flag,
        ]),
      );
      const savedFlags: AdminAccountMonitoringFlag[] = [];
      let created = 0;
      let refreshed = 0;
      let skipped = 0;

      for (const candidate of candidates) {
        const draft = this.toAutomatedMonitoringDraft(candidate, scannedAt);
        const existing = existingByKey.get(
          this.accountMonitoringCandidateKey(
            candidate.userId,
            candidate.signalType,
          ),
        );

        if (existing) {
          if (existing.status === AdminAccountMonitoringStatus.Resolved) {
            skipped += 1;
            continue;
          }
          const previousSeverity = existing.severity;
          existing.latest_signal = draft.latestSignal;
          existing.summary = draft.summary;
          existing.severity = this.maxMonitoringSeverity(
            existing.severity,
            candidate.severity,
          );
          existing.next_review_at =
            existing.next_review_at &&
            existing.next_review_at.getTime() < draft.nextReviewAt.getTime()
              ? existing.next_review_at
              : draft.nextReviewAt;
          const saved = await repositories.monitoringRepository.save(existing);
          savedFlags.push(saved);
          if (saved.severity !== previousSeverity) {
            ownerNotificationReasons.set(saved.id, 'refreshed');
          }
          refreshed += 1;
          await this.writeAutomatedMonitoringAuditLog(
            repositories.auditLogsRepository,
            actor,
            context,
            saved,
            AdminAuditAction.AccountMonitoringFlagUpdated,
            candidate,
          );
          continue;
        }

        const createdFlag = repositories.monitoringRepository.create({
          assigned_admin_id: actor.id,
          created_by_admin_id: actor.id,
          internal_note: draft.internalNote,
          latest_signal: draft.latestSignal,
          next_review_at: draft.nextReviewAt,
          resolution_note: null,
          resolved_at: null,
          resolved_by_admin_id: null,
          severity: candidate.severity,
          signal_type: candidate.signalType,
          status: AdminAccountMonitoringStatus.Open,
          summary: draft.summary,
          user_id: candidate.userId,
        });
        const saved = await repositories.monitoringRepository.save(createdFlag);
        existingByKey.set(
          this.accountMonitoringCandidateKey(
            candidate.userId,
            candidate.signalType,
          ),
          saved,
        );
        savedFlags.push(saved);
        ownerNotificationReasons.set(saved.id, 'created');
        created += 1;
        await this.writeAutomatedMonitoringAuditLog(
          repositories.auditLogsRepository,
          actor,
          context,
          saved,
          AdminAuditAction.AccountMonitoringFlagCreated,
          candidate,
        );
      }

      const actors = await this.getMonitoringActorsForFlags(savedFlags);
      if (!actors.has(actor.id)) {
        actors.set(actor.id, {
          email: actor.email,
          id: actor.id,
          name: actor.name,
        });
      }
      const candidatesByKey = new Map(
        candidates.map((candidate) => [
          this.accountMonitoringCandidateKey(
            candidate.userId,
            candidate.signalType,
          ),
          candidate,
        ]),
      );
      const incidentStats = await this.upsertAutomatedSecurityIncidents(
        repositories,
        actor,
        context,
        platformCandidates,
      );

      return {
        candidates: candidates.length,
        created,
        flags: savedFlags.map((flag) =>
          this.toAccountMonitoringFlagResponseFromCandidate(
            flag,
            candidatesByKey.get(
              this.accountMonitoringCandidateKey(
                flag.user_id,
                flag.signal_type,
              ),
            ),
            Object.fromEntries(actors),
          ),
        ),
        platformCandidates: platformCandidates.length,
        platformIncidentsCreated: incidentStats.created,
        platformIncidentsRefreshed: incidentStats.refreshed,
        refreshed,
        scannedAt: toIsoString(scannedAt),
        skipped,
      };
    });
    await this.notifyAccountMonitoringOwners(
      response.flags
        .map((flag) => {
          const reason = ownerNotificationReasons.get(flag.id);
          return reason ? { flag, reason } : null;
        })
        .filter(
          (value): value is AccountMonitoringOwnerNotification =>
            value !== null,
        ),
    );
    return response;
  }

  async createAccountMonitoringSupportEvent(
    actor: AdminAuthenticatedUser,
    input: {
      internalNote: string;
      latestSignal: string;
      reason: string;
      severity: AdminAccountMonitoringSeverity;
      summary: string;
      supportReference: string;
      userIdentifier: string;
    },
    context: AdminRequestContext,
  ): Promise<AdminAccountMonitoringFlagResponse> {
    const reason = this.normalizeAuditReason(input.reason);
    const severity = this.normalizeMonitoringSeverity(input.severity);
    const summary = this.normalizeMonitoringText(
      input.summary,
      'Support escalation summary is required',
      ADMIN_ACCOUNT_MONITORING_SUMMARY_MAX_LENGTH,
      3,
    );
    const latestSignal = this.normalizeMonitoringText(
      input.latestSignal,
      'Support escalation signal is required',
      ADMIN_ACCOUNT_MONITORING_BODY_MAX_LENGTH,
      8,
    );
    const internalNote = this.normalizeMonitoringText(
      input.internalNote,
      'Support escalation internal note is required',
      ADMIN_ACCOUNT_MONITORING_BODY_MAX_LENGTH,
      8,
    );
    const supportReference = this.normalizeMonitoringText(
      input.supportReference,
      'Support reference is required',
      120,
      3,
    );
    let notificationReason: AccountMonitoringOwnerNotificationReason =
      'created';
    const response = await this.runUserMutation(async (repositories) => {
      const user = await this.findUserByAdminIdentifierForMutation(
        repositories.usersRepository,
        input.userIdentifier,
      );
      const event = repositories.monitoringEventsRepository.create({
        email_hash: null,
        event_type: AccountMonitoringEventType.SupportEscalationReceived,
        ip_address_hash: null,
        metadata: {
          reason: 'support_escalation',
          severity,
          supportReference,
        },
        occurred_at: nowDate(),
        user_id: user.id,
      });
      const savedEvent =
        await repositories.monitoringEventsRepository.save(event);

      const existingFlag = await repositories.monitoringRepository.findOne({
        where: {
          signal_type: AdminAccountMonitoringSignalType.SupportEscalation,
          status: In([
            AdminAccountMonitoringStatus.Open,
            AdminAccountMonitoringStatus.Watching,
          ]),
          user_id: user.id,
        },
      });
      notificationReason = existingFlag ? 'refreshed' : 'created';
      const flag =
        existingFlag ??
        repositories.monitoringRepository.create({
          assigned_admin_id: actor.id,
          created_by_admin_id: actor.id,
          resolution_note: null,
          resolved_at: null,
          resolved_by_admin_id: null,
          signal_type: AdminAccountMonitoringSignalType.SupportEscalation,
          status: AdminAccountMonitoringStatus.Open,
          user_id: user.id,
        });

      flag.assigned_admin_id = flag.assigned_admin_id ?? actor.id;
      flag.internal_note = internalNote;
      flag.latest_signal = latestSignal;
      flag.next_review_at = new Date(nowDate().getTime() + DAY_MS);
      flag.severity = existingFlag
        ? this.maxMonitoringSeverity(existingFlag.severity, severity)
        : severity;
      flag.summary = summary;

      const savedFlag = await repositories.monitoringRepository.save(flag);
      await this.writeUserAuditLog(repositories.auditLogsRepository, {
        action: existingFlag
          ? AdminAuditAction.AccountMonitoringFlagUpdated
          : AdminAuditAction.AccountMonitoringFlagCreated,
        actor,
        context: { ...context, reason },
        metadata: {
          eventId: savedEvent.id,
          monitoringFlagId: savedFlag.id,
          severity: savedFlag.severity,
          signalType: savedFlag.signal_type,
          status: savedFlag.status,
          supportReference,
        },
        targetUserId: user.id,
      });

      const actors = await this.getMonitoringActorsForFlags([savedFlag]);
      if (!actors.has(actor.id)) {
        actors.set(actor.id, {
          email: actor.email,
          id: actor.id,
          name: actor.name,
        });
      }

      return this.toAccountMonitoringFlagResponseFromEntity(
        savedFlag,
        user,
        Object.fromEntries(actors),
      );
    });
    await this.notifyAccountMonitoringOwner({
      flag: response,
      reason: notificationReason,
    });
    return response;
  }

  async getAccountMonitoringEventTimeline(
    flagId: string,
    input: { limit?: number } = {},
  ): Promise<AdminAccountMonitoringEventTimelineResponse> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
    const flag = await this.dataSource
      .getRepository(AdminAccountMonitoringFlag)
      .findOne({ where: { id: flagId } });
    if (!flag) {
      throw new NotFoundException('Account monitoring flag not found');
    }

    const [accountEvents, syntheticRows] = await Promise.all([
      this.loadAccountMonitoringEventTimelineItems(flag, limit),
      this.loadSyntheticMonitoringTimelineItems(flag, limit),
    ]);
    const events = [...accountEvents, ...syntheticRows]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, limit);

    return {
      events,
      flagId: flag.id,
      generatedAt: toIsoString(nowDate()),
    };
  }

  async runScheduledAccountMonitoringScan(
    context: Omit<AdminRequestContext, 'sessionId'> & {
      sessionId?: string;
    } = {},
  ): Promise<AdminAccountMonitoringAutomatedScanResponse | null> {
    const actor = await this.loadSystemMonitoringActor(
      context.sessionId ?? ACCOUNT_MONITORING_SCAN_SESSION_ID,
    );
    if (!actor) {
      this.logger.warn(
        'Skipped scheduled account monitoring scan because no active admin account exists.',
      );
      return null;
    }

    return this.runAccountMonitoringAutomatedScan(actor, {
      ip: context.ip,
      sessionId: context.sessionId ?? actor.sessionId,
      userAgent:
        context.userAgent ?? 'ritora-account-monitoring-sqs-worker/1.0',
    });
  }

  async createScheduledAccountMonitoringSupportEvent(input: {
    internalNote: string;
    latestSignal: string;
    reason: string;
    severity: AdminAccountMonitoringSeverity;
    summary: string;
    supportReference: string;
    userIdentifier: string;
  }): Promise<AdminAccountMonitoringFlagResponse | null> {
    const actor = await this.loadSystemMonitoringActor(
      ACCOUNT_MONITORING_SUPPORT_SESSION_ID,
    );
    if (!actor) {
      this.logger.warn(
        'Skipped queued account monitoring support event because no active admin account exists.',
      );
      return null;
    }

    return this.createAccountMonitoringSupportEvent(actor, input, {
      sessionId: actor.sessionId,
      userAgent: 'ritora-account-monitoring-sqs-worker/1.0',
    });
  }

  async createScheduledAccountMonitoringOperationalIncident(input: {
    description: string;
    severity: AdminOperationalIncidentSeverity;
    sourceId: string;
    sourceType: string;
    title: string;
  }): Promise<AdminOperationalIncidentResponse | null> {
    const actor = await this.loadSystemMonitoringActor(
      ACCOUNT_MONITORING_INCIDENT_SESSION_ID,
    );
    if (!actor) {
      this.logger.warn(
        'Skipped queued account monitoring operational incident because no active admin account exists.',
      );
      return null;
    }

    return this.upsertScheduledOperationalIncident(actor, input, {
      sessionId: actor.sessionId,
      userAgent: 'ritora-account-monitoring-sqs-worker/1.0',
    });
  }

  async getAccountMonitoringSettings(): Promise<AdminAccountMonitoringSettingsResponse> {
    const settingsRepository = this.dataSource.getRepository(
      AdminAccountMonitoringSettings,
    );
    const settings = await settingsRepository.findOne({
      where: { id: ADMIN_ACCOUNT_MONITORING_SETTINGS_ID },
    });

    return {
      thresholds: this.normalizeAccountMonitoringThresholds(
        settings?.thresholds,
      ),
      updatedAt:
        toNullableIsoString(settings?.updated_at) ?? toIsoString(new Date(0)),
      updatedByAdminId: settings?.updated_by_admin_id ?? null,
    };
  }

  async listNotifications(
    actor: AdminAuthenticatedUser,
    input: { limit?: number } = {},
  ): Promise<AdminNotificationListResponse> {
    const limit = Math.min(Math.max(input.limit ?? 10, 1), 20);
    const notificationsRepository =
      this.dataSource.getRepository(AdminNotification);
    const [notifications, unreadCount] = await Promise.all([
      notificationsRepository
        .createQueryBuilder('notification')
        .where('notification.admin_id = :adminId', { adminId: actor.id })
        .orderBy('notification.read_at', 'ASC', 'NULLS FIRST')
        .addOrderBy('notification.created_at', 'DESC')
        .addOrderBy('notification.id', 'DESC')
        .take(limit)
        .getMany(),
      notificationsRepository.count({
        where: { admin_id: actor.id, read_at: IsNull() },
      }),
    ]);

    return {
      generatedAt: toIsoString(nowDate()),
      notifications: notifications.map((notification) =>
        this.toAdminNotificationResponse(notification),
      ),
      unreadCount,
    };
  }

  async markNotificationRead(
    actor: AdminAuthenticatedUser,
    notificationId: string,
  ): Promise<AdminNotificationResponse> {
    const notificationsRepository =
      this.dataSource.getRepository(AdminNotification);
    const notification = await notificationsRepository.findOne({
      where: { admin_id: actor.id, id: notificationId },
    });
    if (!notification) {
      throw new NotFoundException('Admin notification not found');
    }

    if (!notification.read_at) {
      notification.read_at = nowDate();
      await notificationsRepository.save(notification);
    }

    return this.toAdminNotificationResponse(notification);
  }

  async updateAccountMonitoringSettings(
    actor: AdminAuthenticatedUser,
    input: { reason: string; thresholds: AdminAccountMonitoringThresholds },
    context: AdminRequestContext,
  ): Promise<AdminAccountMonitoringSettingsResponse> {
    const reason = this.normalizeAuditReason(input.reason);
    const thresholds = this.normalizeAccountMonitoringThresholds(
      input.thresholds,
    );

    return this.runUserMutation(async (repositories) => {
      const existing = await repositories.monitoringSettingsRepository.findOne({
        where: { id: ADMIN_ACCOUNT_MONITORING_SETTINGS_ID },
      });
      const settings =
        existing ??
        repositories.monitoringSettingsRepository.create({
          id: ADMIN_ACCOUNT_MONITORING_SETTINGS_ID,
          thresholds: DEFAULT_ACCOUNT_MONITORING_THRESHOLDS,
          updated_by_admin_id: null,
        });

      settings.thresholds = thresholds;
      settings.updated_by_admin_id = actor.id;
      const saved =
        await repositories.monitoringSettingsRepository.save(settings);

      await this.writeUserAuditLog(repositories.auditLogsRepository, {
        action: AdminAuditAction.AccountMonitoringSettingsUpdated,
        actor,
        context: { ...context, reason },
        metadata: { thresholds },
        targetUserId: null,
      });

      return {
        thresholds: this.normalizeAccountMonitoringThresholds(saved.thresholds),
        updatedAt:
          toNullableIsoString(saved.updated_at) ?? toIsoString(nowDate()),
        updatedByAdminId: saved.updated_by_admin_id,
      };
    });
  }

  async updateAccountMonitoringFlag(
    actor: AdminAuthenticatedUser,
    flagId: string,
    input: {
      assignedAdminId?: string | null;
      internalNote?: string;
      latestSignal?: string;
      nextReviewAt?: string | null;
      reason: string;
      status?:
        | AdminAccountMonitoringStatus.Open
        | AdminAccountMonitoringStatus.Watching;
    },
    context: AdminRequestContext,
  ): Promise<AdminAccountMonitoringFlagResponse> {
    const reason = this.normalizeAuditReason(input.reason);

    const response = await this.runUserMutation(async (repositories) => {
      const flag = await repositories.monitoringRepository.findOne({
        where: { id: flagId },
      });
      if (!flag) {
        throw new NotFoundException('Account monitoring flag not found');
      }
      if (flag.status === AdminAccountMonitoringStatus.Resolved) {
        throw new ConflictException(
          'Resolved monitoring flags cannot be updated',
        );
      }

      if (input.status !== undefined) {
        flag.status = this.normalizeMonitoringOpenStatus(input.status);
      }
      if (input.latestSignal !== undefined) {
        flag.latest_signal = this.normalizeMonitoringText(
          input.latestSignal,
          'Account monitoring signal is required',
          ADMIN_ACCOUNT_MONITORING_BODY_MAX_LENGTH,
          8,
        );
      }
      if (input.internalNote !== undefined) {
        flag.internal_note = this.normalizeMonitoringText(
          input.internalNote,
          'Account monitoring internal note is required',
          ADMIN_ACCOUNT_MONITORING_BODY_MAX_LENGTH,
          8,
        );
      }
      if ('nextReviewAt' in input) {
        flag.next_review_at = this.normalizeFutureReviewDate(
          input.nextReviewAt,
        );
      }
      if ('assignedAdminId' in input) {
        flag.assigned_admin_id = input.assignedAdminId
          ? (
              await this.findAdminAccountForMonitoringAssignment(
                repositories.accountsRepository,
                input.assignedAdminId,
              )
            ).id
          : null;
      }

      const savedFlag = await repositories.monitoringRepository.save(flag);
      const user = await this.findUserForAdminMutation(
        repositories.usersRepository,
        savedFlag.user_id,
      );

      await this.writeUserAuditLog(repositories.auditLogsRepository, {
        action: AdminAuditAction.AccountMonitoringFlagUpdated,
        actor,
        context: { ...context, reason },
        metadata: {
          assignedAdminId: savedFlag.assigned_admin_id,
          monitoringFlagId: savedFlag.id,
          nextReviewAt: savedFlag.next_review_at
            ? savedFlag.next_review_at.toISOString()
            : null,
          signalType: savedFlag.signal_type,
          status: savedFlag.status,
        },
        targetUserId: savedFlag.user_id,
      });

      const admins = await this.getMonitoringActorsForFlags([savedFlag]);
      if (!admins.has(actor.id)) {
        admins.set(actor.id, {
          email: actor.email,
          id: actor.id,
          name: actor.name,
        });
      }

      return this.toAccountMonitoringFlagResponseFromEntity(
        savedFlag,
        user,
        Object.fromEntries(admins),
      );
    });
    if ('assignedAdminId' in input && input.assignedAdminId) {
      await this.notifyAccountMonitoringOwner({
        flag: response,
        reason: 'assigned',
      });
    }
    return response;
  }

  async resolveAccountMonitoringFlag(
    actor: AdminAuthenticatedUser,
    flagId: string,
    input: { reason: string; resolutionNote: string },
    context: AdminRequestContext,
  ): Promise<AdminAccountMonitoringFlagResponse> {
    const reason = this.normalizeAuditReason(input.reason);
    const resolutionNote = this.normalizeMonitoringText(
      input.resolutionNote,
      'Account monitoring resolution is required',
      ADMIN_ACCOUNT_MONITORING_BODY_MAX_LENGTH,
      8,
    );

    return this.runUserMutation(async (repositories) => {
      const flag = await repositories.monitoringRepository.findOne({
        where: { id: flagId },
      });
      if (!flag) {
        throw new NotFoundException('Account monitoring flag not found');
      }

      if (flag.status !== AdminAccountMonitoringStatus.Resolved) {
        flag.status = AdminAccountMonitoringStatus.Resolved;
        flag.resolved_at = new Date();
        flag.resolved_by_admin_id = actor.id;
        flag.resolution_note = resolutionNote;
        await repositories.monitoringRepository.save(flag);

        await this.writeUserAuditLog(repositories.auditLogsRepository, {
          action: AdminAuditAction.AccountMonitoringFlagResolved,
          actor,
          context: { ...context, reason },
          metadata: {
            monitoringFlagId: flag.id,
            signalType: flag.signal_type,
            status: flag.status,
          },
          targetUserId: flag.user_id,
        });
      }

      const user = await this.findUserForAdminMutation(
        repositories.usersRepository,
        flag.user_id,
      );
      const admins = await this.getMonitoringActorsForFlags([flag]);
      if (!admins.has(actor.id)) {
        admins.set(actor.id, {
          email: actor.email,
          id: actor.id,
          name: actor.name,
        });
      }

      return this.toAccountMonitoringFlagResponseFromEntity(
        flag,
        user,
        Object.fromEntries(admins),
      );
    });
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

  async getSkinJournalAnalysisFeedbackReport(
    now = new Date(),
  ): Promise<AdminSkinJournalAnalysisFeedbackReportResponse> {
    const since = new Date(
      now.getTime() - ADMIN_ANALYSIS_FEEDBACK_WINDOW_DAYS * DAY_MS,
    );
    const feedbackRepository = this.dataSource.getRepository(
      SkinJournalAnalysisFeedback,
    );
    const queryRows = (
      sql: string,
      parameters?: unknown[],
    ): Promise<QueryRow[]> => this.dataSource.query(sql, parameters);
    const [
      windowRows,
      allTimeRows,
      reasonRows,
      readingLabelRows,
      interpretationVersionRows,
      coverageRows,
      recentFeedback,
    ] = await Promise.all([
      queryRows(
        `
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE vote = $2)::int AS helpful,
            COUNT(*) FILTER (WHERE vote = $3)::int AS not_helpful
          FROM skin_journal_analysis_feedback
          WHERE created_at >= $1
        `,
        [
          since,
          AnalysisFeedbackVoteValue.Helpful,
          AnalysisFeedbackVoteValue.NotHelpful,
        ],
      ),
      queryRows(
        `
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE vote = $1)::int AS helpful,
            COUNT(*) FILTER (WHERE vote = $2)::int AS not_helpful
          FROM skin_journal_analysis_feedback
        `,
        [
          AnalysisFeedbackVoteValue.Helpful,
          AnalysisFeedbackVoteValue.NotHelpful,
        ],
      ),
      queryRows(
        `
          SELECT reason AS id, COALESCE(reason, 'No reason') AS label, COUNT(*)::int AS count
          FROM skin_journal_analysis_feedback
          WHERE created_at >= $1 AND vote = $2
          GROUP BY reason
          ORDER BY count DESC, label ASC
        `,
        [since, AnalysisFeedbackVoteValue.NotHelpful],
      ),
      queryRows(
        `
          SELECT
            reading_label AS id,
            COALESCE(reading_label, 'unknown') AS label,
            COUNT(*)::int AS count
          FROM skin_journal_analysis_feedback
          WHERE created_at >= $1
          GROUP BY reading_label
          ORDER BY count DESC, label ASC
        `,
        [since],
      ),
      queryRows(
        `
          SELECT
            interpretation_version AS id,
            COALESCE(interpretation_version, 'unknown') AS label,
            COUNT(*)::int AS count
          FROM skin_journal_analysis_feedback
          WHERE created_at >= $1
          GROUP BY interpretation_version
          ORDER BY count DESC, label ASC
        `,
        [since],
      ),
      queryRows(
        `
          SELECT
            COUNT(*) FILTER (WHERE analysis_feedback_submitted = true)::int AS analyses_with_feedback,
            COUNT(*) FILTER (WHERE analysis_feedback_submitted = false)::int AS analyses_without_feedback
          FROM skin_journal_entries
          WHERE analysis_interpretation IS NOT NULL
            AND analysis_completed_at >= $1
        `,
        [since],
      ),
      feedbackRepository.find({
        order: { created_at: 'DESC' },
        take: ADMIN_ANALYSIS_FEEDBACK_RECENT_LIMIT,
      }),
    ]);
    const windowSummary = this.toAnalysisFeedbackSummary(windowRows[0]);
    const allTimeSummary = this.toAnalysisFeedbackSummary(allTimeRows[0]);

    return {
      allTime: allTimeSummary,
      coverage: this.toAnalysisFeedbackCoverage(coverageRows[0]),
      generatedAt: now.toISOString(),
      interpretationVersions: this.toAnalysisFeedbackCounts(
        interpretationVersionRows,
        windowSummary.total,
      ),
      readingLabels: this.toAnalysisFeedbackCounts(
        readingLabelRows,
        windowSummary.total,
      ),
      reasons: this.toAnalysisFeedbackCounts(
        reasonRows,
        windowSummary.notHelpful,
      ),
      recentFeedback: recentFeedback.map((feedback) =>
        this.toSkinJournalAnalysisFeedbackResponse(feedback),
      ),
      reviewThreshold: {
        helpfulRate: ADMIN_ANALYSIS_FEEDBACK_REVIEW_HELPFUL_RATE,
        minResponses: ADMIN_ANALYSIS_FEEDBACK_REVIEW_MIN_RESPONSES,
      },
      window: windowSummary,
      windowDays: ADMIN_ANALYSIS_FEEDBACK_WINDOW_DAYS,
    };
  }

  async exportSkinJournalAnalysisFeedbackCsv(
    actor: AdminAuthenticatedUser,
    context: AdminUserAuditContext,
  ): Promise<string> {
    const reason = this.normalizeAuditReason(context.reason);
    const feedbackRepository = this.dataSource.getRepository(
      SkinJournalAnalysisFeedback,
    );
    const auditLogsRepository = this.dataSource.getRepository(AdminAuditLog);
    const feedback = await feedbackRepository.find({
      order: { created_at: 'DESC' },
      take: ADMIN_ANALYSIS_FEEDBACK_EXPORT_LIMIT,
    });
    const headers = [
      'vote',
      'reason',
      'note',
      'interpretation_version',
      'reading_label',
      'concern_keys',
      'created_at',
      'updated_at',
    ];
    const rows = feedback.map((row) => [
      row.vote,
      row.reason,
      row.note,
      row.interpretation_version,
      row.reading_label,
      row.concern_keys.join('; '),
      toIsoString(row.created_at),
      toIsoString(row.updated_at),
    ]);
    await this.writeUserAuditLog(auditLogsRepository, {
      action: AdminAuditAction.SkinJournalAnalysisFeedbackExported,
      actor,
      context: { ...context, reason },
      metadata: {
        exportedRows: feedback.length,
        maxRows: ADMIN_ANALYSIS_FEEDBACK_EXPORT_LIMIT,
      },
      targetUserId: null,
    });

    return [headers, ...rows]
      .map((row) => row.map(csvValue).join(','))
      .join('\n');
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

  private async upsertScheduledOperationalIncident(
    actor: AdminAuthenticatedUser,
    input: {
      description: string;
      severity: AdminOperationalIncidentSeverity;
      sourceId: string;
      sourceType: string;
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
      const incident =
        existingIncident ??
        repositories.incidentsRepository.create({
          created_by_admin_id: actor.id,
          resolution_summary: null,
          resolved_at: null,
          resolved_by_admin_id: null,
          source_id: sourceId,
          source_type: sourceType,
          status: AdminOperationalIncidentStatus.Open,
          target_user_id: null,
        });

      incident.description = description;
      incident.severity = existingIncident
        ? this.maxIncidentSeverity(existingIncident.severity, severity)
        : severity;
      incident.title = title;

      const savedIncident =
        await repositories.incidentsRepository.save(incident);
      if (!existingIncident) {
        await this.writeUserAuditLog(repositories.auditLogsRepository, {
          action: AdminAuditAction.OperationalIncidentCreated,
          actor,
          context: {
            ...context,
            reason: 'Queued operational incident opened',
          },
          metadata: {
            automated: true,
            incidentId: savedIncident.id,
            severity: savedIncident.severity,
            sourceId,
            sourceType,
            title,
          },
          targetUserId: null,
        });
      }

      return this.toOperationalIncidentResponse(
        savedIncident,
        this.actorMap(actor),
        new Map(),
      );
    });
  }

  async restrictUser(
    actor: AdminAuthenticatedUser,
    userId: string,
    context: AdminUserRestrictionContext,
  ): Promise<AdminUserResponse> {
    const reason = this.normalizeAuditReason(context.reason);

    return this.runUserMutation(async (repositories) => {
      const user = await this.findUserForAdminMutation(
        repositories.usersRepository,
        userId,
      );
      const capabilities = this.normalizeRestrictionCapabilities(
        context.capabilities,
      );
      const expiresAt = this.normalizeRestrictionExpiry(context.expiresAt);
      const internalNote = this.normalizeRestrictionText(
        context.internalNote,
        'Admin restriction internal note is required',
        1000,
        8,
      );
      const userMessage = this.normalizeOptionalRestrictionText(
        context.userMessage,
        'Admin restriction user message is too long',
        500,
      );
      const shouldRevokeSessions =
        capabilities.includes(UserRestrictionCapability.DisableLogin) ||
        capabilities.includes(UserRestrictionCapability.ForceLogout);
      const restrictedAt = new Date();

      user.account_restricted_at = restrictedAt;
      user.account_restriction_reason = reason;
      user.account_restricted_by_admin_id = actor.id;
      user.account_restriction_capabilities = capabilities;
      user.account_restriction_expires_at = expiresAt;
      user.account_restriction_internal_note = internalNote;
      user.account_restriction_user_message = userMessage;
      if (
        capabilities.includes(
          UserRestrictionCapability.ForceEmailReverification,
        )
      ) {
        user.email_verified = false;
      }
      const savedUser = await repositories.usersRepository.save(user);

      if (shouldRevokeSessions) {
        await repositories.sessionsRepository.update(
          { revoked_at: IsNull(), user_id: user.id },
          { revoked_at: restrictedAt },
        );
      }

      await this.writeUserAuditLog(repositories.auditLogsRepository, {
        action: AdminAuditAction.UserRestricted,
        actor,
        context: { ...context, reason },
        metadata: {
          capabilities,
          expiresAt: expiresAt ? expiresAt.toISOString() : null,
          revokedSessions: shouldRevokeSessions,
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
      user.account_restriction_capabilities = null;
      user.account_restriction_expires_at = null;
      user.account_restriction_internal_note = null;
      user.account_restriction_user_message = null;
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

  async listPlatformGlobalRestrictions(
    now = new Date(),
  ): Promise<AdminPlatformGlobalRestrictionListResponse> {
    const rows = toQueryRows(
      await this.dataSource.query(
        `
          WITH expired_restrictions AS (
            UPDATE platform_global_restrictions
            SET
              disabled_at = expires_at,
              disabled_by_admin_id = NULL,
              disable_reason = 'Expired automatically',
              updated_at = now()
            WHERE disabled_at IS NULL
              AND expires_at IS NOT NULL
              AND expires_at <= now()
            RETURNING id
          )
          SELECT
            restrictions.id,
            restrictions.capability,
            restrictions.reason,
            restrictions.enabled_by_admin_id,
            restrictions.enabled_at,
            restrictions.expires_at,
            enabled_admin.email AS enabled_by_admin_email,
            enabled_admin.name AS enabled_by_admin_name
          FROM platform_global_restrictions restrictions
          LEFT JOIN admin_accounts enabled_admin
            ON enabled_admin.id = restrictions.enabled_by_admin_id
          WHERE restrictions.disabled_at IS NULL
            AND (restrictions.expires_at IS NULL OR restrictions.expires_at > now())
          ORDER BY restrictions.enabled_at DESC, restrictions.id DESC
        `,
        [],
      ),
    );
    const rowByCapability = new Map(
      rows
        .filter((row) =>
          isPlatformGlobalRestrictionCapability(toStringValue(row.capability)),
        )
        .map((row) => [toStringValue(row.capability), row]),
    );

    return {
      generatedAt: now.toISOString(),
      restrictions: PLATFORM_GLOBAL_RESTRICTION_CAPABILITIES.map((capability) =>
        this.toPlatformGlobalRestrictionResponse(
          capability,
          rowByCapability.get(capability) ?? null,
        ),
      ),
    };
  }

  async enablePlatformGlobalRestriction(
    actor: AdminAuthenticatedUser,
    capability: PlatformGlobalRestrictionCapability,
    context: AdminPlatformGlobalRestrictionEnableContext,
  ): Promise<AdminPlatformGlobalRestrictionResponse> {
    this.assertPlatformGlobalRestrictionCapability(capability);
    const reason = this.normalizeAuditReason(context.reason);
    const internalNote = this.normalizeRestrictionText(
      context.internalNote,
      'Admin restriction internal note is required',
      1000,
      8,
    );
    const expiresAt = this.normalizeRestrictionExpiry(context.expiresAt);
    const restrictionId = ulid();

    return this.dataSource.transaction(async (manager) => {
      await this.lockPlatformGlobalRestrictionCapability(manager, capability);

      await manager.query(
        `
          UPDATE platform_global_restrictions
          SET
            disabled_at = now(),
            disabled_by_admin_id = $1,
            disable_reason = $2,
            updated_at = now()
          WHERE capability = $3
            AND disabled_at IS NULL
        `,
        [actor.id, 'Superseded by a newer global restriction', capability],
      );

      const rows = toQueryRows(
        await manager.query(
          `
            INSERT INTO platform_global_restrictions (
              id,
              capability,
              reason,
              internal_note,
              enabled_by_admin_id,
              enabled_at,
              expires_at
            )
            VALUES ($1, $2, $3, $4, $5, now(), $6)
            RETURNING
              id,
              capability,
              reason,
              enabled_by_admin_id,
              enabled_at,
              expires_at
          `,
          [
            restrictionId,
            capability,
            reason,
            platformGlobalRestrictionInternalNoteTransformer.to(internalNote),
            actor.id,
            expiresAt,
          ],
        ),
      );
      const row = rows[0] ?? {};

      await this.writeUserAuditLog(manager.getRepository(AdminAuditLog), {
        action: AdminAuditAction.PlatformGlobalRestrictionEnabled,
        actor,
        context: { ...context, reason },
        metadata: {
          capability,
          expiresAt: expiresAt ? expiresAt.toISOString() : null,
          restrictionId,
        },
        targetUserId: null,
      });

      return this.toPlatformGlobalRestrictionResponse(capability, {
        ...row,
        enabled_by_admin_email: actor.email,
        enabled_by_admin_name: actor.name,
      });
    });
  }

  async disablePlatformGlobalRestriction(
    actor: AdminAuthenticatedUser,
    capability: PlatformGlobalRestrictionCapability,
    context: AdminUserAuditContext,
  ): Promise<AdminPlatformGlobalRestrictionResponse> {
    this.assertPlatformGlobalRestrictionCapability(capability);
    const reason = this.normalizeAuditReason(context.reason);

    return this.dataSource.transaction(async (manager) => {
      await this.lockPlatformGlobalRestrictionCapability(manager, capability);

      const rows = toQueryRows(
        await manager.query(
          `
            UPDATE platform_global_restrictions
            SET
              disabled_at = now(),
              disabled_by_admin_id = $1,
              disable_reason = $2,
              updated_at = now()
            WHERE capability = $3
              AND disabled_at IS NULL
              AND (expires_at IS NULL OR expires_at > now())
            RETURNING id, capability
          `,
          [actor.id, reason, capability],
        ),
      );

      if (rows.length === 0) {
        throw new NotFoundException('Global platform restriction not found');
      }

      await this.writeUserAuditLog(manager.getRepository(AdminAuditLog), {
        action: AdminAuditAction.PlatformGlobalRestrictionDisabled,
        actor,
        context: { ...context, reason },
        metadata: {
          capability,
          restrictionId: toNullableString(rows[0]?.id),
        },
        targetUserId: null,
      });

      return this.toPlatformGlobalRestrictionResponse(capability, null);
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

          UNION ALL

          SELECT
            3 AS sort_order,
            'ingredient-analysis' AS id,
            'Ingredient analysis' AS label,
            COUNT(*) FILTER (WHERE status = ANY($8::text[]))::int AS queued,
            COUNT(*) FILTER (WHERE status = $9)::int AS failed,
            FLOOR(
              EXTRACT(
                EPOCH FROM (
                  $7::timestamptz -
                  MIN(run_after) FILTER (WHERE status = ANY($8::text[]))
                )
              )
            )::int AS oldest_queued_age_seconds
          FROM ingredient_product_analysis_jobs
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
          [...JOB_HEALTH_CONFIGS[3].activeStatuses],
          JOB_HEALTH_CONFIGS[3].failedStatus,
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
    const ingredientAnalysisCompletedCount = toNumber(
      row.ingredient_analysis_completed_count,
    );
    const ingredientAnalysisFailedCount = toNumber(
      row.ingredient_analysis_failed_count,
    );
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
      ingredientAnalysisCompletedCount +
      smartPickCompletedCount;
    const aiFailedCount =
      analysisFailedCount +
      suggestionFailedCount +
      insightFailedCount +
      productCheckFailedCount +
      ingredientAnalysisFailedCount +
      smartPickFailedCount;
    const aiTotalCount = aiSuccessfulCount + aiFailedCount;
    const todayAiCostUsd =
      toNumber(row.journal_ai_cost_today) +
      toNumber(row.suggestion_ai_cost_today) +
      toNumber(row.journal_insights_ai_cost_today) +
      toNumber(row.product_check_ai_cost_today) +
      toNumber(row.ingredient_analysis_ai_cost_today) +
      toNumber(row.smart_pick_ai_cost_today);
    const monthToDateAiCostUsd =
      toNumber(row.journal_ai_cost_mtd) +
      toNumber(row.suggestion_ai_cost_mtd) +
      toNumber(row.journal_insights_ai_cost_mtd) +
      toNumber(row.product_check_ai_cost_mtd) +
      toNumber(row.ingredient_analysis_ai_cost_mtd) +
      toNumber(row.smart_pick_ai_cost_mtd);
    const alerts = this.buildAlerts({
      failedExportCount,
      jobHealth,
      pendingDeletionCount,
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
          id: 'ingredient_analysis',
          label: 'Ingredient analysis',
          todayCostUsd: toNumber(row.ingredient_analysis_ai_cost_today),
          monthToDateCostUsd: toNumber(row.ingredient_analysis_ai_cost_mtd),
          successRate: percentage(
            ingredientAnalysisCompletedCount,
            ingredientAnalysisCompletedCount + ingredientAnalysisFailedCount,
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
        {
          id: 'ingredient_analysis_ai_cost',
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
              AND event_type = 'data_accessed'
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
    const [api, database, userTraffic] = await Promise.all([
      this.getBackendApiHealthComponent(now, checkedAt),
      this.getDatabaseHealthComponent(checkedAt),
      this.getUserApiTrafficHealthComponent(now, checkedAt),
    ]);
    const components = [api, database, userTraffic];

    return {
      checkedAt,
      components,
      status: resolveAggregateStatus(
        components.map((component) => component.status),
      ),
    };
  }

  private async getBackendApiHealthComponent(
    now: Date,
    checkedAt: string,
  ): Promise<
    AdminOperationsMonitoringResponse['backendHealth']['components'][number]
  > {
    const since = new Date(
      now.getTime() - BACKEND_API_HEALTH_WINDOW_MINUTES * 60 * 1000,
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
          ? AdminJobStatus.Healthy
          : resolveEndpointStatus(errorRate, p95LatencyMs);

      return {
        checkedAt,
        errorRate,
        id: 'api',
        label: 'Backend API',
        latencyMs: null,
        message:
          requestCount === 0
            ? 'The Ritora API process responded; no recent request telemetry has been recorded.'
            : 'The Ritora API process responded and recent request telemetry is being observed.',
        p95LatencyMs,
        requestCount,
        status,
        windowMinutes: BACKEND_API_HEALTH_WINDOW_MINUTES,
      };
    } catch {
      return {
        checkedAt,
        errorRate: null,
        id: 'api',
        label: 'Backend API',
        latencyMs: null,
        message:
          'The Ritora API process responded, but telemetry is unavailable.',
        p95LatencyMs: null,
        requestCount: null,
        status: AdminJobStatus.Warning,
        windowMinutes: BACKEND_API_HEALTH_WINDOW_MINUTES,
      };
    }
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
              'ingredient-analysis' AS type,
              'Ingredient analysis' AS label,
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
                WHEN jobs.status = $8 THEN 'critical'
                ELSE 'warning'
              END AS severity
            FROM ingredient_product_analysis_jobs jobs
            LEFT JOIN users ON users.id = jobs.user_id
            WHERE jobs.status = $8
              OR (jobs.status = ANY($9::text[]) AND jobs.run_after <= $3)

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
            WHERE exports.status = $10

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
                WHEN users.account_deletion_scheduled_for <= $11 THEN 'critical'
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
          LIMIT $12
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
          IngredientProductAnalysisJobStatus.Failed,
          [
            IngredientProductAnalysisJobStatus.Queued,
            IngredientProductAnalysisJobStatus.Sent,
            IngredientProductAnalysisJobStatus.Running,
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

  private toAnalysisFeedbackSummary(
    row: QueryRow | undefined,
  ): AdminSkinJournalAnalysisFeedbackSummaryResponse {
    const total = toNumber(row?.total);
    const helpful = toNumber(row?.helpful);
    const notHelpful = toNumber(row?.not_helpful);
    const helpfulRate = toRate(helpful, total);

    return {
      helpful,
      helpfulRate,
      needsReview:
        total >= ADMIN_ANALYSIS_FEEDBACK_REVIEW_MIN_RESPONSES &&
        helpfulRate < ADMIN_ANALYSIS_FEEDBACK_REVIEW_HELPFUL_RATE,
      notHelpful,
      notHelpfulRate: toRate(notHelpful, total),
      total,
    };
  }

  private toAnalysisFeedbackCoverage(
    row: QueryRow | undefined,
  ): AdminSkinJournalAnalysisFeedbackCoverageResponse {
    const analysesWithFeedback = toNumber(row?.analyses_with_feedback);
    const analysesWithoutFeedback = toNumber(row?.analyses_without_feedback);
    const total = analysesWithFeedback + analysesWithoutFeedback;

    return {
      analysesWithFeedback,
      analysesWithoutFeedback,
      feedbackRate: toRate(analysesWithFeedback, total),
    };
  }

  private toAnalysisFeedbackCounts(
    rows: QueryRow[],
    total: number,
  ): AdminSkinJournalAnalysisFeedbackCountResponse[] {
    return rows.map((row) => {
      const count = toNumber(row.count);

      return {
        count,
        id: toNullableString(row.id),
        label: toStringValue(row.label),
        rate: toRate(count, total),
      };
    });
  }

  private toSkinJournalAnalysisFeedbackResponse(
    feedback: SkinJournalAnalysisFeedback,
  ): AdminSkinJournalAnalysisFeedbackItemResponse {
    return {
      concernKeys: feedback.concern_keys,
      createdAt: toIsoString(feedback.created_at),
      interpretationVersion: feedback.interpretation_version,
      note: feedback.note,
      readingLabel: feedback.reading_label,
      reason: feedback.reason,
      updatedAt: toIsoString(feedback.updated_at),
      vote: feedback.vote,
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
      description: toDecryptedStringValue(
        incident.description,
        encryptedIncidentDescriptionTransformer,
      ),
      id: toStringValue(incident.id),
      resolutionSummary: toNullableEncryptedString(
        incident.resolution_summary,
        encryptedIncidentResolutionTransformer,
      ),
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

  private toAdminNotificationResponse(
    notification: AdminNotification,
  ): AdminNotificationResponse {
    return {
      actionUrl: notification.action_url,
      body: notification.body,
      createdAt:
        toNullableIso(notification.created_at) ?? toIsoString(new Date(0)),
      id: notification.id,
      metadata: this.safeNotificationMetadata(notification.metadata),
      readAt: toNullableIso(notification.read_at),
      severity: notification.severity,
      title: notification.title,
      type: notification.type,
    };
  }

  private async loadAccountMonitoringThresholds(): Promise<AdminAccountMonitoringThresholds> {
    const settings = await this.dataSource
      .getRepository(AdminAccountMonitoringSettings)
      .findOne({ where: { id: ADMIN_ACCOUNT_MONITORING_SETTINGS_ID } });

    return this.normalizeAccountMonitoringThresholds(settings?.thresholds);
  }

  private normalizeAccountMonitoringThresholds(
    value: Partial<AdminAccountMonitoringThresholds> | null | undefined,
  ): AdminAccountMonitoringThresholds {
    const thresholds = {
      ...DEFAULT_ACCOUNT_MONITORING_THRESHOLDS,
      ...(value ?? {}),
    };
    const aiGenerations24hWarning = this.normalizeThresholdInteger(
      thresholds.aiGenerations24hWarning,
      DEFAULT_ACCOUNT_MONITORING_THRESHOLDS.aiGenerations24hWarning,
    );
    const aiCost24hWarningUsd = this.normalizeThresholdNumber(
      thresholds.aiCost24hWarningUsd,
      DEFAULT_ACCOUNT_MONITORING_THRESHOLDS.aiCost24hWarningUsd,
    );
    const unknownAuthFailures24hWarning = this.normalizeThresholdInteger(
      thresholds.unknownAuthFailures24hWarning,
      DEFAULT_ACCOUNT_MONITORING_THRESHOLDS.unknownAuthFailures24hWarning,
    );
    const aiGenerations24hCritical = Math.max(
      aiGenerations24hWarning,
      this.normalizeThresholdInteger(
        thresholds.aiGenerations24hCritical,
        DEFAULT_ACCOUNT_MONITORING_THRESHOLDS.aiGenerations24hCritical,
      ),
    );
    const aiCost24hCriticalUsd = Math.max(
      aiCost24hWarningUsd,
      this.normalizeThresholdNumber(
        thresholds.aiCost24hCriticalUsd,
        DEFAULT_ACCOUNT_MONITORING_THRESHOLDS.aiCost24hCriticalUsd,
      ),
    );
    const unknownAuthFailures24hCritical = Math.max(
      unknownAuthFailures24hWarning,
      this.normalizeThresholdInteger(
        thresholds.unknownAuthFailures24hCritical,
        DEFAULT_ACCOUNT_MONITORING_THRESHOLDS.unknownAuthFailures24hCritical,
      ),
    );

    return {
      aiCost24hCriticalUsd,
      aiCost24hWarningUsd,
      aiGenerations24hCritical,
      aiGenerations24hWarning,
      authFailures24hWarning: this.normalizeThresholdInteger(
        thresholds.authFailures24hWarning,
        DEFAULT_ACCOUNT_MONITORING_THRESHOLDS.authFailures24hWarning,
      ),
      deletionEvents30dWarning: this.normalizeThresholdInteger(
        thresholds.deletionEvents30dWarning,
        DEFAULT_ACCOUNT_MONITORING_THRESHOLDS.deletionEvents30dWarning,
      ),
      mediaCleanupAttempts24hWarning: this.normalizeThresholdInteger(
        thresholds.mediaCleanupAttempts24hWarning,
        DEFAULT_ACCOUNT_MONITORING_THRESHOLDS.mediaCleanupAttempts24hWarning,
      ),
      mediaCleanupFailures24hWarning: this.normalizeThresholdInteger(
        thresholds.mediaCleanupFailures24hWarning,
        DEFAULT_ACCOUNT_MONITORING_THRESHOLDS.mediaCleanupFailures24hWarning,
      ),
      passwordResets24hWarning: this.normalizeThresholdInteger(
        thresholds.passwordResets24hWarning,
        DEFAULT_ACCOUNT_MONITORING_THRESHOLDS.passwordResets24hWarning,
      ),
      productExtractions24hWarning: this.normalizeThresholdInteger(
        thresholds.productExtractions24hWarning,
        DEFAULT_ACCOUNT_MONITORING_THRESHOLDS.productExtractions24hWarning,
      ),
      safetyReactionSignals7dWarning: this.normalizeThresholdInteger(
        thresholds.safetyReactionSignals7dWarning,
        DEFAULT_ACCOUNT_MONITORING_THRESHOLDS.safetyReactionSignals7dWarning,
      ),
      unknownAuthFailures24hCritical,
      unknownAuthFailures24hWarning,
      uploadFailures24hWarning: this.normalizeThresholdInteger(
        thresholds.uploadFailures24hWarning,
        DEFAULT_ACCOUNT_MONITORING_THRESHOLDS.uploadFailures24hWarning,
      ),
    };
  }

  private normalizeThresholdInteger(value: unknown, fallback: number): number {
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > 10000
    ) {
      return fallback;
    }

    return value;
  }

  private normalizeThresholdNumber(value: unknown, fallback: number): number {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 100000
    ) {
      return fallback;
    }

    return value;
  }

  private async loadSystemMonitoringActor(
    sessionId: string,
  ): Promise<AdminAuthenticatedUser | null> {
    const accountsRepository = this.dataSource.getRepository(AdminAccount);
    const root = await accountsRepository.findOne({
      order: { created_at: 'ASC' },
      where: {
        role: AdminAccountRole.Root,
        status: AdminAccountStatus.Active,
      },
    });
    const account =
      root ??
      (await accountsRepository.findOne({
        order: { created_at: 'ASC' },
        where: { status: AdminAccountStatus.Active },
      }));

    if (!account) {
      return null;
    }

    return {
      email: account.email,
      id: account.id,
      name: account.name,
      role: account.role,
      sessionId,
      status: account.status,
    };
  }

  private async notifyAccountMonitoringOwners(
    notifications: readonly AccountMonitoringOwnerNotification[],
  ): Promise<void> {
    for (const notification of notifications) {
      await this.notifyAccountMonitoringOwner(notification);
    }
  }

  private async notifyAccountMonitoringOwner(
    notification: AccountMonitoringOwnerNotification,
  ): Promise<void> {
    const owner =
      notification.flag.assignedAdmin ?? notification.flag.createdBy ?? null;
    if (!owner?.email) {
      return;
    }

    await this.createAccountMonitoringAdminNotification(owner.id, notification);

    if (!this.mailService) {
      return;
    }

    try {
      await this.mailService.sendAdminAccountMonitoringAlertEmail({
        email: owner.email,
        flagId: notification.flag.id,
        ownerName: owner.name || owner.email,
        reason: notification.reason,
        severity: notification.flag.severity,
        signalType: notification.flag.signalType,
        status: notification.flag.status,
        summary: notification.flag.summary,
        userEmail: notification.flag.user.email,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to notify account monitoring owner ${owner.id}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async createAccountMonitoringAdminNotification(
    adminId: string,
    notification: AccountMonitoringOwnerNotification,
  ): Promise<void> {
    try {
      const notificationsRepository =
        this.dataSource.getRepository(AdminNotification);
      const title =
        notification.reason === 'assigned'
          ? 'Account monitoring flag assigned'
          : notification.reason === 'refreshed'
            ? 'Account monitoring flag refreshed'
            : 'Account monitoring flag opened';
      const adminNotification = notificationsRepository.create({
        action_url: '/account-monitoring?status=active',
        admin_id: adminId,
        body: `${notification.flag.summary} for ${notification.flag.user.email}.`,
        metadata: {
          flagId: notification.flag.id,
          reason: notification.reason,
          severity: notification.flag.severity,
          signalType: notification.flag.signalType,
          status: notification.flag.status,
          userId: notification.flag.userId,
        },
        read_at: null,
        severity: this.toAdminNotificationSeverity(notification.flag.severity),
        title,
        type: AdminNotificationType.AccountMonitoringAlert,
      });
      await notificationsRepository.save(adminNotification);
    } catch (error) {
      this.logger.warn(
        `Failed to create account monitoring in-app notification for admin ${adminId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private toAdminNotificationSeverity(
    severity: AdminAccountMonitoringSeverity,
  ): AdminNotificationSeverity {
    if (severity === AdminAccountMonitoringSeverity.Critical) {
      return AdminNotificationSeverity.Critical;
    }
    if (severity === AdminAccountMonitoringSeverity.Warning) {
      return AdminNotificationSeverity.Warning;
    }
    return AdminNotificationSeverity.Info;
  }

  private async loadAccountMonitoringEventTimelineItems(
    flag: AdminAccountMonitoringFlag,
    limit: number,
  ): Promise<AdminAccountMonitoringEventTimelineItemResponse[]> {
    const eventTypes = this.accountMonitoringEventTypesForSignal(
      flag.signal_type,
    );
    if (eventTypes.length === 0) {
      return [];
    }

    const events = await this.dataSource
      .getRepository(AccountMonitoringEvent)
      .find({
        order: { occurred_at: 'DESC' },
        take: limit,
        where: {
          event_type: In(eventTypes),
          user_id: flag.user_id,
        },
      });

    return events.map((event) =>
      this.toMonitoringEventTimelineItem(event, flag.signal_type),
    );
  }

  private async loadSyntheticMonitoringTimelineItems(
    flag: AdminAccountMonitoringFlag,
    limit: number,
  ): Promise<AdminAccountMonitoringEventTimelineItemResponse[]> {
    const sql = this.timelineSqlForSignal(flag.signal_type);
    if (!sql) {
      return [];
    }

    const rows = toQueryRows(
      await this.dataSource.query(sql, [flag.user_id, limit]),
    );
    return rows.map((row) => ({
      eventType: toStringValue(row.event_type),
      id: toStringValue(row.id),
      metadata: this.safeTimelineMetadata(row.metadata),
      occurredAt: toNullableIso(row.occurred_at) ?? toIsoString(new Date(0)),
      sourceType: toStringValue(row.source_type),
      summary: toStringValue(row.summary),
    }));
  }

  private accountMonitoringEventTypesForSignal(
    signalType: AdminAccountMonitoringSignalType,
  ): AccountMonitoringEventType[] {
    if (signalType === AdminAccountMonitoringSignalType.RepeatedAuthFailures) {
      return [
        AccountMonitoringEventType.AuthLoginFailed,
        AccountMonitoringEventType.OAuthLoginFailed,
        AccountMonitoringEventType.PasswordResetRequested,
      ];
    }
    if (
      signalType === AdminAccountMonitoringSignalType.RepeatedUploadFailures
    ) {
      return [AccountMonitoringEventType.SkinJournalPhotoUploadFailed];
    }
    if (
      signalType === AdminAccountMonitoringSignalType.DeletionComplianceWatch
    ) {
      return [
        AccountMonitoringEventType.AccountDeletionCancelled,
        AccountMonitoringEventType.AccountDeletionRequested,
      ];
    }
    if (signalType === AdminAccountMonitoringSignalType.SupportEscalation) {
      return [AccountMonitoringEventType.SupportEscalationReceived];
    }

    return [];
  }

  private toMonitoringEventTimelineItem(
    event: AccountMonitoringEvent,
    signalType: AdminAccountMonitoringSignalType,
  ): AdminAccountMonitoringEventTimelineItemResponse {
    return {
      eventType: event.event_type,
      id: event.id,
      metadata: this.safeTimelineMetadata(event.metadata),
      occurredAt: toIsoString(event.occurred_at),
      sourceType: 'account_monitoring_events',
      summary: this.monitoringEventTimelineSummary(event, signalType),
    };
  }

  private monitoringEventTimelineSummary(
    event: AccountMonitoringEvent,
    signalType: AdminAccountMonitoringSignalType,
  ): string {
    const provider =
      typeof event.metadata.provider === 'string'
        ? ` (${event.metadata.provider})`
        : '';
    const supportReference =
      typeof event.metadata.supportReference === 'string'
        ? ` ${event.metadata.supportReference}`
        : '';
    const summaries: Record<AccountMonitoringEventType, string> = {
      [AccountMonitoringEventType.AccountDeletionCancelled]:
        'Account deletion cancellation was recorded.',
      [AccountMonitoringEventType.AccountDeletionRequested]:
        'Account deletion request was recorded.',
      [AccountMonitoringEventType.AuthLoginFailed]:
        'Email/password authentication failure was recorded.',
      [AccountMonitoringEventType.OAuthLoginFailed]: `OAuth authentication failure was recorded${provider}.`,
      [AccountMonitoringEventType.PasswordResetRequested]:
        'Password reset activity was recorded.',
      [AccountMonitoringEventType.SkinJournalPhotoUploadFailed]:
        'Skin Journal photo upload failure was recorded.',
      [AccountMonitoringEventType.SupportEscalationReceived]: `Support escalation${supportReference} was received.`,
    };

    return (
      summaries[event.event_type] ??
      `Monitoring event recorded for ${signalType}.`
    );
  }

  private safeTimelineMetadata(
    value: unknown,
  ): Record<string, string | number | boolean | null> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    const record = value as Record<string, unknown>;
    const allowedKeys = [
      'attemptCount',
      'costUsd',
      'provider',
      'reason',
      'severity',
      'source',
      'status',
      'supportReference',
    ] as const;
    return allowedKeys.reduce<Record<string, string | number | boolean | null>>(
      (metadata, key) => {
        const item = record[key];
        if (
          typeof item === 'string' ||
          typeof item === 'number' ||
          typeof item === 'boolean' ||
          item === null
        ) {
          metadata[key] = item;
        }
        return metadata;
      },
      {},
    );
  }

  private safeNotificationMetadata(
    value: unknown,
  ): Record<string, string | number | boolean | null> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    const record = value as Record<string, unknown>;
    const allowedKeys = [
      'flagId',
      'incidentId',
      'reason',
      'severity',
      'signalType',
      'sourceId',
      'sourceType',
      'status',
      'userId',
    ] as const;
    return allowedKeys.reduce<Record<string, string | number | boolean | null>>(
      (metadata, key) => {
        const item = record[key];
        if (
          typeof item === 'string' ||
          typeof item === 'number' ||
          typeof item === 'boolean' ||
          item === null
        ) {
          metadata[key] = item;
        }
        return metadata;
      },
      {},
    );
  }

  private timelineSqlForSignal(
    signalType: AdminAccountMonitoringSignalType,
  ): string | null {
    if (signalType === AdminAccountMonitoringSignalType.HighAiCost) {
      return `
        WITH timeline AS (
          SELECT id, COALESCE(analysis_completed_at, analysis_started_at, created_at) AS occurred_at,
            'skin_journal_analysis' AS event_type,
            'skin_journal_entries' AS source_type,
            'Skin Journal analysis cost was recorded.' AS summary,
            jsonb_build_object('source', 'skin_journal_analysis', 'costUsd', COALESCE(analysis_estimated_cost_usd, 0)::float) AS metadata
          FROM skin_journal_entries
          WHERE user_id = $1 AND analysis_status = 'completed'
          UNION ALL
          SELECT id, COALESCE(completed_at, created_at) AS occurred_at,
            'skin_journal_insight_generation' AS event_type,
            'skin_journal_insight_generation_runs' AS source_type,
            'Skin Journal insight generation cost was recorded.' AS summary,
            jsonb_build_object('source', 'skin_journal_insights', 'costUsd', COALESCE(ai_estimated_cost_usd, 0)::float, 'status', status) AS metadata
          FROM skin_journal_insight_generation_runs
          WHERE user_id = $1 AND status = 'completed'
          UNION ALL
          SELECT id, occurred_at, 'product_check_ai_review' AS event_type,
            'product_check_ai_review_metrics' AS source_type,
            'Product check AI cost was recorded.' AS summary,
            jsonb_build_object('source', COALESCE(product_source, 'unknown'), 'costUsd', COALESCE(ai_estimated_cost_usd, 0)::float) AS metadata
          FROM product_check_ai_review_metrics
          WHERE user_id = $1
          UNION ALL
          SELECT id, occurred_at, 'ingredient_analysis_ai_usage' AS event_type,
            'ingredient_analysis_ai_usage_metrics' AS source_type,
            'Ingredient analysis AI cost was recorded.' AS summary,
            jsonb_build_object('source', source, 'operation', operation, 'costUsd', COALESCE(ai_estimated_cost_usd, 0)::float, 'status', status) AS metadata
          FROM ingredient_analysis_ai_usage_metrics
          WHERE user_id = $1
          UNION ALL
          SELECT id, generated_at AS occurred_at, 'smart_picks_snapshot' AS event_type,
            'smart_pick_snapshots' AS source_type,
            'Smart Picks snapshot cost was recorded.' AS summary,
            jsonb_build_object('source', 'smart_picks_snapshot', 'costUsd', COALESCE(ai_estimated_cost_usd, 0)::float) AS metadata
          FROM smart_pick_snapshots
          WHERE user_id = $1
          UNION ALL
          SELECT id, updated_at AS occurred_at, 'smart_picks_generation' AS event_type,
            'smart_pick_generation_jobs' AS source_type,
            'Smart Picks AI generation completed.' AS summary,
            jsonb_build_object('source', 'smart_picks', 'costUsd', COALESCE(ai_estimated_cost_usd, 0)::float, 'status', status) AS metadata
          FROM smart_pick_generation_jobs
          WHERE user_id = $1 AND status = 'completed'
          UNION ALL
          SELECT id, generated_at AS occurred_at, 'suggestion_generation' AS event_type,
            'suggestion_instances' AS source_type,
            'Suggestion AI generation completed.' AS summary,
            jsonb_build_object('source', 'suggestions', 'costUsd', COALESCE(ai_estimated_cost_usd, 0)::float, 'status', generation_status) AS metadata
          FROM suggestion_instances
          WHERE user_id = $1 AND generated_at IS NOT NULL AND generation_status = 'ready'
        )
        SELECT * FROM timeline ORDER BY occurred_at DESC LIMIT $2
      `;
    }

    if (
      signalType === AdminAccountMonitoringSignalType.ProductExtractionAbuse
    ) {
      return `
        SELECT id, occurred_at, 'product_photo_extraction' AS event_type,
          'product_check_ai_review_metrics' AS source_type,
          'Product photo extraction was processed.' AS summary,
          jsonb_build_object('source', COALESCE(product_source, 'unknown'), 'costUsd', COALESCE(ai_estimated_cost_usd, 0)::float) AS metadata
        FROM product_check_ai_review_metrics
        WHERE user_id = $1 AND product_source = 'photo_extraction'
        ORDER BY occurred_at DESC
        LIMIT $2
      `;
    }

    if (
      signalType ===
      AdminAccountMonitoringSignalType.SafetyCriticalReactionSignals
    ) {
      return `
        SELECT id, created_at AS occurred_at, 'skin_journal_reaction' AS event_type,
          'skin_journal_events' AS source_type,
          'Reaction safety signal was recorded.' AS summary,
          jsonb_build_object('severity', severity, 'source', kind) AS metadata
        FROM skin_journal_events
        WHERE user_id = $1
          AND kind = 'reaction_detected'
          AND severity IN ('warning', 'critical')
        ORDER BY created_at DESC
        LIMIT $2
      `;
    }

    if (
      signalType === AdminAccountMonitoringSignalType.RepeatedUploadFailures
    ) {
      return `
        SELECT id, updated_at AS occurred_at, 'media_cleanup_failed' AS event_type,
          'skin_journal_media_deletion_jobs' AS source_type,
          'Media cleanup job failed.' AS summary,
          jsonb_build_object('status', status, 'attemptCount', attempt_count) AS metadata
        FROM skin_journal_media_deletion_jobs
        WHERE user_id = $1 AND status = 'failed'
        ORDER BY updated_at DESC
        LIMIT $2
      `;
    }

    return null;
  }

  private async loadAutomatedMonitoringCandidates(
    scannedAt: Date,
    thresholds: AdminAccountMonitoringThresholds,
  ): Promise<AccountMonitoringAutomatedCandidate[]> {
    const rows = toQueryRows(
      await this.dataSource.query(
        `
          WITH ai_events AS (
            SELECT user_id, analysis_started_at AS occurred_at,
              COALESCE(analysis_estimated_cost_usd, 0)::float AS cost_usd
            FROM skin_journal_entries
            WHERE user_id IS NOT NULL AND analysis_started_at >= $1 AND analysis_status = 'completed'
            UNION ALL
            SELECT user_id, completed_at AS occurred_at,
              COALESCE(ai_estimated_cost_usd, 0)::float AS cost_usd
            FROM skin_journal_insight_generation_runs
            WHERE user_id IS NOT NULL AND completed_at >= $1 AND status = 'completed'
            UNION ALL
            SELECT user_id, generated_at AS occurred_at,
              COALESCE(ai_estimated_cost_usd, 0)::float AS cost_usd
            FROM suggestion_instances
            WHERE user_id IS NOT NULL AND generated_at >= $1 AND generation_status = 'ready'
            UNION ALL
            SELECT user_id, occurred_at, COALESCE(ai_estimated_cost_usd, 0)::float AS cost_usd
            FROM product_check_ai_review_metrics
            WHERE user_id IS NOT NULL AND occurred_at >= $1
            UNION ALL
            SELECT user_id, occurred_at, COALESCE(ai_estimated_cost_usd, 0)::float AS cost_usd
            FROM ingredient_analysis_ai_usage_metrics
            WHERE user_id IS NOT NULL AND occurred_at >= $1 AND status = 'completed'
            UNION ALL
            SELECT user_id, generated_at AS occurred_at,
              COALESCE(ai_estimated_cost_usd, 0)::float AS cost_usd
            FROM smart_pick_snapshots
            WHERE user_id IS NOT NULL AND generated_at >= $1
            UNION ALL
            SELECT user_id, updated_at AS occurred_at,
              COALESCE(ai_estimated_cost_usd, 0)::float AS cost_usd
            FROM smart_pick_generation_jobs
            WHERE user_id IS NOT NULL AND updated_at >= $1 AND status = 'completed'
            UNION ALL
            SELECT user_id, updated_at AS occurred_at, 0::float AS cost_usd
            FROM skin_journal_analysis_jobs
            WHERE user_id IS NOT NULL AND updated_at >= $1 AND status = 'failed'
            UNION ALL
            SELECT user_id, COALESCE(completed_at, created_at) AS occurred_at, 0::float AS cost_usd
            FROM skin_journal_insight_generation_runs
            WHERE user_id IS NOT NULL
              AND COALESCE(completed_at, created_at) >= $1
              AND status = 'failed'
            UNION ALL
            SELECT user_id, updated_at AS occurred_at, 0::float AS cost_usd
            FROM suggestion_generation_jobs
            WHERE user_id IS NOT NULL AND updated_at >= $1 AND status = 'failed'
            UNION ALL
            SELECT user_id, updated_at AS occurred_at, 0::float AS cost_usd
            FROM smart_pick_generation_jobs
            WHERE user_id IS NOT NULL AND updated_at >= $1 AND status = 'failed'
            UNION ALL
            SELECT user_id, occurred_at, 0::float AS cost_usd
            FROM ingredient_analysis_ai_usage_metrics
            WHERE user_id IS NOT NULL AND occurred_at >= $1 AND status = 'failed'
          ),
          auth_pressure_events AS (
            SELECT user_id, COUNT(*)::int AS event_count, MAX(occurred_at) AS latest_at
            FROM account_monitoring_events
            WHERE user_id IS NOT NULL
              AND occurred_at >= $1
              AND event_type IN ('auth_login_failed', 'oauth_login_failed')
              AND email_hash IS NOT NULL
            GROUP BY user_id, email_hash
            HAVING COUNT(*) >= $8
            UNION ALL
            SELECT user_id, COUNT(*)::int AS event_count, MAX(occurred_at) AS latest_at
            FROM account_monitoring_events
            WHERE user_id IS NOT NULL
              AND occurred_at >= $1
              AND event_type IN ('auth_login_failed', 'oauth_login_failed')
              AND ip_address_hash IS NOT NULL
            GROUP BY user_id, ip_address_hash
            HAVING COUNT(*) >= $8
            UNION ALL
            SELECT user_id, COUNT(*)::int AS event_count, MAX(occurred_at) AS latest_at
            FROM account_monitoring_events
            WHERE user_id IS NOT NULL
              AND occurred_at >= $1
              AND event_type = 'password_reset_requested'
              AND email_hash IS NOT NULL
            GROUP BY user_id, email_hash
            HAVING COUNT(*) >= $9
          ),
          raw_candidates AS (
            SELECT user_id, 'high_ai_cost' AS signal_type,
              CASE WHEN COUNT(*) >= $3 OR COALESCE(SUM(cost_usd), 0) >= $5 THEN 'critical' ELSE 'warning' END AS severity,
              'ai_usage_threshold' AS reason_code, COUNT(*)::int AS event_count,
              COALESCE(SUM(cost_usd), 0)::float AS cost_usd, MAX(occurred_at) AS latest_at
            FROM ai_events
            GROUP BY user_id
            HAVING COUNT(*) >= $2 OR COALESCE(SUM(cost_usd), 0) >= $4
            UNION ALL
            SELECT user_id, 'product_extraction_abuse',
              CASE WHEN COUNT(*) >= ($6 * 2) THEN 'critical' ELSE 'warning' END,
              'product_extraction_volume', COUNT(*)::int, 0::float, MAX(occurred_at)
            FROM product_check_ai_review_metrics
            WHERE user_id IS NOT NULL AND occurred_at >= $1 AND product_source = 'photo_extraction'
            GROUP BY user_id
            HAVING COUNT(*) >= $6
            UNION ALL
            SELECT user_id, 'repeated_upload_failures',
              CASE WHEN COUNT(*) >= ($7 * 2) THEN 'critical' ELSE 'warning' END,
              'upload_failures', COUNT(*)::int, 0::float, MAX(occurred_at)
            FROM account_monitoring_events
            WHERE user_id IS NOT NULL AND occurred_at >= $1 AND event_type = 'skin_journal_photo_upload_failed'
            GROUP BY user_id
            HAVING COUNT(*) >= $7
            UNION ALL
            SELECT user_id, 'repeated_auth_failures',
              CASE WHEN MAX(event_count) >= ($8 * 2) THEN 'critical' ELSE 'warning' END,
              'auth_failure_pressure', MAX(event_count)::int, 0::float, MAX(latest_at)
            FROM auth_pressure_events
            GROUP BY user_id
            UNION ALL
            SELECT user_id, 'deletion_compliance_watch', 'warning',
              'account_deletion_loop', COUNT(*)::int, 0::float, MAX(occurred_at)
            FROM account_monitoring_events
            WHERE user_id IS NOT NULL AND occurred_at >= $10
              AND event_type IN ('account_deletion_requested', 'account_deletion_cancelled')
            GROUP BY user_id
            HAVING COUNT(*) >= $11
              AND COUNT(*) FILTER (WHERE event_type = 'account_deletion_requested') >= 2
              AND COUNT(*) FILTER (WHERE event_type = 'account_deletion_cancelled') >= 1
            UNION ALL
            SELECT user_id, 'repeated_upload_failures',
              CASE WHEN COALESCE(SUM(attempt_count), 0) >= ($13 * 2) THEN 'critical' ELSE 'warning' END,
              'media_cleanup_failures', COUNT(*)::int,
              COALESCE(SUM(attempt_count), 0)::float, MAX(updated_at)
            FROM skin_journal_media_deletion_jobs
            WHERE user_id IS NOT NULL AND updated_at >= $1 AND status = 'failed'
            GROUP BY user_id
            HAVING COUNT(*) >= $12 OR COALESCE(SUM(attempt_count), 0) >= $13
            UNION ALL
            SELECT user_id, 'safety_critical_reaction_signals',
              CASE WHEN COUNT(*) FILTER (WHERE severity = 'critical') > 0 THEN 'critical' ELSE 'warning' END,
              'safety_reaction_signals', COUNT(*)::int, 0::float, MAX(created_at)
            FROM skin_journal_events
            WHERE user_id IS NOT NULL AND created_at >= $14
              AND kind = 'reaction_detected' AND severity IN ('warning', 'critical')
            GROUP BY user_id
            HAVING COUNT(*) >= $15
            UNION ALL
            SELECT user_id, 'support_escalation', 'warning',
              'support_escalation', COUNT(*)::int, 0::float, MAX(occurred_at)
            FROM account_monitoring_events
            WHERE user_id IS NOT NULL AND occurred_at >= $10
              AND event_type = 'support_escalation_received'
            GROUP BY user_id
          ),
          ranked_candidates AS (
            SELECT raw_candidates.*,
              ROW_NUMBER() OVER (
                PARTITION BY user_id, signal_type
                ORDER BY CASE severity WHEN 'critical' THEN 2 ELSE 1 END DESC, latest_at DESC
              ) AS candidate_rank
            FROM raw_candidates
          )
          SELECT ranked_candidates.*, users.email AS user_email,
            NULLIF(CONCAT_WS(' ', users.first_name, users.last_name), '') AS user_name
          FROM ranked_candidates
          JOIN users ON users.id = ranked_candidates.user_id
          WHERE candidate_rank = 1
          ORDER BY CASE severity WHEN 'critical' THEN 2 ELSE 1 END DESC, latest_at DESC
          LIMIT $16
        `,
        [
          new Date(scannedAt.getTime() - DAY_MS),
          thresholds.aiGenerations24hWarning,
          thresholds.aiGenerations24hCritical,
          thresholds.aiCost24hWarningUsd,
          thresholds.aiCost24hCriticalUsd,
          thresholds.productExtractions24hWarning,
          thresholds.uploadFailures24hWarning,
          thresholds.authFailures24hWarning,
          thresholds.passwordResets24hWarning,
          new Date(scannedAt.getTime() - 30 * DAY_MS),
          thresholds.deletionEvents30dWarning,
          thresholds.mediaCleanupFailures24hWarning,
          thresholds.mediaCleanupAttempts24hWarning,
          new Date(scannedAt.getTime() - 7 * DAY_MS),
          thresholds.safetyReactionSignals7dWarning,
          ADMIN_ACCOUNT_MONITORING_AUTOMATED_SCAN_LIMIT,
        ],
      ),
    );

    return rows
      .filter((row) => typeof row.user_id === 'string')
      .map((row) => ({
        costUsd: toNumber(row.cost_usd),
        eventCount: toNumber(row.event_count),
        latestAt: toNullableIso(row.latest_at),
        reasonCode: toStringValue(row.reason_code),
        severity: this.normalizeMonitoringSeverity(
          toStringValue(row.severity) as AdminAccountMonitoringSeverity,
        ),
        signalType: this.normalizeMonitoringSignalType(
          toStringValue(row.signal_type) as AdminAccountMonitoringSignalType,
        ),
        userEmail: toStringValue(row.user_email),
        userId: toStringValue(row.user_id),
        userName: toStringValue(row.user_name) || toStringValue(row.user_email),
      }));
  }

  private async loadPlatformMonitoringIncidentCandidates(
    scannedAt: Date,
    thresholds: AdminAccountMonitoringThresholds,
  ): Promise<AccountMonitoringSecurityIncidentCandidate[]> {
    const [authCandidates, mediaCandidates] = await Promise.all([
      this.loadUnknownAuthSecurityIncidentCandidates(scannedAt, thresholds),
      this.loadGlobalMediaCleanupIncidentCandidates(scannedAt, thresholds),
    ]);
    return [...authCandidates, ...mediaCandidates];
  }

  private async loadUnknownAuthSecurityIncidentCandidates(
    scannedAt: Date,
    thresholds: AdminAccountMonitoringThresholds,
  ): Promise<AccountMonitoringSecurityIncidentCandidate[]> {
    const rows = toQueryRows(
      await this.dataSource.query(
        `
          WITH auth_sources AS (
            SELECT 'login_email' AS source_kind, email_hash AS source_hash,
              COUNT(*)::int AS event_count, MAX(occurred_at) AS latest_at
            FROM account_monitoring_events
            WHERE user_id IS NULL
              AND occurred_at >= $1
              AND event_type IN ('auth_login_failed', 'oauth_login_failed')
              AND email_hash IS NOT NULL
            GROUP BY email_hash
            HAVING COUNT(*) >= $2
            UNION ALL
            SELECT 'login_ip' AS source_kind, ip_address_hash AS source_hash,
              COUNT(*)::int AS event_count, MAX(occurred_at) AS latest_at
            FROM account_monitoring_events
            WHERE user_id IS NULL
              AND occurred_at >= $1
              AND event_type IN ('auth_login_failed', 'oauth_login_failed')
              AND ip_address_hash IS NOT NULL
            GROUP BY ip_address_hash
            HAVING COUNT(*) >= $2
            UNION ALL
            SELECT 'reset_email' AS source_kind, email_hash AS source_hash,
              COUNT(*)::int AS event_count, MAX(occurred_at) AS latest_at
            FROM account_monitoring_events
            WHERE user_id IS NULL
              AND occurred_at >= $1
              AND event_type = 'password_reset_requested'
              AND email_hash IS NOT NULL
            GROUP BY email_hash
            HAVING COUNT(*) >= $2
          )
          SELECT source_kind, source_hash, event_count, latest_at
          FROM auth_sources
          ORDER BY event_count DESC, latest_at DESC
          LIMIT $3
        `,
        [
          new Date(scannedAt.getTime() - DAY_MS),
          thresholds.unknownAuthFailures24hWarning,
          ADMIN_ACCOUNT_MONITORING_AUTOMATED_SCAN_LIMIT,
        ],
      ),
    );

    return rows
      .filter((row) => typeof row.source_hash === 'string')
      .map((row) => {
        const sourceKind = toStringValue(row.source_kind);
        const sourceHash = toStringValue(row.source_hash);
        const eventCount = toNumber(row.event_count);
        const latestAt = toNullableIso(row.latest_at);
        const severity =
          eventCount >= thresholds.unknownAuthFailures24hCritical
            ? AdminOperationalIncidentSeverity.Critical
            : AdminOperationalIncidentSeverity.Warning;
        const label =
          sourceKind === 'login_ip'
            ? 'same IP'
            : sourceKind === 'reset_email'
              ? 'same password reset email'
              : 'same login email';

        return {
          description: `Unknown-account authentication pressure crossed the 24-hour threshold from the ${label}. ${eventCount} events were recorded. Latest event: ${latestAt ?? toIsoString(scannedAt)}.`,
          eventCount,
          latestAt,
          severity,
          sourceId: this.toUnknownAuthIncidentSourceId(sourceKind, sourceHash),
          sourceType: 'account-monitoring:unknown-auth',
          title: 'Unknown account auth pressure detected',
        };
      });
  }

  private async loadGlobalMediaCleanupIncidentCandidates(
    scannedAt: Date,
    thresholds: AdminAccountMonitoringThresholds,
  ): Promise<AccountMonitoringSecurityIncidentCandidate[]> {
    const rows = toQueryRows(
      await this.dataSource.query(
        `
          SELECT COUNT(*)::int AS event_count,
            COALESCE(SUM(attempt_count), 0)::int AS attempt_count,
            MAX(updated_at) AS latest_at
          FROM skin_journal_media_deletion_jobs
          WHERE updated_at >= $1 AND status = 'failed'
          HAVING COUNT(*) >= $2 OR COALESCE(SUM(attempt_count), 0) >= $3
        `,
        [
          new Date(scannedAt.getTime() - DAY_MS),
          thresholds.mediaCleanupFailures24hWarning,
          thresholds.mediaCleanupAttempts24hWarning,
        ],
      ),
    );
    const row = rows[0];
    if (!row) {
      return [];
    }

    const eventCount = toNumber(row.event_count);
    const attemptCount = toNumber(row.attempt_count);
    if (eventCount <= 0 && attemptCount <= 0) {
      return [];
    }

    const latestAt = toNullableIso(row.latest_at);
    const severity =
      eventCount >= thresholds.mediaCleanupFailures24hWarning * 2 ||
      attemptCount >= thresholds.mediaCleanupAttempts24hWarning * 2
        ? AdminOperationalIncidentSeverity.Critical
        : AdminOperationalIncidentSeverity.Warning;

    return [
      {
        description: `Global media cleanup failures crossed the 24-hour threshold. ${eventCount} failed jobs and ${attemptCount} retry attempts were recorded. Latest event: ${latestAt ?? toIsoString(scannedAt)}.`,
        eventCount,
        latestAt,
        severity,
        sourceId: 'skin-journal-media-cleanup:24h',
        sourceType: 'account-monitoring:media-cleanup',
        title: 'Global media cleanup failures detected',
      },
    ];
  }

  private async upsertAutomatedSecurityIncidents(
    repositories: AdminUserMutationRepositories,
    actor: AdminAuthenticatedUser,
    context: AdminRequestContext,
    candidates: readonly AccountMonitoringSecurityIncidentCandidate[],
  ): Promise<{ created: number; refreshed: number }> {
    if (candidates.length === 0) {
      return { created: 0, refreshed: 0 };
    }

    const existingIncidents = await repositories.incidentsRepository.find({
      where: {
        source_id: In(candidates.map((candidate) => candidate.sourceId)),
        source_type: In([
          ...new Set(candidates.map((item) => item.sourceType)),
        ]),
        status: AdminOperationalIncidentStatus.Open,
      },
    });
    const existingBySourceId = new Map(
      existingIncidents.map((incident) => [
        `${incident.source_type}:${incident.source_id}`,
        incident,
      ]),
    );
    let created = 0;
    let refreshed = 0;

    for (const candidate of candidates) {
      const existing = existingBySourceId.get(
        `${candidate.sourceType}:${candidate.sourceId}`,
      );
      if (existing) {
        existing.description = candidate.description;
        existing.severity = this.maxIncidentSeverity(
          existing.severity,
          candidate.severity,
        );
        existing.title = candidate.title;
        await repositories.incidentsRepository.save(existing);
        refreshed += 1;
        continue;
      }

      const incident = repositories.incidentsRepository.create({
        created_by_admin_id: actor.id,
        description: candidate.description,
        resolution_summary: null,
        resolved_at: null,
        resolved_by_admin_id: null,
        severity: candidate.severity,
        source_id: candidate.sourceId,
        source_type: candidate.sourceType,
        status: AdminOperationalIncidentStatus.Open,
        target_user_id: null,
        title: candidate.title,
      });
      const saved = await repositories.incidentsRepository.save(incident);
      created += 1;
      await this.writeUserAuditLog(repositories.auditLogsRepository, {
        action: AdminAuditAction.OperationalIncidentCreated,
        actor,
        context: {
          ...context,
          reason: 'Automated platform monitoring threshold crossed',
        },
        metadata: {
          automated: true,
          eventCount: candidate.eventCount,
          incidentId: saved.id,
          latestAt: candidate.latestAt,
          severity: candidate.severity,
          sourceId: candidate.sourceId,
          sourceType: candidate.sourceType,
        },
        targetUserId: null,
      });
    }

    return { created, refreshed };
  }

  private toUnknownAuthIncidentSourceId(
    sourceKind: string,
    sourceHash: string,
  ): string {
    return `${sourceKind}:${sourceHash.slice(0, 48)}`;
  }

  private maxIncidentSeverity(
    current: AdminOperationalIncidentSeverity,
    next: AdminOperationalIncidentSeverity,
  ): AdminOperationalIncidentSeverity {
    if (current === AdminOperationalIncidentSeverity.Critical) {
      return current;
    }

    return next;
  }

  private toAutomatedMonitoringDraft(
    candidate: AccountMonitoringAutomatedCandidate,
    scannedAt: Date,
  ): {
    internalNote: string;
    latestSignal: string;
    nextReviewAt: Date;
    summary: string;
  } {
    const latest = candidate.latestAt ?? toIsoString(scannedAt);
    const reviewWindowMs =
      candidate.severity === AdminAccountMonitoringSeverity.Critical
        ? DAY_MS
        : 3 * DAY_MS;
    const metric =
      candidate.costUsd > 0
        ? `${candidate.eventCount} events, $${candidate.costUsd.toFixed(4)} estimated cost`
        : `${candidate.eventCount} events`;
    const templates: Record<string, { signal: string; summary: string }> = {
      account_deletion_loop: {
        signal: `Deletion/cancellation activity crossed the 30-day review threshold: ${metric}. Latest event: ${latest}.`,
        summary: 'Account deletion activity needs review',
      },
      ai_usage_threshold: {
        signal: `AI activity crossed the 24-hour monitoring threshold: ${metric}. Latest event: ${latest}.`,
        summary: 'High AI usage detected',
      },
      auth_failure_pressure: {
        signal: `Authentication or reset activity crossed the 24-hour monitoring threshold: ${metric}. Latest event: ${latest}.`,
        summary: 'Repeated auth activity detected',
      },
      media_cleanup_failures: {
        signal: `Media cleanup failures crossed the 24-hour monitoring threshold: ${metric}. Latest event: ${latest}.`,
        summary: 'Media cleanup failures detected',
      },
      product_extraction_volume: {
        signal: `Photo extraction volume crossed the 24-hour monitoring threshold: ${metric}. Latest event: ${latest}.`,
        summary: 'Product extraction volume spike',
      },
      safety_reaction_signals: {
        signal: `Safety-critical reaction signals crossed the 7-day monitoring threshold: ${metric}. Latest event: ${latest}.`,
        summary: 'Repeated reaction safety signals',
      },
      support_escalation: {
        signal: `Support escalation event was received for this account. Latest event: ${latest}.`,
        summary: 'Support escalation needs review',
      },
      upload_failures: {
        signal: `Upload failures crossed the 24-hour monitoring threshold: ${metric}. Latest event: ${latest}.`,
        summary: 'Repeated upload failures detected',
      },
    };
    const template = templates[candidate.reasonCode] ?? {
      signal: `Automated monitoring threshold crossed: ${metric}. Latest event: ${latest}.`,
      summary: 'Automated monitoring threshold crossed',
    };

    return {
      internalNote:
        'Automated monitoring candidate. Review account activity, avoid exposing sensitive event details, and resolve only after the pattern is explained.',
      latestSignal: template.signal,
      nextReviewAt: new Date(scannedAt.getTime() + reviewWindowMs),
      summary: template.summary,
    };
  }

  private accountMonitoringCandidateKey(
    userId: string,
    signalType: AdminAccountMonitoringSignalType,
  ): string {
    return `${userId}:${signalType}`;
  }

  private maxMonitoringSeverity(
    current: AdminAccountMonitoringSeverity,
    next: AdminAccountMonitoringSeverity,
  ): AdminAccountMonitoringSeverity {
    const rank: Record<AdminAccountMonitoringSeverity, number> = {
      [AdminAccountMonitoringSeverity.Info]: 0,
      [AdminAccountMonitoringSeverity.Warning]: 1,
      [AdminAccountMonitoringSeverity.Critical]: 2,
    };
    return rank[next] > rank[current] ? next : current;
  }

  private async writeAutomatedMonitoringAuditLog(
    auditLogsRepository: Repository<AdminAuditLog>,
    actor: AdminAuthenticatedUser,
    context: AdminRequestContext,
    flag: AdminAccountMonitoringFlag,
    action:
      | AdminAuditAction.AccountMonitoringFlagCreated
      | AdminAuditAction.AccountMonitoringFlagUpdated,
    candidate: AccountMonitoringAutomatedCandidate,
  ): Promise<void> {
    await this.writeUserAuditLog(auditLogsRepository, {
      action,
      actor,
      context: {
        ...context,
        reason: 'Automated account monitoring threshold crossed',
      },
      metadata: {
        automated: true,
        eventCount: candidate.eventCount,
        monitoringFlagId: flag.id,
        reasonCode: candidate.reasonCode,
        signalType: flag.signal_type,
        status: flag.status,
      },
      targetUserId: flag.user_id,
    });
  }

  private toAccountMonitoringFlagResponse(
    row: QueryRow,
  ): AdminAccountMonitoringFlagResponse {
    const assignedAdminId = toNullableString(row.assigned_admin_id);
    const resolvedByAdminId = toNullableString(row.resolved_by_admin_id);
    const userId = toStringValue(row.user_id);

    return {
      assignedAdmin: assignedAdminId
        ? {
            email: toStringValue(row.assigned_admin_email),
            id: assignedAdminId,
            name: toStringValue(row.assigned_admin_name),
          }
        : null,
      assignedAdminId,
      auditLogCount: toNumber(row.audit_log_count),
      createdAt: toNullableIso(row.created_at) ?? toIsoString(new Date(0)),
      createdBy: {
        email: toStringValue(row.created_by_admin_email),
        id: toStringValue(row.created_by_admin_id),
        name: toStringValue(row.created_by_admin_name),
      },
      createdByAdminId: toStringValue(row.created_by_admin_id),
      id: toStringValue(row.id),
      internalNote: toNullableEncryptedString(
        row.internal_note,
        encryptedAccountMonitoringInternalNoteTransformer,
      ),
      latestSignal: toNullableEncryptedString(
        row.latest_signal,
        encryptedAccountMonitoringLatestSignalTransformer,
      ),
      nextReviewAt: toNullableIso(row.next_review_at),
      resolutionNote: toNullableEncryptedString(
        row.resolution_note,
        encryptedAccountMonitoringResolutionNoteTransformer,
      ),
      resolvedAt: toNullableIso(row.resolved_at),
      resolvedBy: resolvedByAdminId
        ? {
            email: toStringValue(row.resolved_by_admin_email),
            id: resolvedByAdminId,
            name: toStringValue(row.resolved_by_admin_name),
          }
        : null,
      resolvedByAdminId,
      severity: this.normalizeMonitoringSeverity(
        toStringValue(row.severity) as AdminAccountMonitoringSeverity,
      ),
      signalType: this.normalizeMonitoringSignalType(
        toStringValue(row.signal_type) as AdminAccountMonitoringSignalType,
      ),
      status: this.normalizeMonitoringStatus(
        toStringValue(row.status) as AdminAccountMonitoringStatus,
      ),
      summary: toStringValue(row.summary),
      updatedAt: toNullableIso(row.updated_at) ?? toIsoString(new Date(0)),
      user: {
        email: toStringValue(row.user_email),
        id: userId,
        name: toStringValue(row.user_name) || toStringValue(row.user_email),
      },
      userId,
    };
  }

  private toAccountMonitoringFlagResponseFromEntity(
    flag: AdminAccountMonitoringFlag,
    user: User,
    actors: Readonly<
      Record<string, { email: string; id: string; name: string }>
    >,
  ): AdminAccountMonitoringFlagResponse {
    const assignedAdminId = toNullableString(flag.assigned_admin_id);
    const resolvedByAdminId = toNullableString(flag.resolved_by_admin_id);
    const userName = [user.first_name, user.last_name]
      .filter(Boolean)
      .join(' ');

    return {
      assignedAdmin: assignedAdminId ? (actors[assignedAdminId] ?? null) : null,
      assignedAdminId,
      auditLogCount: 1,
      createdAt: toNullableIso(flag.created_at) ?? toIsoString(new Date()),
      createdBy: actors[flag.created_by_admin_id] ?? {
        email: '',
        id: flag.created_by_admin_id,
        name: '',
      },
      createdByAdminId: flag.created_by_admin_id,
      id: flag.id,
      internalNote: toNullableEncryptedString(
        flag.internal_note,
        encryptedAccountMonitoringInternalNoteTransformer,
      ),
      latestSignal: toNullableEncryptedString(
        flag.latest_signal,
        encryptedAccountMonitoringLatestSignalTransformer,
      ),
      nextReviewAt: toNullableIso(flag.next_review_at),
      resolutionNote: toNullableEncryptedString(
        flag.resolution_note,
        encryptedAccountMonitoringResolutionNoteTransformer,
      ),
      resolvedAt: toNullableIso(flag.resolved_at),
      resolvedBy: resolvedByAdminId
        ? (actors[resolvedByAdminId] ?? null)
        : null,
      resolvedByAdminId,
      severity: flag.severity,
      signalType: flag.signal_type,
      status: flag.status,
      summary: flag.summary,
      updatedAt: toNullableIso(flag.updated_at) ?? toIsoString(new Date()),
      user: {
        email: user.email,
        id: user.id,
        name: userName || user.email,
      },
      userId: user.id,
    };
  }

  private toAccountMonitoringFlagResponseFromCandidate(
    flag: AdminAccountMonitoringFlag,
    candidate: AccountMonitoringAutomatedCandidate | undefined,
    actors: Readonly<
      Record<string, { email: string; id: string; name: string }>
    >,
  ): AdminAccountMonitoringFlagResponse {
    const assignedAdminId = toNullableString(flag.assigned_admin_id);
    const resolvedByAdminId = toNullableString(flag.resolved_by_admin_id);
    const userEmail = candidate?.userEmail ?? '';

    return {
      assignedAdmin: assignedAdminId ? (actors[assignedAdminId] ?? null) : null,
      assignedAdminId,
      auditLogCount: 1,
      createdAt: toNullableIso(flag.created_at) ?? toIsoString(new Date()),
      createdBy: actors[flag.created_by_admin_id] ?? {
        email: '',
        id: flag.created_by_admin_id,
        name: '',
      },
      createdByAdminId: flag.created_by_admin_id,
      id: flag.id,
      internalNote: toNullableEncryptedString(
        flag.internal_note,
        encryptedAccountMonitoringInternalNoteTransformer,
      ),
      latestSignal: toNullableEncryptedString(
        flag.latest_signal,
        encryptedAccountMonitoringLatestSignalTransformer,
      ),
      nextReviewAt: toNullableIso(flag.next_review_at),
      resolutionNote: toNullableEncryptedString(
        flag.resolution_note,
        encryptedAccountMonitoringResolutionNoteTransformer,
      ),
      resolvedAt: toNullableIso(flag.resolved_at),
      resolvedBy: resolvedByAdminId
        ? (actors[resolvedByAdminId] ?? null)
        : null,
      resolvedByAdminId,
      severity: flag.severity,
      signalType: flag.signal_type,
      status: flag.status,
      summary: flag.summary,
      updatedAt: toNullableIso(flag.updated_at) ?? toIsoString(new Date()),
      user: {
        email: userEmail,
        id: flag.user_id,
        name: candidate?.userName || userEmail,
      },
      userId: flag.user_id,
    };
  }

  private async getMonitoringActorsForFlags(
    flags: readonly AdminAccountMonitoringFlag[],
  ): Promise<Map<string, AdminOperationalIncidentActor>> {
    const adminIds = [
      ...new Set(
        flags.flatMap((flag) => [
          flag.assigned_admin_id,
          flag.created_by_admin_id,
          flag.resolved_by_admin_id,
        ]),
      ),
    ].filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (adminIds.length === 0) {
      return new Map();
    }

    const rows = toQueryRows(
      await this.dataSource.query(
        `
          SELECT id, email, name
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
          id: 'ingredient_analysis',
          label: 'Ingredient analysis',
          monthToDateCostUsd: toNumber(row.ingredient_analysis_cost_mtd),
          todayCostUsd: toNumber(row.ingredient_analysis_cost_today),
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
    const restrictionUser = {
      account_restricted_at: toDateLike(
        'account_restricted_at' in user ? user.account_restricted_at : null,
      ),
      account_restriction_capabilities: toStringArray(
        'account_restriction_capabilities' in user
          ? user.account_restriction_capabilities
          : null,
      ),
      account_restriction_expires_at: toDateLike(
        'account_restriction_expires_at' in user
          ? user.account_restriction_expires_at
          : null,
      ),
    };
    const hasActiveRestriction = isUserRestrictionActive(restrictionUser);
    const restrictionCapabilities = hasActiveRestriction
      ? getEffectiveUserRestrictionCapabilities(restrictionUser)
      : [];

    return {
      accountStatus: this.toAdminUserAccountStatus(user, restrictionUser),
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
      restrictedAt: hasActiveRestriction
        ? toNullableIso(
            'account_restricted_at' in user ? user.account_restricted_at : null,
          )
        : null,
      restrictedByAdminId: hasActiveRestriction
        ? toNullableString(
            'account_restricted_by_admin_id' in user
              ? user.account_restricted_by_admin_id
              : null,
          )
        : null,
      restrictionCapabilities,
      restrictionExpiresAt: hasActiveRestriction
        ? toNullableIso(
            'account_restriction_expires_at' in user
              ? user.account_restriction_expires_at
              : null,
          )
        : null,
      restrictionInternalNote: hasActiveRestriction
        ? toNullableRestrictionText(
            'account_restriction_internal_note' in user
              ? user.account_restriction_internal_note
              : null,
            userRestrictionInternalNoteTransformer,
          )
        : null,
      restrictionReason: hasActiveRestriction
        ? toNullableString(
            'account_restriction_reason' in user
              ? user.account_restriction_reason
              : null,
          )
        : null,
      restrictionUserMessage: hasActiveRestriction
        ? toNullableRestrictionText(
            'account_restriction_user_message' in user
              ? user.account_restriction_user_message
              : null,
            userRestrictionMessageTransformer,
          )
        : null,
      timeZone: toNullableString('time_zone' in user ? user.time_zone : null),
      updatedAt:
        toNullableIso('updated_at' in user ? user.updated_at : null) ??
        toIsoString(new Date()),
    };
  }

  private toAdminUserAccountStatus(
    user: User | QueryRow,
    restrictionUser: {
      account_restricted_at: Date | string | null;
      account_restriction_capabilities: string[];
      account_restriction_expires_at: Date | string | null;
    },
  ): AdminUserAccountStatus {
    const deletionScheduledFor = toNullableIso(
      'account_deletion_scheduled_for' in user
        ? user.account_deletion_scheduled_for
        : null,
    );
    if (deletionScheduledFor) {
      return AdminUserAccountStatus.PendingDeletion;
    }

    if (!isUserRestrictionActive(restrictionUser)) {
      return AdminUserAccountStatus.Active;
    }

    if (
      hasActiveUserRestrictionCapability(
        restrictionUser,
        UserRestrictionCapability.DisableLogin,
      )
    ) {
      return AdminUserAccountStatus.Suspended;
    }

    return AdminUserAccountStatus.Restricted;
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

  private async findUserByAdminIdentifierForMutation(
    usersRepository: Repository<User>,
    identifier: string,
  ): Promise<User> {
    const trimmed = identifier.trim();
    const user = trimmed.includes('@')
      ? await usersRepository.findOne({
          where: { canonical_email: canonicalizeEmailForIdentity(trimmed) },
        })
      : await usersRepository.findOne({ where: { id: trimmed } });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  private async findAdminAccountForMonitoringAssignment(
    accountsRepository: Repository<AdminAccount>,
    adminId: string,
  ): Promise<AdminAccount> {
    const account = await accountsRepository.findOne({
      where: {
        id: adminId,
        status: AdminAccountStatus.Active,
      },
    });
    if (!account) {
      throw new NotFoundException('Assigned admin not found');
    }

    return account;
  }

  private normalizeAuditReason(reason: string): string {
    const trimmed = reason.trim();
    if (!trimmed) {
      throw new BadRequestException('Admin audit reason is required');
    }

    return trimmed;
  }

  private normalizeRestrictionCapabilities(
    capabilities: readonly UserRestrictionCapability[] | null | undefined,
  ): UserRestrictionCapability[] {
    const normalized = normalizeUserRestrictionCapabilities(capabilities);
    if (normalized.length === 0) {
      throw new BadRequestException(
        'At least one account restriction control is required',
      );
    }

    return normalized;
  }

  private normalizeRestrictionExpiry(
    expiresAt: string | null | undefined,
  ): Date | null {
    if (!expiresAt) {
      return null;
    }

    const date = new Date(expiresAt);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Restriction expiry is invalid');
    }

    if (date.getTime() <= Date.now()) {
      throw new BadRequestException('Restriction expiry must be in the future');
    }

    return date;
  }

  private assertPlatformGlobalRestrictionCapability(
    capability: PlatformGlobalRestrictionCapability,
  ): void {
    if (!isPlatformGlobalRestrictionCapability(capability)) {
      throw new BadRequestException('Global restriction capability is invalid');
    }
  }

  private async lockPlatformGlobalRestrictionCapability(
    manager: EntityManager,
    capability: PlatformGlobalRestrictionCapability,
  ): Promise<void> {
    await manager.query(
      `
        SELECT pg_advisory_xact_lock(
          hashtext('ritora_platform_global_restriction'),
          hashtext($1)
        )
      `,
      [capability],
    );
  }

  private toPlatformGlobalRestrictionResponse(
    capability: PlatformGlobalRestrictionCapability,
    row: QueryRow | null,
  ): AdminPlatformGlobalRestrictionResponse {
    if (!row) {
      return {
        active: false,
        capability,
        enabledAt: null,
        enabledByAdmin: null,
        expiresAt: null,
        id: null,
        reason: null,
      };
    }

    const adminId = toNullableString(row.enabled_by_admin_id);
    return {
      active: true,
      capability,
      enabledAt: toNullableIso(row.enabled_at),
      enabledByAdmin: adminId
        ? {
            email: toStringValue(row.enabled_by_admin_email),
            id: adminId,
            name: toStringValue(row.enabled_by_admin_name),
          }
        : null,
      expiresAt: toNullableIso(row.expires_at),
      id: toNullableString(row.id),
      reason: toNullableString(row.reason),
    };
  }

  private normalizeRestrictionText(
    value: string | null | undefined,
    requiredMessage: string,
    maxLength: number,
    minLength: number,
  ): string {
    const trimmed = value?.trim().replace(/\s+/g, ' ') ?? '';
    if (trimmed.length < minLength) {
      throw new BadRequestException(requiredMessage);
    }

    if (trimmed.length > maxLength) {
      throw new BadRequestException('Admin restriction text is too long');
    }

    return trimmed;
  }

  private normalizeOptionalRestrictionText(
    value: string | null | undefined,
    maxLengthMessage: string,
    maxLength: number,
  ): string | null {
    const trimmed = value?.trim().replace(/\s+/g, ' ') ?? '';
    if (!trimmed) {
      return null;
    }

    if (trimmed.length > maxLength) {
      throw new BadRequestException(maxLengthMessage);
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

  private normalizeMonitoringText(
    value: string,
    requiredMessage: string,
    maxLength: number,
    minLength: number,
  ): string {
    const trimmed = value.trim().replace(/\s+/g, ' ');
    if (trimmed.length < minLength) {
      throw new BadRequestException(requiredMessage);
    }

    if (trimmed.length > maxLength) {
      throw new BadRequestException('Account monitoring text is too long');
    }

    return trimmed;
  }

  private normalizeFutureReviewDate(
    value: string | null | undefined,
  ): Date | null {
    if (!value) {
      return null;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(
        'Account monitoring review date is invalid',
      );
    }

    if (date.getTime() <= Date.now()) {
      throw new BadRequestException(
        'Account monitoring review date must be in the future',
      );
    }

    return date;
  }

  private normalizeMonitoringSignalType(
    signalType: AdminAccountMonitoringSignalType,
  ): AdminAccountMonitoringSignalType {
    if (Object.values(AdminAccountMonitoringSignalType).includes(signalType)) {
      return signalType;
    }

    throw new BadRequestException('Account monitoring signal type is invalid');
  }

  private normalizeMonitoringSeverity(
    severity: AdminAccountMonitoringSeverity,
  ): AdminAccountMonitoringSeverity {
    if (Object.values(AdminAccountMonitoringSeverity).includes(severity)) {
      return severity;
    }

    throw new BadRequestException('Account monitoring severity is invalid');
  }

  private normalizeMonitoringStatus(
    status: AdminAccountMonitoringStatus,
  ): AdminAccountMonitoringStatus {
    if (Object.values(AdminAccountMonitoringStatus).includes(status)) {
      return status;
    }

    throw new BadRequestException('Account monitoring status is invalid');
  }

  private normalizeMonitoringOpenStatus(
    status:
      | AdminAccountMonitoringStatus.Open
      | AdminAccountMonitoringStatus.Watching,
  ): AdminAccountMonitoringStatus.Open | AdminAccountMonitoringStatus.Watching {
    if (
      status === AdminAccountMonitoringStatus.Open ||
      status === AdminAccountMonitoringStatus.Watching
    ) {
      return status;
    }

    throw new BadRequestException(
      'Resolved monitoring flags must use the resolve endpoint',
    );
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
      accountsRepository: manager.getRepository(AdminAccount),
      auditLogsRepository: manager.getRepository(AdminAuditLog),
      incidentsRepository: manager.getRepository(AdminOperationalIncident),
      notificationsRepository: manager.getRepository(AdminNotification),
      monitoringEventsRepository: manager.getRepository(AccountMonitoringEvent),
      monitoringRepository: manager.getRepository(AdminAccountMonitoringFlag),
      monitoringSettingsRepository: manager.getRepository(
        AdminAccountMonitoringSettings,
      ),
      notesRepository: manager.getRepository(AdminUserNote),
      sessionsRepository: manager.getRepository(AuthSession),
      usersRepository: manager.getRepository(User),
    };
  }
}

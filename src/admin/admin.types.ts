import {
  AdminAccountRole,
  AdminAccountStatus,
} from './entities/admin-account.entity';
import {
  AdminOperationalIncidentSeverity,
  AdminOperationalIncidentStatus,
} from './entities/admin-operational-incident.entity';
import {
  AdminNotificationSeverity,
  AdminNotificationType,
} from './entities/admin-notification.entity';
import {
  AdminAccountMonitoringSeverity,
  AdminAccountMonitoringSignalType,
  AdminAccountMonitoringStatus,
} from './entities/admin-account-monitoring-flag.entity';
import { AdminAccountMonitoringStatusFilter } from './dto/admin-account-monitoring.dto';
import { AdminOperationalIncidentStatusFilter } from './dto/admin-operational-incident.dto';
import {
  type AdminAiCostFeatureFilter,
  type AdminAiCostPeriod,
} from './admin-ai-cost.types';
import { UserRestrictionCapability } from '../users/user-restrictions';
import { PlatformGlobalRestrictionCapability } from '../platform-controls/platform-global-restrictions';
import type {
  AnalysisFeedbackReason,
  AnalysisFeedbackVote,
} from '../skin-journal/skin-journal.constants';

export {
  AdminAiCostFeatureFilter,
  AdminAiCostPeriod,
} from './admin-ai-cost.types';

export const AdminRole = {
  Root: AdminAccountRole.Root,
  Admin: AdminAccountRole.Admin,
} as const;

export type AdminRole = (typeof AdminRole)[keyof typeof AdminRole];

export const AdminPermission = {
  MetricsRead: 'metrics:read',
  UsersRead: 'users:read',
  UsersRestrict: 'users:restrict',
  JobsWrite: 'jobs:write',
  AuditRead: 'audit:read',
} as const;

export type AdminPermission =
  (typeof AdminPermission)[keyof typeof AdminPermission];

export const AdminAlertSeverity = {
  Info: 'info',
  Warning: 'warning',
  Critical: 'critical',
} as const;

export type AdminAlertSeverity =
  (typeof AdminAlertSeverity)[keyof typeof AdminAlertSeverity];

export const AdminJobStatus = {
  Healthy: 'healthy',
  Warning: 'warning',
  Critical: 'critical',
} as const;

export type AdminJobStatus =
  (typeof AdminJobStatus)[keyof typeof AdminJobStatus];

export const AdminMetricSource = {
  Event: 'event',
  Proxy: 'proxy',
  Table: 'table',
  Unavailable: 'unavailable',
} as const;

export type AdminMetricSource =
  (typeof AdminMetricSource)[keyof typeof AdminMetricSource];

export type AdminAuthenticatedUser = {
  email: string;
  id: string;
  name: string;
  role: AdminAccountRole;
  sessionId: string;
  status: AdminAccountStatus;
};

export type AdminMemberResponse = {
  id: string;
  email: string;
  name: string;
  role: AdminAccountRole;
  status: AdminAccountStatus;
  roles: AdminRole[];
  permissions: AdminPermission[];
  createdAt: string;
  invitedAt: string | null;
  acceptedAt: string | null;
  lastLoginAt: string | null;
  mfaEnabled: boolean;
  mfaEnabledAt: string | null;
  createdByAdminId: string | null;
};

export type AdminAuthResponse = {
  accessToken: string;
  member: AdminMemberResponse;
};

export type AdminMfaRequiredResponse = {
  mfaRequired: true;
};

export type AdminLoginResponse = AdminAuthResponse | AdminMfaRequiredResponse;

export type AdminSessionResponse = {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
};

export type AdminPlatformGlobalRestrictionResponse = {
  active: boolean;
  capability: PlatformGlobalRestrictionCapability;
  enabledAt: string | null;
  enabledByAdmin: {
    email: string;
    id: string;
    name: string;
  } | null;
  expiresAt: string | null;
  id: string | null;
  reason: string | null;
};

export type AdminPlatformGlobalRestrictionListResponse = {
  generatedAt: string;
  restrictions: AdminPlatformGlobalRestrictionResponse[];
};

export type AdminMfaStatusResponse = {
  enabled: boolean;
  enabledAt: string | null;
  pendingSetupExpiresAt: string | null;
  recoveryCodesRemaining: number;
};

export type AdminMfaSetupResponse = {
  expiresAt: string;
  manualEntryKey: string;
  otpauthUri: string;
  secret: string;
};

export type AdminMfaEnableResponse = AdminMfaStatusResponse & {
  recoveryCodes: string[];
};

export type AdminPaginationMeta = {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  limit: number;
  page: number;
  total: number;
  totalPages: number;
};

export type AdminListQuery = {
  limit?: number;
  page?: number;
  query?: string;
};

export type AdminMemberListResponse = AdminPaginationMeta & {
  admins: AdminMemberResponse[];
};

export type AdminAuditLogQuery = {
  action?: string;
  limit?: number;
  monitoringFlagId?: string;
  page?: number;
  query?: string;
  targetAdminId?: string;
  targetUserId?: string;
};

export type AdminNotificationResponse = {
  actionUrl: string | null;
  body: string;
  createdAt: string;
  id: string;
  metadata: Record<string, string | number | boolean | null>;
  readAt: string | null;
  severity: AdminNotificationSeverity;
  title: string;
  type: AdminNotificationType;
};

export type AdminNotificationListResponse = {
  generatedAt: string;
  notifications: AdminNotificationResponse[];
  unreadCount: number;
};

export type AdminOverviewResponse = {
  generatedAt: string;
  metrics: {
    registeredUsers: number;
    verifiedUsers: number;
    newSignupsToday: number;
    newSignups7d: number;
    newSignups30d: number;
    dailyActiveUsers: number;
    weeklyActiveUsers: number;
    monthlyActiveUsers: number;
    activationRate: number;
    routineAcceptanceRate: number;
    dailyCheckInRate: number;
    productAddSuccessRate: number;
    aiSuccessRate: number;
    todayAiCostUsd: number;
    monthToDateAiCostUsd: number;
    criticalAlerts: number;
    activeRestrictions: number;
  };
  activationFunnel: Array<{
    stage: string;
    label: string;
    count: number;
  }>;
  signupTrend: Array<{
    date: string;
    count: number;
  }>;
  activeUserTrend: Array<{
    date: string;
    dailyActiveUsers: number;
    weeklyActiveUsers: number;
    monthlyActiveUsers: number;
  }>;
  retentionCohorts: Array<{
    id: string;
    label: string;
    eligibleUsers: number;
    retainedUsers: number;
    rate: number;
  }>;
  featureAdoption: Array<{
    id: string;
    label: string;
    users: number;
    rate: number;
  }>;
  aiCostByFeature: Array<{
    id: string;
    label: string;
    todayCostUsd: number;
    monthToDateCostUsd: number;
    successRate: number;
  }>;
  endpointHealth: Array<{
    id: string;
    method: string;
    route: string;
    requestCount: number;
    errorRate: number;
    p95LatencyMs: number;
    status: AdminJobStatus;
  }>;
  metricSources: Array<{
    id: string;
    source: AdminMetricSource;
  }>;
  alerts: Array<{
    id: string;
    severity: AdminAlertSeverity;
    title: string;
    description: string;
  }>;
  jobHealth: Array<{
    id: string;
    label: string;
    status: AdminJobStatus;
    queued: number;
    failed: number;
    oldestQueuedAgeSeconds: number | null;
  }>;
  compliance: {
    pendingDeletionCount: number;
    sensitiveAccessEvents24h: number;
  };
};

export enum AdminUserRestrictionFilter {
  All = 'all',
  Restricted = 'restricted',
  Unrestricted = 'unrestricted',
}

export enum AdminUserAccountStatus {
  Active = 'active',
  Monitored = 'monitored',
  Restricted = 'restricted',
  Suspended = 'suspended',
  PendingDeletion = 'pending_deletion',
  Deleted = 'deleted',
}

export type AdminUserListQuery = {
  limit?: number;
  page?: number;
  query?: string;
  restriction?: AdminUserRestrictionFilter;
};

export type AdminAiCostUserListQuery = {
  feature?: AdminAiCostFeatureFilter;
  limit?: number;
  page?: number;
  period?: AdminAiCostPeriod;
  query?: string;
};

export type AdminAiCostByUserFeatureResponse = {
  id: string;
  label: string;
  todayCostUsd: number;
  monthToDateCostUsd: number;
};

export type AdminAiCostByUserResponse = {
  userId: string;
  email: string;
  name: string;
  todayCostUsd: number;
  monthToDateCostUsd: number;
  featureCosts: AdminAiCostByUserFeatureResponse[];
};

export type AdminAiCostByUserListResponse = AdminPaginationMeta & {
  users: AdminAiCostByUserResponse[];
};

export type AdminUserResponse = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  emailVerified: boolean;
  preferredLanguage: string;
  timeZone: string | null;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string | null;
  accountStatus: AdminUserAccountStatus;
  accountDeletionScheduledFor: string | null;
  restrictedAt: string | null;
  restrictedByAdminId: string | null;
  restrictionCapabilities: UserRestrictionCapability[];
  restrictionExpiresAt: string | null;
  restrictionInternalNote: string | null;
  restrictionReason: string | null;
  restrictionUserMessage: string | null;
};

export type AdminUserListResponse = AdminPaginationMeta & {
  users: AdminUserResponse[];
};

export type AdminUserNoteAuthorResponse = {
  id: string;
  email: string;
  name: string;
};

export type AdminUserNoteResponse = {
  id: string;
  userId: string;
  authorAdminId: string;
  author: AdminUserNoteAuthorResponse | null;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type AdminUserNoteListQuery = {
  limit?: number;
  page?: number;
};

export type AdminUserNoteListResponse = AdminPaginationMeta & {
  notes: AdminUserNoteResponse[];
};

export type AdminAuditLogActorResponse = {
  id: string;
  email: string;
  name: string;
};

export type AdminAuditLogTargetResponse =
  | {
      type: 'admin';
      id: string;
      email: string;
      name: string;
    }
  | {
      type: 'user';
      id: string;
      email: string;
      name: string;
    }
  | {
      type: 'system';
      id: null;
      email: null;
      name: null;
    };

export type AdminAuditLogResponse = {
  id: string;
  action: string;
  actor: AdminAuditLogActorResponse;
  actorAdminId: string;
  actorSessionId: string;
  target: AdminAuditLogTargetResponse;
  targetAdminId: string | null;
  targetUserId: string | null;
  reason: string;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type AdminAuditLogListResponse = AdminPaginationMeta & {
  logs: AdminAuditLogResponse[];
};

export type AdminUserDetailResponse = AdminUserResponse & {
  activity: {
    activeSessionCount: number;
    analysisCompletedCount: number;
    analysisFailedCount: number;
    hasSkinProfile: boolean;
    journalEntryCount: number;
    latestJournalEntryAt: string | null;
    latestSuggestionAt: string | null;
    suggestionCount: number;
    totalSessionCount: number;
  };
  safety: {
    sensitiveAccessEvents24h: number;
  };
  recentAuditLogs: AdminAuditLogResponse[];
};

export type AdminOperationalWorkItemResponse = {
  id: string;
  type: string;
  label: string;
  status: string;
  severity: AdminJobStatus;
  userId: string | null;
  userEmail: string | null;
  attemptCount: number | null;
  runAfter: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export type AdminBackendHealthComponentResponse = {
  checkedAt: string;
  errorRate: number | null;
  id: string;
  label: string;
  latencyMs: number | null;
  message: string;
  p95LatencyMs: number | null;
  requestCount: number | null;
  status: AdminJobStatus;
  windowMinutes: number | null;
};

export type AdminBackendHealthResponse = {
  checkedAt: string;
  components: AdminBackendHealthComponentResponse[];
  status: AdminJobStatus;
};

export type AdminOperationsMonitoringResponse = {
  backendHealth: AdminBackendHealthResponse;
  generatedAt: string;
  jobHealth: AdminOverviewResponse['jobHealth'];
  compliance: AdminOverviewResponse['compliance'];
  workItems: AdminOperationalWorkItemResponse[];
};

export type AdminSkinJournalAnalysisFeedbackSummaryResponse = {
  total: number;
  helpful: number;
  notHelpful: number;
  helpfulRate: number;
  notHelpfulRate: number;
  needsReview: boolean;
};

export type AdminSkinJournalAnalysisFeedbackCoverageResponse = {
  analysesWithFeedback: number;
  analysesWithoutFeedback: number;
  feedbackRate: number;
};

export type AdminSkinJournalAnalysisFeedbackCountResponse = {
  id: string | null;
  label: string;
  count: number;
  rate: number;
};

export type AdminSkinJournalAnalysisFeedbackItemResponse = {
  vote: AnalysisFeedbackVote;
  reason: AnalysisFeedbackReason | null;
  note: string | null;
  interpretationVersion: string | null;
  readingLabel: string | null;
  concernKeys: string[];
  createdAt: string;
  updatedAt: string;
};

export type AdminSkinJournalAnalysisFeedbackReportResponse = {
  generatedAt: string;
  windowDays: number;
  reviewThreshold: {
    minResponses: number;
    helpfulRate: number;
  };
  window: AdminSkinJournalAnalysisFeedbackSummaryResponse;
  allTime: AdminSkinJournalAnalysisFeedbackSummaryResponse;
  coverage: AdminSkinJournalAnalysisFeedbackCoverageResponse;
  reasons: AdminSkinJournalAnalysisFeedbackCountResponse[];
  readingLabels: AdminSkinJournalAnalysisFeedbackCountResponse[];
  interpretationVersions: AdminSkinJournalAnalysisFeedbackCountResponse[];
  recentFeedback: AdminSkinJournalAnalysisFeedbackItemResponse[];
};

export type AdminOperationalIncidentActorResponse = {
  id: string;
  email: string;
  name: string;
};

export type AdminOperationalIncidentResponse = {
  id: string;
  title: string;
  description: string;
  status: AdminOperationalIncidentStatus;
  severity: AdminOperationalIncidentSeverity;
  sourceType: string;
  sourceId: string;
  targetUserId: string | null;
  targetUserEmail: string | null;
  createdByAdminId: string;
  createdBy: AdminOperationalIncidentActorResponse;
  resolvedByAdminId: string | null;
  resolvedBy: AdminOperationalIncidentActorResponse | null;
  resolutionSummary: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminOperationalIncidentListQuery = {
  limit?: number;
  page?: number;
  status?: AdminOperationalIncidentStatusFilter;
};

export type AdminOperationalIncidentListResponse = AdminPaginationMeta & {
  incidents: AdminOperationalIncidentResponse[];
};

export type AdminAccountMonitoringActorResponse = {
  id: string;
  email: string;
  name: string;
};

export type AdminAccountMonitoringUserResponse = {
  id: string;
  email: string;
  name: string;
};

export type AdminAccountMonitoringFlagResponse = {
  id: string;
  user: AdminAccountMonitoringUserResponse;
  userId: string;
  signalType: AdminAccountMonitoringSignalType;
  status: AdminAccountMonitoringStatus;
  severity: AdminAccountMonitoringSeverity;
  summary: string;
  latestSignal: string | null;
  internalNote: string | null;
  assignedAdmin: AdminAccountMonitoringActorResponse | null;
  assignedAdminId: string | null;
  createdBy: AdminAccountMonitoringActorResponse;
  createdByAdminId: string;
  resolvedBy: AdminAccountMonitoringActorResponse | null;
  resolvedByAdminId: string | null;
  nextReviewAt: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  auditLogCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminAccountMonitoringListQuery = {
  assignedAdminId?: string;
  limit?: number;
  page?: number;
  query?: string;
  signalType?: AdminAccountMonitoringSignalType;
  status?: AdminAccountMonitoringStatusFilter;
};

export type AdminAccountMonitoringFlagListResponse = AdminPaginationMeta & {
  flags: AdminAccountMonitoringFlagResponse[];
};

export type AdminAccountMonitoringEventTimelineItemResponse = {
  id: string;
  eventType: string;
  occurredAt: string;
  sourceType: string;
  summary: string;
  metadata: Record<string, string | number | boolean | null>;
};

export type AdminAccountMonitoringEventTimelineResponse = {
  flagId: string;
  generatedAt: string;
  events: AdminAccountMonitoringEventTimelineItemResponse[];
};

export type AdminAccountMonitoringAutomatedScanResponse = {
  scannedAt: string;
  created: number;
  refreshed: number;
  skipped: number;
  candidates: number;
  platformCandidates: number;
  platformIncidentsCreated: number;
  platformIncidentsRefreshed: number;
  flags: AdminAccountMonitoringFlagResponse[];
};

export type AdminAccountMonitoringThresholdsResponse = {
  aiCost24hCriticalUsd: number;
  aiCost24hWarningUsd: number;
  aiGenerations24hCritical: number;
  aiGenerations24hWarning: number;
  authFailures24hWarning: number;
  deletionEvents30dWarning: number;
  mediaCleanupAttempts24hWarning: number;
  mediaCleanupFailures24hWarning: number;
  passwordResets24hWarning: number;
  productExtractions24hWarning: number;
  safetyReactionSignals7dWarning: number;
  unknownAuthFailures24hCritical: number;
  unknownAuthFailures24hWarning: number;
  uploadFailures24hWarning: number;
};

export type AdminAccountMonitoringSettingsResponse = {
  thresholds: AdminAccountMonitoringThresholdsResponse;
  updatedAt: string;
  updatedByAdminId: string | null;
};

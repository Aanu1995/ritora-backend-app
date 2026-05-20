import {
  AdminAccountRole,
  AdminAccountStatus,
} from './entities/admin-account.entity';

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
  createdByAdminId: string | null;
};

export type AdminAuthResponse = {
  accessToken: string;
  member: AdminMemberResponse;
};

export type AdminSessionResponse = {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
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
  page?: number;
  query?: string;
  targetAdminId?: string;
  targetUserId?: string;
};

export type AdminOverviewResponse = {
  generatedAt: string;
  metrics: {
    registeredUsers: number;
    verifiedUsers: number;
    weeklyActiveUsers: number;
    activationRate: number;
    routineAcceptanceRate: number;
    dailyCheckInRate: number;
    aiSuccessRate: number;
    monthToDateAiCostUsd: number;
    activeRestrictions: number;
  };
  activationFunnel: Array<{
    stage: string;
    label: string;
    count: number;
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
    failedExportCount: number;
    sensitiveAccessEvents24h: number;
  };
};

export enum AdminUserRestrictionFilter {
  All = 'all',
  Restricted = 'restricted',
  Unrestricted = 'unrestricted',
}

export type AdminUserListQuery = {
  limit?: number;
  page?: number;
  query?: string;
  restriction?: AdminUserRestrictionFilter;
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
  accountDeletionScheduledFor: string | null;
  restrictedAt: string | null;
  restrictedByAdminId: string | null;
  restrictionReason: string | null;
};

export type AdminUserListResponse = AdminPaginationMeta & {
  users: AdminUserResponse[];
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
    failedExportCount: number;
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

export type AdminOperationsMonitoringResponse = {
  generatedAt: string;
  jobHealth: AdminOverviewResponse['jobHealth'];
  compliance: AdminOverviewResponse['compliance'];
  workItems: AdminOperationalWorkItemResponse[];
};

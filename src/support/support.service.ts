import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  AdminAccount,
  AdminAccountStatus,
} from '../admin/entities/admin-account.entity';
import {
  AdminAuditAction,
  AdminAuditLog,
} from '../admin/entities/admin-audit-log.entity';
import {
  AdminNotification,
  AdminNotificationSeverity,
  AdminNotificationType,
} from '../admin/entities/admin-notification.entity';
import { type AdminAuthenticatedUser } from '../admin/admin.types';
import { User } from '../users/entities/user.entity';
import { canonicalizeEmailForIdentity } from '../users/users.service.utils';
import {
  SupportFeedbackPriority,
  SupportFeedbackSource,
  SupportFeedbackStatus,
  SupportFeedbackType,
  SupportFeedbackItem,
  encryptedFeedbackDescriptionTransformer,
} from './entities/support-feedback-item.entity';
import { SupportFeedbackNote } from './entities/support-feedback-note.entity';
import { SupportFeedbackStatusFilter } from './dto/support-feedback.dto';
import type {
  SupportFeedbackAdminActorResponse,
  SupportFeedbackContext,
  SupportFeedbackListResponse,
  SupportFeedbackNoteListResponse,
  SupportFeedbackNoteResponse,
  SupportFeedbackResponse,
  SupportFeedbackUserResponse,
  UserSupportFeedbackCreatedResponse,
} from './support.types';

const SUPPORT_FEEDBACK_DEFAULT_LIMIT = 20;
const SUPPORT_FEEDBACK_MAX_LIMIT = 100;
const SUPPORT_FEEDBACK_NOTES_DEFAULT_LIMIT = 10;
const SUPPORT_FEEDBACK_NOTES_MAX_LIMIT = 50;
const SUPPORT_FEEDBACK_TITLE_MAX_LENGTH = 160;
const SUPPORT_FEEDBACK_DESCRIPTION_MAX_LENGTH = 5000;
const SUPPORT_FEEDBACK_NOTE_MAX_LENGTH = 3000;
const SUPPORT_FEEDBACK_REASON_MAX_LENGTH = 500;
const USER_SUPPORT_FEEDBACK_HOURLY_LIMIT = 5;
const USER_SUPPORT_FEEDBACK_DAILY_LIMIT = 20;
const USER_SUPPORT_FEEDBACK_HOURLY_WINDOW_MS = 60 * 60 * 1000;
const USER_SUPPORT_FEEDBACK_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

type SupportRequestContext = {
  ip?: string | null;
  userAgent?: string | null;
};

type AdminSupportRequestContext = SupportRequestContext & {
  sessionId: string;
};

type Pagination = {
  limit: number;
  offset: number;
  page: number;
};

type QueryRow = Record<string, unknown>;
type QueryExecutor = Pick<DataSource | EntityManager, 'query'>;

type FeedbackMutationRepositories = {
  accountsRepository: Repository<AdminAccount>;
  auditLogsRepository: Repository<AdminAuditLog>;
  feedbackRepository: Repository<SupportFeedbackItem>;
  notificationsRepository: Repository<AdminNotification>;
  notesRepository: Repository<SupportFeedbackNote>;
  usersRepository: Repository<User>;
};

type SupportNotificationRepositories = Pick<
  FeedbackMutationRepositories,
  'accountsRepository' | 'notificationsRepository'
>;

function normalizePagination(options: {
  defaultLimit: number;
  limit?: number;
  maxLimit: number;
  page?: number;
}): Pagination {
  const limit =
    typeof options.limit === 'number' && Number.isFinite(options.limit)
      ? Math.min(Math.max(Math.floor(options.limit), 1), options.maxLimit)
      : options.defaultLimit;
  const page =
    typeof options.page === 'number' && Number.isFinite(options.page)
      ? Math.max(Math.floor(options.page), 1)
      : 1;

  return {
    limit,
    offset: (page - 1) * limit,
    page,
  };
}

function buildPaginationMeta(total: number, pagination: Pagination) {
  const safeTotal = Math.max(Math.floor(total), 0);
  const totalPages =
    safeTotal === 0 ? 0 : Math.ceil(safeTotal / pagination.limit);

  return {
    hasNextPage: totalPages > 0 && pagination.page < totalPages,
    hasPreviousPage: totalPages > 0 && pagination.page > 1,
    limit: pagination.limit,
    page: pagination.page,
    total: safeTotal,
    totalPages,
  };
}

function toStringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  return '';
}

function toNullableString(value: unknown): string | null {
  const normalized = toStringValue(value).trim();
  return normalized ? normalized : null;
}

function decryptFeedbackDescription(value: unknown): string {
  const storedValue = toStringValue(value);
  if (!storedValue.startsWith('ritora:v1:')) {
    return storedValue;
  }

  try {
    return toStringValue(
      encryptedFeedbackDescriptionTransformer.from(storedValue),
    );
  } catch {
    return '';
  }
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toIsoString(value: Date): string {
  return value.toISOString();
}

function toNullableIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function sanitizeIpAddress(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;
  return trimmed.slice(0, 45);
}

function sanitizeUserAgent(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;
  return trimmed.slice(0, 500);
}

function sanitizeContextValue(
  value: unknown,
  maxLength: number,
): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function toUserName(firstName: unknown, lastName: unknown): string {
  return [toStringValue(firstName), toStringValue(lastName)]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
}

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(private readonly dataSource: DataSource) {}

  async listAdminFeedback(query: {
    assignedAdminId?: string | null;
    limit?: number;
    page?: number;
    priority?: SupportFeedbackPriority;
    query?: string;
    status?: SupportFeedbackStatus | SupportFeedbackStatusFilter;
    type?: SupportFeedbackType;
  }): Promise<SupportFeedbackListResponse> {
    const pagination = normalizePagination({
      defaultLimit: SUPPORT_FEEDBACK_DEFAULT_LIMIT,
      limit: query.limit,
      maxLimit: SUPPORT_FEEDBACK_MAX_LIMIT,
      page: query.page,
    });
    const whereClauses = ['1 = 1'];
    const params: Array<number | string> = [];

    if (query.status && query.status !== SupportFeedbackStatusFilter.All) {
      params.push(this.normalizeFeedbackStatus(query.status));
      whereClauses.push(`feedback.status = $${params.length}`);
    }
    if (query.type) {
      params.push(this.normalizeFeedbackType(query.type));
      whereClauses.push(`feedback.type = $${params.length}`);
    }
    if (query.priority) {
      params.push(this.normalizeFeedbackPriority(query.priority));
      whereClauses.push(`feedback.priority = $${params.length}`);
    }
    if (query.assignedAdminId !== undefined) {
      if (query.assignedAdminId === null) {
        whereClauses.push('feedback.assigned_admin_id IS NULL');
      } else {
        params.push(query.assignedAdminId);
        whereClauses.push(`feedback.assigned_admin_id = $${params.length}`);
      }
    }

    const search = query.query?.trim();
    if (search) {
      params.push(`%${escapeLikePattern(search)}%`);
      const searchPatternParam = params.length;
      params.push(
        `%${escapeLikePattern(canonicalizeEmailForIdentity(search))}%`,
      );
      const canonicalSearchParam = params.length;
      params.push(search);
      const exactSearchParam = params.length;
      whereClauses.push(`(
        feedback.title ILIKE $${searchPatternParam} ESCAPE '\\'
        OR feedback.reporter_email ILIKE $${searchPatternParam} ESCAPE '\\'
        OR users.canonical_email ILIKE $${canonicalSearchParam} ESCAPE '\\'
        OR feedback.id = $${exactSearchParam}
      )`);
    }

    params.push(pagination.limit);
    const limitParam = params.length;
    params.push(pagination.offset);
    const offsetParam = params.length;

    const rows = await this.dataSource.query<QueryRow[]>(
      `
        WITH paged_feedback AS (
          SELECT
            feedback.id,
            feedback.user_id,
            feedback.reporter_email,
            feedback.source::text AS source,
            feedback.type::text AS type,
            feedback.status::text AS status,
            feedback.priority::text AS priority,
            feedback.title,
            feedback.description,
            feedback.context,
            feedback.assigned_admin_id,
            feedback.created_by_admin_id,
            feedback.closed_at,
            feedback.created_at,
            feedback.updated_at,
            users.email AS user_email,
            users.first_name AS user_first_name,
            users.last_name AS user_last_name,
            assigned_admin.email AS assigned_admin_email,
            assigned_admin.name AS assigned_admin_name,
            created_admin.email AS created_by_admin_email,
            created_admin.name AS created_by_admin_name,
            COUNT(*) OVER() AS total_count
          FROM support_feedback_items feedback
          LEFT JOIN users ON users.id = feedback.user_id
          LEFT JOIN admin_accounts assigned_admin
            ON assigned_admin.id = feedback.assigned_admin_id
          LEFT JOIN admin_accounts created_admin
            ON created_admin.id = feedback.created_by_admin_id
          WHERE ${whereClauses.join(' AND ')}
          ORDER BY feedback.updated_at DESC, feedback.id DESC
          LIMIT $${limitParam}
          OFFSET $${offsetParam}
        )
        SELECT feedback.*, COALESCE(note_counts.note_count, 0)::int AS note_count
        FROM paged_feedback feedback
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS note_count
          FROM support_feedback_notes notes
          WHERE notes.feedback_id = feedback.id
        ) note_counts ON true
        ORDER BY feedback.updated_at DESC, feedback.id DESC
      `,
      params,
    );
    const total = rows.length > 0 ? toNumber(rows[0].total_count) : 0;

    return {
      feedback: rows
        .filter((row) => typeof row.id === 'string')
        .map((row) => this.toFeedbackResponseFromRow(row)),
      ...buildPaginationMeta(total, pagination),
    };
  }

  async createUserFeedback(
    userId: string,
    input: {
      context?: SupportFeedbackContext | null;
      description: string;
      title: string;
      type: SupportFeedbackType;
    },
    requestContext: SupportRequestContext = {},
  ): Promise<UserSupportFeedbackCreatedResponse> {
    const type = this.normalizeFeedbackType(input.type);
    const saved = await this.dataSource.transaction(async (manager) => {
      const user = await this.findUserSubmissionEligibility(
        userId,
        new Date(),
        manager,
      );
      this.assertUserSupportSubmissionAllowed(user);
      const repositories = this.getMutationRepositories(manager);
      const feedback = repositories.feedbackRepository.create({
        assigned_admin_id: null,
        closed_at: null,
        closed_by_admin_id: null,
        context: this.normalizeFeedbackContext(input.context, requestContext),
        created_by_admin_id: null,
        description: this.normalizeFeedbackText(
          input.description,
          'Support feedback description is required',
          SUPPORT_FEEDBACK_DESCRIPTION_MAX_LENGTH,
          8,
        ),
        priority: this.inferUserFeedbackPriority(type),
        reporter_email: toNullableString(user.email),
        source: SupportFeedbackSource.UserWebApp,
        status: SupportFeedbackStatus.New,
        title: this.normalizeFeedbackText(
          input.title,
          'Support feedback title is required',
          SUPPORT_FEEDBACK_TITLE_MAX_LENGTH,
          3,
        ),
        type,
        user_id: userId,
      });
      const created = await repositories.feedbackRepository.save(feedback);
      return created;
    });
    await this.tryCreateUrgentSupportNotifications(saved);

    return {
      createdAt: toNullableIso(saved.created_at) ?? toIsoString(new Date(0)),
      id: saved.id,
      status: saved.status,
    };
  }

  async createAdminFeedback(
    actor: AdminAuthenticatedUser,
    input: {
      context?: SupportFeedbackContext | null;
      description: string;
      priority?: SupportFeedbackPriority;
      reason: string;
      reporterEmail?: string | null;
      source?: SupportFeedbackSource;
      title: string;
      type: SupportFeedbackType;
      userIdentifier?: string | null;
    },
    requestContext: AdminSupportRequestContext,
  ): Promise<SupportFeedbackResponse> {
    const reason = this.normalizeAuditReason(input.reason);
    const title = this.normalizeFeedbackText(
      input.title,
      'Support feedback title is required',
      SUPPORT_FEEDBACK_TITLE_MAX_LENGTH,
      3,
    );
    const description = this.normalizeFeedbackText(
      input.description,
      'Support feedback description is required',
      SUPPORT_FEEDBACK_DESCRIPTION_MAX_LENGTH,
      8,
    );
    const source = this.normalizeFeedbackSource(
      input.source ?? SupportFeedbackSource.AdminCreated,
    );
    const type = this.normalizeFeedbackType(input.type);
    const priority = this.normalizeFeedbackPriority(
      input.priority ?? SupportFeedbackPriority.Medium,
    );
    const reporterEmail = this.normalizeOptionalEmail(input.reporterEmail);

    const result = await this.dataSource.transaction(async (manager) => {
      const repositories = this.getMutationRepositories(manager);
      const user = input.userIdentifier
        ? await this.findUserByIdentifier(
            repositories.usersRepository,
            input.userIdentifier,
          )
        : null;
      const feedback = repositories.feedbackRepository.create({
        assigned_admin_id: null,
        closed_at: null,
        closed_by_admin_id: null,
        context: this.normalizeFeedbackContext(input.context, requestContext),
        created_by_admin_id: actor.id,
        description,
        priority,
        reporter_email: reporterEmail ?? user?.email ?? null,
        source,
        status: SupportFeedbackStatus.New,
        title,
        type,
        user_id: user?.id ?? null,
      });
      const saved = await repositories.feedbackRepository.save(feedback);

      await this.writeFeedbackAuditLog(repositories.auditLogsRepository, {
        action: AdminAuditAction.SupportFeedbackCreated,
        actor,
        context: { ...requestContext, reason },
        feedback: saved,
        metadata: {
          feedbackId: saved.id,
          priority,
          source,
          status: saved.status,
          type,
        },
      });

      return {
        feedback: saved,
        response: this.toFeedbackResponseFromEntity(saved, {
          assignedAdmins: new Map(),
          createdAdmins: this.actorMap(actor),
          users: user ? this.userMap(user) : new Map(),
        }),
      };
    });
    await this.tryCreateUrgentSupportNotifications(result.feedback);
    return result.response;
  }

  async updateAdminFeedback(
    actor: AdminAuthenticatedUser,
    feedbackId: string,
    input: {
      assignedAdminId?: string | null;
      priority?: SupportFeedbackPriority;
      reason: string;
      status?: SupportFeedbackStatus;
    },
    requestContext: AdminSupportRequestContext,
  ): Promise<SupportFeedbackResponse> {
    const reason = this.normalizeAuditReason(input.reason);

    const result = await this.dataSource.transaction(async (manager) => {
      const repositories = this.getMutationRepositories(manager);
      const feedback = await repositories.feedbackRepository.findOne({
        where: { id: feedbackId },
      });
      if (!feedback) {
        throw new NotFoundException('Support feedback not found');
      }
      const previousPriority = feedback.priority;
      const previousStatus = feedback.status;

      let assignedAdmin: AdminAccount | null = null;
      if (input.assignedAdminId !== undefined) {
        if (input.assignedAdminId) {
          assignedAdmin = await this.findActiveAdminAccount(
            repositories.accountsRepository,
            input.assignedAdminId,
          );
          feedback.assigned_admin_id = assignedAdmin.id;
        } else {
          feedback.assigned_admin_id = null;
        }
      }

      if (input.priority) {
        feedback.priority = this.normalizeFeedbackPriority(input.priority);
      }
      if (input.status) {
        feedback.status = this.normalizeFeedbackStatus(input.status);
        if (feedback.status === SupportFeedbackStatus.Closed) {
          feedback.closed_at = feedback.closed_at ?? new Date();
          feedback.closed_by_admin_id = actor.id;
        } else {
          feedback.closed_at = null;
          feedback.closed_by_admin_id = null;
        }
      }

      const saved = await repositories.feedbackRepository.save(feedback);
      await this.writeFeedbackAuditLog(repositories.auditLogsRepository, {
        action: AdminAuditAction.SupportFeedbackUpdated,
        actor,
        context: { ...requestContext, reason },
        feedback: saved,
        metadata: {
          assignedAdminId: saved.assigned_admin_id,
          feedbackId: saved.id,
          priority: saved.priority,
          status: saved.status,
          type: saved.type,
        },
      });
      return {
        feedback: saved,
        shouldNotify: this.shouldCreateUrgentSupportNotification(saved, {
          priority: previousPriority,
          status: previousStatus,
        }),
        response: this.toFeedbackResponseFromEntity(saved, {
          assignedAdmins:
            assignedAdmin || saved.assigned_admin_id === actor.id
              ? this.actorMapFromValues({
                  email: assignedAdmin?.email ?? actor.email,
                  id: assignedAdmin?.id ?? actor.id,
                  name: assignedAdmin?.name ?? actor.name,
                })
              : new Map(),
          createdAdmins:
            saved.created_by_admin_id === actor.id
              ? this.actorMap(actor)
              : new Map(),
          users: new Map(),
        }),
      };
    });
    if (result.shouldNotify) {
      await this.tryCreateUrgentSupportNotifications(result.feedback);
    }
    return result.response;
  }

  async listAdminFeedbackNotes(
    feedbackId: string,
    query: { limit?: number; page?: number } = {},
  ): Promise<SupportFeedbackNoteListResponse> {
    await this.ensureFeedbackExists(feedbackId);
    const pagination = normalizePagination({
      defaultLimit: SUPPORT_FEEDBACK_NOTES_DEFAULT_LIMIT,
      limit: query.limit,
      maxLimit: SUPPORT_FEEDBACK_NOTES_MAX_LIMIT,
      page: query.page,
    });
    const notesRepository = this.dataSource.getRepository(SupportFeedbackNote);
    const [notes, total] = await notesRepository.findAndCount({
      order: { created_at: 'DESC', id: 'DESC' },
      skip: pagination.offset,
      take: pagination.limit,
      where: { feedback_id: feedbackId },
    });
    const authors = await this.getAdminActors(
      notes.map((note) => note.author_admin_id),
    );

    return {
      notes: notes.map((note) => this.toFeedbackNoteResponse(note, authors)),
      ...buildPaginationMeta(total, pagination),
    };
  }

  async createAdminFeedbackNote(
    actor: AdminAuthenticatedUser,
    feedbackId: string,
    input: { body: string; reason: string },
    requestContext: AdminSupportRequestContext,
  ): Promise<SupportFeedbackNoteResponse> {
    const body = this.normalizeFeedbackText(
      input.body,
      'Support feedback note is required',
      SUPPORT_FEEDBACK_NOTE_MAX_LENGTH,
      3,
    );
    const reason = this.normalizeAuditReason(input.reason);

    return this.dataSource.transaction(async (manager) => {
      const repositories = this.getMutationRepositories(manager);
      const feedback = await repositories.feedbackRepository.findOne({
        where: { id: feedbackId },
      });
      if (!feedback) {
        throw new NotFoundException('Support feedback not found');
      }
      const note = repositories.notesRepository.create({
        author_admin_id: actor.id,
        body,
        feedback_id: feedback.id,
      });
      const saved = await repositories.notesRepository.save(note);

      await this.writeFeedbackAuditLog(repositories.auditLogsRepository, {
        action: AdminAuditAction.SupportFeedbackNoteCreated,
        actor,
        context: { ...requestContext, reason },
        feedback,
        metadata: {
          feedbackId: feedback.id,
          noteId: saved.id,
        },
      });

      return this.toFeedbackNoteResponse(saved, this.actorMap(actor));
    });
  }

  private async findUserSubmissionEligibility(
    userId: string,
    now: Date,
    executor: QueryExecutor = this.dataSource,
  ): Promise<QueryRow> {
    const hourWindowStart = new Date(
      now.getTime() - USER_SUPPORT_FEEDBACK_HOURLY_WINDOW_MS,
    );
    const dayWindowStart = new Date(
      now.getTime() - USER_SUPPORT_FEEDBACK_DAILY_WINDOW_MS,
    );
    const rows = await executor.query<QueryRow[]>(
      `
        SELECT
          users.id,
          users.email,
          users.first_name,
          users.last_name,
          COALESCE(recent_feedback.hour_count, 0)::int AS hour_count,
          COALESCE(recent_feedback.day_count, 0)::int AS day_count
        FROM users
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*) FILTER (WHERE feedback.created_at >= $2)::int AS hour_count,
            COUNT(*)::int AS day_count
          FROM support_feedback_items feedback
          WHERE feedback.user_id = users.id
            AND feedback.created_at >= $3
        ) recent_feedback ON true
        WHERE users.id = $1
        FOR UPDATE OF users
      `,
      [userId, hourWindowStart, dayWindowStart],
    );
    const user = rows[0];
    if (!user || typeof user.id !== 'string') {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  private assertUserSupportSubmissionAllowed(user: QueryRow): void {
    if (
      toNumber(user.hour_count) >= USER_SUPPORT_FEEDBACK_HOURLY_LIMIT ||
      toNumber(user.day_count) >= USER_SUPPORT_FEEDBACK_DAILY_LIMIT
    ) {
      throw new HttpException(
        'Support request limit reached. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async findUserByIdentifier(
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

  private async findActiveAdminAccount(
    accountsRepository: Repository<AdminAccount>,
    adminId: string,
  ): Promise<AdminAccount> {
    const admin = await accountsRepository.findOne({
      where: { id: adminId, status: AdminAccountStatus.Active },
    });
    if (!admin) {
      throw new NotFoundException('Assigned admin not found');
    }

    return admin;
  }

  private async ensureFeedbackExists(feedbackId: string): Promise<void> {
    const row = await this.dataSource.query<QueryRow[]>(
      `
        SELECT id
        FROM support_feedback_items
        WHERE id = $1
      `,
      [feedbackId],
    );
    const first = Array.isArray(row) ? (row[0] as QueryRow | undefined) : null;
    if (!first || typeof first.id !== 'string') {
      throw new NotFoundException('Support feedback not found');
    }
  }

  private async getAdminActors(
    adminIds: readonly string[],
  ): Promise<Map<string, SupportFeedbackAdminActorResponse>> {
    const uniqueIds = [...new Set(adminIds.filter(Boolean))];
    if (uniqueIds.length === 0) return new Map();

    const rows = await this.dataSource.query<QueryRow[]>(
      `
        SELECT id, email, name
        FROM admin_accounts
        WHERE id = ANY($1::varchar[])
      `,
      [uniqueIds],
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

  private getMutationRepositories(
    manager: EntityManager,
  ): FeedbackMutationRepositories {
    return {
      accountsRepository: manager.getRepository(AdminAccount),
      auditLogsRepository: manager.getRepository(AdminAuditLog),
      feedbackRepository: manager.getRepository(SupportFeedbackItem),
      notificationsRepository: manager.getRepository(AdminNotification),
      notesRepository: manager.getRepository(SupportFeedbackNote),
      usersRepository: manager.getRepository(User),
    };
  }

  private async createUrgentSupportNotifications(
    repositories: SupportNotificationRepositories,
    feedback: SupportFeedbackItem,
  ): Promise<void> {
    if (
      feedback.status === SupportFeedbackStatus.Closed ||
      !this.isUrgentSupportPriority(feedback.priority)
    ) {
      return;
    }

    const admins = await repositories.accountsRepository.find({
      select: { id: true },
      where: { status: AdminAccountStatus.Active },
    });
    if (admins.length === 0) {
      return;
    }

    const notifications = admins.map((admin) =>
      repositories.notificationsRepository.create({
        action_url: `/support?status=new&priority=${feedback.priority}`,
        admin_id: admin.id,
        body: this.supportNotificationBody(feedback.priority),
        metadata: {
          feedbackId: feedback.id,
          priority: feedback.priority,
          source: feedback.source,
          status: feedback.status,
          type: feedback.type,
        },
        read_at: null,
        severity: this.supportNotificationSeverity(feedback.priority),
        title: this.supportNotificationTitle(feedback.priority),
        type: AdminNotificationType.SupportFeedbackAlert,
      }),
    );

    await repositories.notificationsRepository.save(notifications);
  }

  private async tryCreateUrgentSupportNotifications(
    feedback: SupportFeedbackItem,
  ): Promise<void> {
    try {
      await this.createUrgentSupportNotifications(
        {
          accountsRepository: this.dataSource.getRepository(AdminAccount),
          notificationsRepository:
            this.dataSource.getRepository(AdminNotification),
        },
        feedback,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to create support notification for feedback ${feedback.id}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private shouldCreateUrgentSupportNotification(
    feedback: SupportFeedbackItem,
    previous?: {
      priority: SupportFeedbackPriority;
      status: SupportFeedbackStatus;
    },
  ): boolean {
    if (
      feedback.status === SupportFeedbackStatus.Closed ||
      !this.isUrgentSupportPriority(feedback.priority)
    ) {
      return false;
    }
    if (!previous) {
      return true;
    }
    return (
      !this.isUrgentSupportPriority(previous.priority) ||
      previous.status === SupportFeedbackStatus.Closed
    );
  }

  private isUrgentSupportPriority(priority: SupportFeedbackPriority): boolean {
    return (
      priority === SupportFeedbackPriority.High ||
      priority === SupportFeedbackPriority.Critical
    );
  }

  private supportNotificationSeverity(
    priority: SupportFeedbackPriority,
  ): AdminNotificationSeverity {
    return priority === SupportFeedbackPriority.Critical
      ? AdminNotificationSeverity.Critical
      : AdminNotificationSeverity.Warning;
  }

  private supportNotificationTitle(priority: SupportFeedbackPriority): string {
    return priority === SupportFeedbackPriority.Critical
      ? 'Critical support item'
      : 'High priority support item';
  }

  private supportNotificationBody(priority: SupportFeedbackPriority): string {
    return priority === SupportFeedbackPriority.Critical
      ? 'A critical support item needs review.'
      : 'A high priority support item needs review.';
  }

  private toFeedbackResponseFromRow(row: QueryRow): SupportFeedbackResponse {
    const userId = toNullableString(row.user_id);
    const assignedAdminId = toNullableString(row.assigned_admin_id);
    const createdByAdminId = toNullableString(row.created_by_admin_id);

    return {
      assignedAdmin: assignedAdminId
        ? {
            email: toStringValue(row.assigned_admin_email),
            id: assignedAdminId,
            name: toStringValue(row.assigned_admin_name),
          }
        : null,
      assignedAdminId,
      closedAt: toNullableIso(row.closed_at),
      context: this.safeFeedbackContext(row.context),
      createdAt: toNullableIso(row.created_at) ?? toIsoString(new Date(0)),
      createdByAdmin: createdByAdminId
        ? {
            email: toStringValue(row.created_by_admin_email),
            id: createdByAdminId,
            name: toStringValue(row.created_by_admin_name),
          }
        : null,
      createdByAdminId,
      description: decryptFeedbackDescription(row.description),
      id: toStringValue(row.id),
      noteCount: toNumber(row.note_count),
      priority: this.normalizeFeedbackPriority(
        toStringValue(row.priority) as SupportFeedbackPriority,
      ),
      reporterEmail: toNullableString(row.reporter_email),
      source: this.normalizeFeedbackSource(
        toStringValue(row.source) as SupportFeedbackSource,
      ),
      status: this.normalizeFeedbackStatus(
        toStringValue(row.status) as SupportFeedbackStatus,
      ),
      title: toStringValue(row.title),
      type: this.normalizeFeedbackType(
        toStringValue(row.type) as SupportFeedbackType,
      ),
      updatedAt: toNullableIso(row.updated_at) ?? toIsoString(new Date(0)),
      user: userId
        ? {
            email: toStringValue(row.user_email),
            id: userId,
            name: toUserName(row.user_first_name, row.user_last_name),
          }
        : null,
      userId,
    };
  }

  private toFeedbackResponseFromEntity(
    feedback: SupportFeedbackItem,
    maps: {
      assignedAdmins: ReadonlyMap<string, SupportFeedbackAdminActorResponse>;
      createdAdmins: ReadonlyMap<string, SupportFeedbackAdminActorResponse>;
      users: ReadonlyMap<string, SupportFeedbackUserResponse>;
    },
  ): SupportFeedbackResponse {
    return {
      assignedAdmin: feedback.assigned_admin_id
        ? (maps.assignedAdmins.get(feedback.assigned_admin_id) ?? null)
        : null,
      assignedAdminId: feedback.assigned_admin_id,
      closedAt: toNullableIso(feedback.closed_at),
      context: this.safeFeedbackContext(feedback.context),
      createdAt: toNullableIso(feedback.created_at) ?? toIsoString(new Date(0)),
      createdByAdmin: feedback.created_by_admin_id
        ? (maps.createdAdmins.get(feedback.created_by_admin_id) ?? null)
        : null,
      createdByAdminId: feedback.created_by_admin_id,
      description: feedback.description,
      id: feedback.id,
      noteCount: 0,
      priority: feedback.priority,
      reporterEmail: feedback.reporter_email,
      source: feedback.source,
      status: feedback.status,
      title: feedback.title,
      type: feedback.type,
      updatedAt:
        toNullableIso(feedback.updated_at) ??
        toNullableIso(feedback.created_at) ??
        toIsoString(new Date(0)),
      user: feedback.user_id
        ? (maps.users.get(feedback.user_id) ?? null)
        : null,
      userId: feedback.user_id,
    };
  }

  private toFeedbackNoteResponse(
    note: SupportFeedbackNote,
    authors: ReadonlyMap<string, SupportFeedbackAdminActorResponse>,
  ): SupportFeedbackNoteResponse {
    return {
      author: authors.get(note.author_admin_id) ?? null,
      authorAdminId: note.author_admin_id,
      body: note.body,
      createdAt: toNullableIso(note.created_at) ?? toIsoString(new Date(0)),
      feedbackId: note.feedback_id,
      id: note.id,
    };
  }

  private userMap(
    user: User | QueryRow,
  ): Map<string, SupportFeedbackUserResponse> {
    const id = toStringValue('id' in user ? user.id : null);
    if (!id) return new Map();
    return new Map([
      [
        id,
        {
          email: toStringValue('email' in user ? user.email : null),
          id,
          name: toUserName(
            'first_name' in user ? user.first_name : null,
            'last_name' in user ? user.last_name : null,
          ),
        },
      ],
    ]);
  }

  private actorMap(
    actor: AdminAuthenticatedUser,
  ): Map<string, SupportFeedbackAdminActorResponse> {
    return this.actorMapFromValues(actor);
  }

  private actorMapFromValues(actor: {
    email: string;
    id: string;
    name: string;
  }): Map<string, SupportFeedbackAdminActorResponse> {
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

  private normalizeFeedbackText(
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
      throw new BadRequestException('Support feedback text is too long');
    }
    return trimmed;
  }

  private normalizeAuditReason(reason: string): string {
    const trimmed = reason.trim().replace(/\s+/g, ' ');
    if (trimmed.length < 8) {
      throw new BadRequestException('Admin audit reason is required');
    }
    if (trimmed.length > SUPPORT_FEEDBACK_REASON_MAX_LENGTH) {
      throw new BadRequestException('Admin audit reason is too long');
    }
    return trimmed;
  }

  private normalizeOptionalEmail(
    value: string | null | undefined,
  ): string | null {
    const trimmed = value?.trim().toLowerCase() ?? '';
    if (!trimmed) return null;
    if (trimmed.length > 320 || !trimmed.includes('@')) {
      throw new BadRequestException('Support reporter email is invalid');
    }
    return trimmed;
  }

  private normalizeFeedbackContext(
    context: SupportFeedbackContext | null | undefined,
    requestContext: SupportRequestContext = {},
  ): Record<string, string> {
    const normalized: Record<string, string> = {};
    const route = sanitizeContextValue(context?.route, 160);
    const locale = sanitizeContextValue(context?.locale, 16);
    const appVersion = sanitizeContextValue(context?.appVersion, 40);
    const requestId = sanitizeContextValue(context?.requestId, 120);
    const browser =
      sanitizeContextValue(context?.browser, 160) ??
      sanitizeContextValue(requestContext.userAgent, 160);

    if (route) normalized.route = route;
    if (locale) normalized.locale = locale;
    if (appVersion) normalized.appVersion = appVersion;
    if (requestId) normalized.requestId = requestId;
    if (browser) normalized.browser = browser;
    return normalized;
  }

  private safeFeedbackContext(value: unknown): SupportFeedbackContext {
    return this.normalizeFeedbackContext(
      value && typeof value === 'object'
        ? (value as SupportFeedbackContext)
        : undefined,
    );
  }

  private normalizeFeedbackSource(
    source: SupportFeedbackSource,
  ): SupportFeedbackSource {
    if (Object.values(SupportFeedbackSource).includes(source)) return source;
    throw new BadRequestException('Support feedback source is invalid');
  }

  private normalizeFeedbackType(
    type: SupportFeedbackType,
  ): SupportFeedbackType {
    if (Object.values(SupportFeedbackType).includes(type)) return type;
    throw new BadRequestException('Support feedback type is invalid');
  }

  private normalizeFeedbackStatus(
    status: SupportFeedbackStatus | SupportFeedbackStatusFilter,
  ): SupportFeedbackStatus {
    if (
      Object.values(SupportFeedbackStatus).includes(
        status as SupportFeedbackStatus,
      )
    ) {
      return status as SupportFeedbackStatus;
    }
    throw new BadRequestException('Support feedback status is invalid');
  }

  private normalizeFeedbackPriority(
    priority: SupportFeedbackPriority,
  ): SupportFeedbackPriority {
    if (Object.values(SupportFeedbackPriority).includes(priority)) {
      return priority;
    }
    throw new BadRequestException('Support feedback priority is invalid');
  }

  private inferUserFeedbackPriority(
    type: SupportFeedbackType,
  ): SupportFeedbackPriority {
    return type === SupportFeedbackType.UnsafeRecommendation
      ? SupportFeedbackPriority.High
      : SupportFeedbackPriority.Medium;
  }

  private async writeFeedbackAuditLog(
    auditLogsRepository: Repository<AdminAuditLog>,
    input: {
      action: AdminAuditAction;
      actor: AdminAuthenticatedUser;
      context: AdminSupportRequestContext & { reason: string };
      feedback: SupportFeedbackItem;
      metadata: Record<string, unknown>;
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
      target_user_id: input.feedback.user_id,
      user_agent: sanitizeUserAgent(input.context.userAgent),
    });

    await auditLogsRepository.save(auditLog);
  }
}

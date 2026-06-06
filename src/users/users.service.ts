import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  IsNull,
  LessThanOrEqual,
  Not,
  Repository,
} from 'typeorm';
import { User } from './entities/user.entity';
import {
  CommunityContentType,
  CommunityHelpfulnessVote,
  CommunityOutcomeSignal,
} from '../community/community.types';
import {
  buildTimeZonePatch,
  canonicalizeEmailForIdentity,
  normalizeEmail,
  normalizePreferredLanguage,
  normalizeProfileName,
} from './users.service.utils';

type AuthUserLookup = {
  clause: string;
  params: Record<string, string>;
};

type DatabaseError = {
  code?: unknown;
  constraint?: unknown;
};

const POSTGRES_UNIQUE_VIOLATION_CODE = '23505';
const EMAIL_IDENTITY_UNIQUE_CONSTRAINTS = new Set([
  'idx_users_canonical_email',
  'idx_users_email_lower',
]);
const EMAIL_IN_USE_MESSAGE = 'Email already in use';
const EXPLICIT_USER_DATA_TABLES = [
  'push_notification_deliveries',
  'skin_journal_media_deletion_jobs',
] as const;
const COMMUNITY_ROUTINES_TABLE = 'community_routines';
const COMMUNITY_REVIEWS_TABLE = 'community_reviews';

type CommunityContentReference = {
  content_type: CommunityContentType;
  content_id: string;
};

type CommunityHelpfulnessCountRow = {
  vote: CommunityHelpfulnessVote;
  count: number | string;
};

type CommunityOutcomeSignalCountRow = {
  signal: CommunityOutcomeSignal;
  count: number | string;
};

const COMMUNITY_CONTENT_TYPES = new Set<unknown>(
  Object.values(CommunityContentType),
);
const COMMUNITY_HELPFULNESS_VOTES = new Set<unknown>(
  Object.values(CommunityHelpfulnessVote),
);
const COMMUNITY_OUTCOME_SIGNALS = new Set<unknown>(
  Object.values(CommunityOutcomeSignal),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCommunityContentReference(
  value: unknown,
): value is CommunityContentReference {
  if (!isRecord(value)) {
    return false;
  }

  return (
    COMMUNITY_CONTENT_TYPES.has(value.content_type) &&
    typeof value.content_id === 'string'
  );
}

function isCommunityHelpfulnessCountRow(
  value: unknown,
): value is CommunityHelpfulnessCountRow {
  if (!isRecord(value)) {
    return false;
  }

  return (
    COMMUNITY_HELPFULNESS_VOTES.has(value.vote) &&
    isCommunityCountValue(value.count)
  );
}

function isCommunityOutcomeSignalCountRow(
  value: unknown,
): value is CommunityOutcomeSignalCountRow {
  if (!isRecord(value)) {
    return false;
  }

  return (
    COMMUNITY_OUTCOME_SIGNALS.has(value.signal) &&
    isCommunityCountValue(value.count)
  );
}

function isCommunityCountValue(value: unknown): value is number | string {
  return typeof value === 'number' || typeof value === 'string';
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { canonical_email: canonicalizeEmailForIdentity(email) },
    });
  }

  async findByEmailForAuth(email: string): Promise<User | null> {
    return this.findForAuth({
      clause: 'user.canonical_email = :canonicalEmail',
      params: { canonicalEmail: canonicalizeEmailForIdentity(email) },
    });
  }

  async findByGoogleSubject(googleSubject: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { google_subject: googleSubject },
    });
  }

  async findByAppleSubject(appleSubject: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { apple_subject: appleSubject },
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  async findByIdOrFail(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async findByIdForAuth(id: string): Promise<User | null> {
    return this.findForAuth({
      clause: 'user.id = :id',
      params: { id },
    });
  }

  async findByAccountDeletionCancelTokenHash(
    hash: string,
  ): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { account_deletion_cancel_token_hash: hash },
    });
  }

  async findByAccountDeletionConfirmTokenHash(
    hash: string,
  ): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { account_deletion_confirm_token_hash: hash },
    });
  }

  async create(data: {
    email: string;
    password_hash: string | null;
    first_name: string;
    last_name: string;
    preferred_language: string;
    email_verification_token_hash?: string;
    email_verification_expires?: Date;
  }): Promise<User> {
    return this.saveCreatedUser(
      this.usersRepository.create({
        ...data,
        email: normalizeEmail(data.email),
        canonical_email: canonicalizeEmailForIdentity(data.email),
      }),
    );
  }

  async createGoogleUser(data: {
    email: string;
    google_subject: string;
    first_name: string;
    last_name: string;
    preferred_language: string;
  }): Promise<User> {
    return this.saveCreatedUser(
      this.usersRepository.create({
        ...data,
        email: normalizeEmail(data.email),
        canonical_email: canonicalizeEmailForIdentity(data.email),
        password_hash: null,
        email_verified: true,
        email_verification_token_hash: null,
        email_verification_expires: null,
      }),
    );
  }

  async createAppleUser(data: {
    email: string;
    apple_subject: string;
    first_name: string;
    last_name: string;
    preferred_language: string;
  }): Promise<User> {
    return this.saveCreatedUser(
      this.usersRepository.create({
        ...data,
        email: normalizeEmail(data.email),
        canonical_email: canonicalizeEmailForIdentity(data.email),
        password_hash: null,
        email_verified: true,
        email_verification_token_hash: null,
        email_verification_expires: null,
      }),
    );
  }

  async update(id: string, data: Partial<User>): Promise<User> {
    const user = await this.findByIdOrFail(id);
    return this.saveUserPatch(user, data);
  }

  async updateProfile(
    id: string,
    data: { firstName: string; lastName: string },
  ): Promise<User> {
    return this.update(id, {
      first_name: normalizeProfileName(data.firstName),
      last_name: normalizeProfileName(data.lastName),
    });
  }

  async updatePreferredLanguage(
    id: string,
    preferredLanguage: string,
  ): Promise<User> {
    return this.update(id, {
      preferred_language: normalizePreferredLanguage(preferredLanguage),
    });
  }

  async updateTimeZone(id: string, timeZone: string): Promise<User> {
    return this.update(id, buildTimeZonePatch(timeZone));
  }

  async linkGoogleSubject(id: string, googleSubject: string): Promise<User> {
    const result = await this.usersRepository
      .createQueryBuilder()
      .update(User)
      .set({
        google_subject: googleSubject,
        email_verified: true,
        email_verification_token_hash: null,
        email_verification_expires: null,
      })
      .where('id = :id', { id })
      .andWhere('(google_subject IS NULL OR google_subject = :googleSubject)', {
        googleSubject,
      })
      .execute();

    if (result.affected !== 1) {
      throw new ConflictException('Email already linked to Google');
    }

    return this.findByIdOrFail(id);
  }

  async linkAppleSubject(id: string, appleSubject: string): Promise<User> {
    const result = await this.usersRepository
      .createQueryBuilder()
      .update(User)
      .set({
        apple_subject: appleSubject,
        email_verified: true,
        email_verification_token_hash: null,
        email_verification_expires: null,
      })
      .where('id = :id', { id })
      .andWhere('(apple_subject IS NULL OR apple_subject = :appleSubject)', {
        appleSubject,
      })
      .execute();

    if (result.affected !== 1) {
      throw new ConflictException('Email already linked to Apple');
    }

    return this.findByIdOrFail(id);
  }

  async captureTimeZoneIfMissing(id: string, timeZone: string): Promise<User> {
    const timeZonePatch = buildTimeZonePatch(timeZone);

    await this.usersRepository
      .createQueryBuilder()
      .update(User)
      .set(timeZonePatch)
      .where('id = :id', { id })
      .andWhere('time_zone IS NULL')
      .execute();

    return this.findByIdOrFail(id);
  }

  async findByVerificationTokenHash(hash: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { email_verification_token_hash: hash },
    });
  }

  async findByResetTokenHash(hash: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { password_reset_token_hash: hash },
    });
  }

  async setAccountDeletionState(
    id: string,
    data: {
      requestedAt: Date | null;
      scheduledFor: Date | null;
      cancelTokenHash: string | null;
      confirmTokenHash: string | null;
      confirmExpires: Date | null;
    },
  ): Promise<User> {
    return this.update(id, {
      account_deletion_requested_at: data.requestedAt,
      account_deletion_scheduled_for: data.scheduledFor,
      account_deletion_cancel_token_hash: data.cancelTokenHash,
      account_deletion_cancel_token_consumed_at: null,
      account_deletion_confirm_token_hash: data.confirmTokenHash,
      account_deletion_confirm_expires: data.confirmExpires,
    });
  }

  async markAccountDeletionCancellationComplete(
    id: string,
    cancelTokenHash: string,
    cancelledAt: Date,
  ): Promise<boolean> {
    const result = await this.usersRepository
      .createQueryBuilder()
      .update(User)
      .set({
        account_deletion_requested_at: null,
        account_deletion_scheduled_for: null,
        account_deletion_cancel_token_hash: cancelTokenHash,
        account_deletion_cancel_token_consumed_at: cancelledAt,
        account_deletion_confirm_token_hash: null,
        account_deletion_confirm_expires: null,
      })
      .where('id = :id', { id })
      .andWhere('account_deletion_cancel_token_hash = :cancelTokenHash', {
        cancelTokenHash,
      })
      .andWhere('account_deletion_scheduled_for IS NOT NULL')
      .execute();

    return result.affected === 1;
  }

  async clearAccountDeletionState(id: string): Promise<void> {
    await this.usersRepository
      .createQueryBuilder()
      .update(User)
      .set({
        account_deletion_requested_at: null,
        account_deletion_scheduled_for: null,
        account_deletion_cancel_token_hash: null,
        account_deletion_cancel_token_consumed_at: null,
        account_deletion_confirm_token_hash: null,
        account_deletion_confirm_expires: null,
      })
      .where('id = :id', { id })
      .andWhere(
        [
          'account_deletion_requested_at IS NOT NULL',
          'account_deletion_scheduled_for IS NOT NULL',
          'account_deletion_cancel_token_hash IS NOT NULL',
          'account_deletion_cancel_token_consumed_at IS NOT NULL',
          'account_deletion_confirm_token_hash IS NOT NULL',
          'account_deletion_confirm_expires IS NOT NULL',
        ].join(' OR '),
      )
      .execute();
  }

  async findDueAccountDeletions(now: Date, take: number): Promise<User[]> {
    return this.usersRepository.find({
      where: {
        account_deletion_scheduled_for: LessThanOrEqual(now),
        account_deletion_cancel_token_hash: Not(IsNull()),
      },
      order: { account_deletion_scheduled_for: 'ASC' },
      take,
    });
  }

  async clearExpiredAccountDeletionCancellationReceipts(
    olderThan: Date,
  ): Promise<number> {
    const result = await this.usersRepository
      .createQueryBuilder()
      .update(User)
      .set({
        account_deletion_cancel_token_hash: null,
        account_deletion_cancel_token_consumed_at: null,
      })
      .where('account_deletion_scheduled_for IS NULL')
      .andWhere('account_deletion_requested_at IS NULL')
      .andWhere('account_deletion_confirm_token_hash IS NULL')
      .andWhere('account_deletion_confirm_expires IS NULL')
      .andWhere('account_deletion_cancel_token_consumed_at <= :olderThan', {
        olderThan,
      })
      .execute();

    return result.affected ?? 0;
  }

  async clearExpiredAccountRestriction(
    id: string,
    now = new Date(),
  ): Promise<boolean> {
    const result = await this.usersRepository
      .createQueryBuilder()
      .update(User)
      .set({
        account_restricted_at: null,
        account_restricted_by_admin_id: null,
        account_restriction_capabilities: null,
        account_restriction_expires_at: null,
        account_restriction_internal_note: null,
        account_restriction_reason: null,
        account_restriction_user_message: null,
      })
      .where('id = :id', { id })
      .andWhere('account_restricted_at IS NOT NULL')
      .andWhere('account_restriction_expires_at IS NOT NULL')
      .andWhere('account_restriction_expires_at <= :now', { now })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  async remove(id: string): Promise<void> {
    const user = await this.findByIdOrFail(id);
    await this.usersRepository.manager.transaction(async (manager) => {
      await this.removeCommunityContentForAccountDeletion(manager, id);

      for (const tableName of EXPLICIT_USER_DATA_TABLES) {
        await manager.delete(tableName, { user_id: id });
      }

      await manager.remove(User, user);
    });
  }

  private async removeCommunityContentForAccountDeletion(
    manager: EntityManager,
    userId: string,
  ): Promise<void> {
    await this.removeUserCommunitySignalsForAccountDeletion(manager, userId);

    const authoredContentWhere = `
      (
        "content_type" = $2
        AND "content_id" IN (
          SELECT "id" FROM "${COMMUNITY_ROUTINES_TABLE}" WHERE "author_user_id" = $1
        )
      )
      OR (
        "content_type" = $3
        AND "content_id" IN (
          SELECT "id" FROM "${COMMUNITY_REVIEWS_TABLE}" WHERE "author_user_id" = $1
        )
      )
    `;
    const contentParams = [
      userId,
      CommunityContentType.Routine,
      CommunityContentType.Review,
    ];

    await manager.query(
      `DELETE FROM "community_reports" WHERE ${authoredContentWhere}`,
      contentParams,
    );
    await manager.query(
      `DELETE FROM "community_moderation_decisions" WHERE ${authoredContentWhere}`,
      contentParams,
    );
    await manager.query(
      `DELETE FROM "community_safety_scan_results" WHERE ${authoredContentWhere}`,
      contentParams,
    );
    await manager.query(
      `DELETE FROM "community_helpfulness_votes" WHERE ${authoredContentWhere}`,
      contentParams,
    );
    await manager.query(
      `DELETE FROM "community_outcome_signal_votes" WHERE ${authoredContentWhere}`,
      contentParams,
    );
    await manager.query(
      `
        DELETE FROM "community_routine_adaptations"
        WHERE "routine_id" IN (
          SELECT "id" FROM "${COMMUNITY_ROUTINES_TABLE}" WHERE "author_user_id" = $1
        )
      `,
      [userId],
    );
    await manager.delete(COMMUNITY_ROUTINES_TABLE, { author_user_id: userId });
    await manager.delete(COMMUNITY_REVIEWS_TABLE, { author_user_id: userId });
  }

  private async removeUserCommunitySignalsForAccountDeletion(
    manager: EntityManager,
    userId: string,
  ): Promise<void> {
    const helpfulnessReferences = await this.queryRawRows(
      manager,
      `
        DELETE FROM "community_helpfulness_votes"
        WHERE "user_id" = $1
        RETURNING "content_type", "content_id"
      `,
      [userId],
      isCommunityContentReference,
    );
    await this.recountCommunityHelpfulness(manager, helpfulnessReferences);

    const outcomeReferences = await this.queryRawRows(
      manager,
      `
        DELETE FROM "community_outcome_signal_votes"
        WHERE "user_id" = $1
        RETURNING "content_type", "content_id"
      `,
      [userId],
      isCommunityContentReference,
    );
    await this.recountCommunityOutcomeSignals(manager, outcomeReferences);
  }

  private async recountCommunityHelpfulness(
    manager: EntityManager,
    references: CommunityContentReference[],
  ): Promise<void> {
    for (const reference of this.uniqueCommunityContentReferences(references)) {
      const rows = await this.queryRawRows(
        manager,
        `
          SELECT "vote", COUNT(*)::int AS "count"
          FROM "community_helpfulness_votes"
          WHERE "content_type" = $1 AND "content_id" = $2
          GROUP BY "vote"
        `,
        [reference.content_type, reference.content_id],
        isCommunityHelpfulnessCountRow,
      );
      const helpfulCount = this.communityVoteCount(
        rows,
        CommunityHelpfulnessVote.Helpful,
      );
      const notHelpfulCount = this.communityVoteCount(
        rows,
        CommunityHelpfulnessVote.NotHelpful,
      );

      await manager.query(
        `
          UPDATE "${this.communityContentTable(reference.content_type)}"
          SET "helpful_count" = $1, "not_helpful_count" = $2
          WHERE "id" = $3
        `,
        [helpfulCount, notHelpfulCount, reference.content_id],
      );
    }
  }

  private async recountCommunityOutcomeSignals(
    manager: EntityManager,
    references: CommunityContentReference[],
  ): Promise<void> {
    for (const reference of this.uniqueCommunityContentReferences(references)) {
      const rows = await this.queryRawRows(
        manager,
        `
          SELECT "signal", COUNT(*)::int AS "count"
          FROM "community_outcome_signal_votes"
          WHERE "content_type" = $1
            AND "content_id" = $2
            AND "note_moderation_status" = 'published'
            AND "withdrawn_at" IS NULL
          GROUP BY "signal"
        `,
        [reference.content_type, reference.content_id],
        isCommunityOutcomeSignalCountRow,
      );
      const counts = this.emptyCommunityOutcomeSignalCounts();
      rows.forEach((row) => {
        counts[row.signal] = Number(row.count);
      });

      await manager.query(
        `
          UPDATE "${this.communityContentTable(reference.content_type)}"
          SET "outcome_signal_counts" = $1::jsonb
          WHERE "id" = $2
        `,
        [JSON.stringify(counts), reference.content_id],
      );
    }
  }

  private async queryRawRows<Row>(
    manager: EntityManager,
    query: string,
    parameters: unknown[],
    isRow: (value: unknown) => value is Row,
  ): Promise<Row[]> {
    const rawRows: unknown = await manager.query(query, parameters);
    const rows: unknown[] = Array.isArray(rawRows) ? rawRows : [];

    return rows.filter(isRow);
  }

  private communityVoteCount(
    rows: CommunityHelpfulnessCountRow[],
    vote: CommunityHelpfulnessVote,
  ): number {
    return Number(rows.find((row) => row.vote === vote)?.count ?? 0);
  }

  private emptyCommunityOutcomeSignalCounts(): Record<
    CommunityOutcomeSignal,
    number
  > {
    return {
      [CommunityOutcomeSignal.WorkedForMeToo]: 0,
      [CommunityOutcomeSignal.WorkedWithChanges]: 0,
      [CommunityOutcomeSignal.MixedResult]: 0,
      [CommunityOutcomeSignal.DidNotWork]: 0,
      [CommunityOutcomeSignal.CausedIrritation]: 0,
      [CommunityOutcomeSignal.NotRelevant]: 0,
    };
  }

  private uniqueCommunityContentReferences(
    references: CommunityContentReference[],
  ): CommunityContentReference[] {
    return Array.from(
      new Map(
        references.map((reference) => [
          `${reference.content_type}:${reference.content_id}`,
          reference,
        ]),
      ).values(),
    );
  }

  private communityContentTable(contentType: CommunityContentType): string {
    return contentType === CommunityContentType.Routine
      ? COMMUNITY_ROUTINES_TABLE
      : COMMUNITY_REVIEWS_TABLE;
  }

  private findForAuth({
    clause,
    params,
  }: AuthUserLookup): Promise<User | null> {
    return this.usersRepository
      .createQueryBuilder('user')
      .addSelect([
        'user.password_hash',
        'user.account_deletion_confirm_token_hash',
      ])
      .where(clause, params)
      .getOne();
  }

  private saveUserPatch(user: User, data: Partial<User>): Promise<User> {
    Object.assign(user, data);
    return this.usersRepository.save(user);
  }

  private async saveCreatedUser(user: User): Promise<User> {
    try {
      return await this.usersRepository.save(user);
    } catch (error: unknown) {
      if (isEmailIdentityUniqueViolation(error)) {
        throw new ConflictException(EMAIL_IN_USE_MESSAGE);
      }

      throw error;
    }
  }
}

function isEmailIdentityUniqueViolation(error: unknown): boolean {
  if (!isDatabaseError(error)) {
    return false;
  }

  return (
    error.code === POSTGRES_UNIQUE_VIOLATION_CODE &&
    typeof error.constraint === 'string' &&
    EMAIL_IDENTITY_UNIQUE_CONSTRAINTS.has(error.constraint)
  );
}

function isDatabaseError(error: unknown): error is DatabaseError {
  return typeof error === 'object' && error !== null;
}

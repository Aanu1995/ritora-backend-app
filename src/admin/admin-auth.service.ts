import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { compare, hash } from 'bcrypt';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { Response } from 'express';
import type { SignOptions } from 'jsonwebtoken';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { ulid } from 'ulid';
import { type AppLanguage } from '../common/i18n/i18n';
import {
  expiresFromDuration,
  isAfterNow,
  isBeforeNow,
  nowDate,
  toIsoString,
  toNullableIsoString,
} from '../common/utils/date';
import { MAIL_PROVIDER_LABEL } from '../mail/mail.constants';
import { MailService } from '../mail/mail.service';
import {
  maskIpAddress,
  sanitizeIpAddress,
  sanitizeUserAgent,
} from '../auth/auth-session.utils';
import {
  AdminAccount,
  AdminAccountRole,
  AdminAccountStatus,
} from './entities/admin-account.entity';
import {
  AdminAuditAction,
  AdminAuditLog,
} from './entities/admin-audit-log.entity';
import { AdminSession } from './entities/admin-session.entity';
import {
  buildTotpUri,
  formatTotpSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  verifyTotpCode,
} from './admin-totp';
import {
  AdminPermission,
  type AdminAuthenticatedUser,
  type AdminLoginResponse,
  type AdminListQuery,
  type AdminMfaEnableResponse,
  type AdminMfaSetupResponse,
  type AdminMfaStatusResponse,
  type AdminMemberListResponse,
  type AdminMemberResponse,
  type AdminSessionResponse,
} from './admin.types';
import { buildPaginationMeta, normalizePagination } from './admin-pagination';

type CreateAdminInput = {
  email: string;
  name: string;
  reason: string;
};

type AdminActor = Pick<AdminAccount, 'id' | 'name' | 'role'>;

type AdminAuditContext = {
  ip?: string;
  reason: string;
  sessionId: string;
  userAgent?: string;
};

type AdminLogoutContext = {
  ip?: string;
  userAgent?: string;
};

type AdminSecurityContext = {
  ip?: string;
  sessionId: string;
  userAgent?: string;
};

type AdminMutationRepositories = {
  accountsRepository: Repository<AdminAccount>;
  auditLogsRepository: Repository<AdminAuditLog>;
  sessionsRepository: Repository<AdminSession>;
};

type ParsedRefreshToken = {
  sessionId: string;
  secret: string;
};

const ROOT_ADMIN_NAME = 'Root Admin';
const ADMIN_TOKEN_TYPE = 'admin';
const ADMIN_LIST_DEFAULT_LIMIT = 50;
const ADMIN_LIST_MAX_LIMIT = 100;
const ADMIN_LIST_SEARCH_MAX_LENGTH = 100;
const ADMIN_LIST_SELECT_COLUMNS = [
  'admin.id',
  'admin.email',
  'admin.canonical_email',
  'admin.name',
  'admin.role',
  'admin.status',
  'admin.created_by_admin_id',
  'admin.accepted_at',
  'admin.last_login_at',
  'admin.mfa_enabled_at',
  'admin.created_at',
  'admin.updated_at',
] as const;
const ADMIN_ACCOUNT_AUTH_SELECT_COLUMNS = [
  'id',
  'email',
  'canonical_email',
  'name',
  'role',
  'status',
  'password_hash',
  'invitation_token_hash',
  'invitation_expires_at',
  'password_reset_token_hash',
  'password_reset_expires',
  'mfa_totp_secret',
  'mfa_pending_totp_secret',
  'mfa_pending_expires_at',
  'mfa_enabled_at',
  'mfa_last_used_time_step',
  'mfa_recovery_code_hashes',
  'created_by_admin_id',
  'accepted_at',
  'last_login_at',
  'deleted_at',
  'created_at',
  'updated_at',
] as const;
const ADMIN_MFA_SETUP_EXPIRY_MS = 10 * 60 * 1000;

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function normalizeSearch(value: string | undefined): string | null {
  const search = value
    ?.trim()
    .replace(/\s+/g, ' ')
    .slice(0, ADMIN_LIST_SEARCH_MAX_LENGTH);
  return search && search.length > 0 ? search : null;
}

@Injectable()
export class AdminAuthService implements OnModuleInit {
  private readonly logger = new Logger(AdminAuthService.name);
  private readonly adminCookieRefreshName: string;
  private readonly adminInvitationExpiry: string;
  private readonly adminRootSetupExpiry: string;
  private readonly bcryptRounds: number;
  private readonly cookieDomain: string;
  private readonly cookieSecure: boolean;
  private readonly cookieSameSite: 'lax' | 'strict' | 'none';
  private readonly jwtAccessExpiry: string;
  private readonly jwtAudience: string;
  private readonly jwtIssuer: string;
  private readonly jwtRefreshExpiry: string;
  private readonly passwordResetExpiry: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    @InjectRepository(AdminAccount)
    private readonly accountsRepository: Repository<AdminAccount>,
    @InjectRepository(AdminSession)
    private readonly sessionsRepository: Repository<AdminSession>,
    @InjectRepository(AdminAuditLog)
    private readonly auditLogsRepository: Repository<AdminAuditLog>,
  ) {
    this.adminCookieRefreshName = configService.getOrThrow(
      'ADMIN_COOKIE_REFRESH_NAME',
    );
    this.adminInvitationExpiry = configService.getOrThrow(
      'ADMIN_INVITATION_EXPIRY',
    );
    this.adminRootSetupExpiry = configService.getOrThrow(
      'ADMIN_ROOT_SETUP_EXPIRY',
    );
    this.bcryptRounds = configService.getOrThrow('BCRYPT_SALT_ROUNDS');
    this.cookieDomain = configService.getOrThrow('COOKIE_DOMAIN');
    this.cookieSecure = configService.getOrThrow('COOKIE_SECURE');
    this.cookieSameSite = configService.getOrThrow('COOKIE_SAME_SITE');
    this.jwtAccessExpiry = configService.getOrThrow('JWT_ACCESS_EXPIRY');
    this.jwtAudience = configService.getOrThrow('JWT_AUDIENCE');
    this.jwtIssuer = configService.getOrThrow('JWT_ISSUER');
    this.jwtRefreshExpiry = configService.getOrThrow('JWT_REFRESH_EXPIRY');
    this.passwordResetExpiry = configService.getOrThrow(
      'PASSWORD_RESET_EXPIRY',
    );
  }

  async onModuleInit(): Promise<void> {
    await this.bootstrapRootAdmin();
  }

  async login(
    email: string,
    password: string,
    res: Response,
    ip?: string,
    userAgent?: string,
    mfaCode?: string,
  ): Promise<AdminLoginResponse> {
    const account = await this.findAccountForAuth(email);

    if (
      !account ||
      !account.password_hash ||
      account.status !== AdminAccountStatus.Active ||
      account.deleted_at
    ) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await compare(password, account.password_hash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (this.isMfaEnabled(account) && !mfaCode?.trim()) {
      return { mfaRequired: true };
    }

    account.last_login_at = nowDate();

    const { accessToken, authenticatedAccount } = await this.createSession(
      account,
      res,
      ip,
      userAgent,
      mfaCode,
    );

    return {
      accessToken,
      member: this.toMemberResponse(authenticatedAccount),
    };
  }

  async refreshTokens(
    refreshTokenRaw: string,
    res: Response,
    ip?: string,
    userAgent?: string,
  ): Promise<{ accessToken: string }> {
    const parsed = this.parseRefreshToken(refreshTokenRaw);
    if (!parsed) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const refreshResult = await this.runAdminMutation(
      async ({ accountsRepository, sessionsRepository }) => {
        const session = await sessionsRepository.findOne({
          lock: { mode: 'pessimistic_write' },
          where: { id: parsed.sessionId },
        });

        if (!session || session.revoked_at || isBeforeNow(session.expires_at)) {
          throw new UnauthorizedException('Invalid refresh token');
        }

        const account = await accountsRepository.findOne({
          where: {
            deleted_at: IsNull(),
            id: session.admin_id,
            status: AdminAccountStatus.Active,
          },
        });

        if (!account) {
          throw new UnauthorizedException('Invalid refresh token');
        }

        if (!this.isRefreshSecretValid(session, parsed.secret)) {
          throw new UnauthorizedException('Invalid refresh token');
        }

        const newSecret = randomBytes(32).toString('hex');
        session.refresh_token_hash = this.sha256(newSecret);
        session.last_used_at = nowDate();
        session.ip_address = sanitizeIpAddress(ip) ?? session.ip_address;
        session.user_agent = sanitizeUserAgent(userAgent) ?? session.user_agent;
        await sessionsRepository.save(session);

        return {
          accessToken: this.generateAccessToken(account, session.id),
          refreshToken: `${session.id}.${newSecret}`,
        };
      },
    );

    this.setRefreshCookie(res, refreshResult.refreshToken);

    return {
      accessToken: refreshResult.accessToken,
    };
  }

  async logout(
    refreshTokenRaw: string | undefined,
    res: Response,
    context: AdminLogoutContext = {},
  ): Promise<void> {
    const parsed = this.parseRefreshToken(refreshTokenRaw);

    if (parsed) {
      await this.runAdminMutation(
        async ({ auditLogsRepository, sessionsRepository }) => {
          const session = await sessionsRepository.findOne({
            where: { id: parsed.sessionId },
            relations: ['admin'],
          });

          if (
            !session ||
            session.revoked_at ||
            isBeforeNow(session.expires_at) ||
            !session.admin ||
            session.admin.deleted_at ||
            session.admin.status !== AdminAccountStatus.Active ||
            !this.isRefreshSecretValid(session, parsed.secret)
          ) {
            return;
          }

          session.revoked_at = nowDate();
          await sessionsRepository.save(session);
          await this.writeAdminAuditLog(
            {
              action: AdminAuditAction.AdminLoggedOut,
              actor: session.admin,
              context: {
                ip: context.ip,
                reason: 'Admin signed out',
                sessionId: session.id,
                userAgent: context.userAgent,
              },
              metadata: {
                sessionId: session.id,
              },
              targetAdminId: session.admin.id,
            },
            auditLogsRepository,
          );
        },
      );
    }

    this.clearRefreshCookie(res);
  }

  async forgotPassword(
    email: string,
    language: AppLanguage = 'en',
  ): Promise<void> {
    const account = await this.findAccountForAuth(email);

    if (
      !account ||
      account.deleted_at ||
      account.status !== AdminAccountStatus.Active
    ) {
      return;
    }

    const resetToken = randomBytes(32).toString('hex');
    account.password_reset_token_hash = this.sha256(resetToken);
    account.password_reset_expires = expiresFromDuration(
      this.passwordResetExpiry,
    );
    await this.accountsRepository.save(account);

    await this.sendPasswordResetEmailOrLogFailure(
      account.email,
      resetToken,
      account.name,
      language,
    );
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const tokenHash = this.sha256(token);
    const account = await this.accountsRepository.findOne({
      where: [
        { invitation_token_hash: tokenHash },
        { password_reset_token_hash: tokenHash },
      ],
      select: [
        'id',
        'email',
        'canonical_email',
        'name',
        'role',
        'status',
        'password_hash',
        'invitation_token_hash',
        'invitation_expires_at',
        'password_reset_token_hash',
        'password_reset_expires',
        'created_by_admin_id',
        'accepted_at',
        'last_login_at',
        'deleted_at',
        'created_at',
        'updated_at',
      ],
    });

    if (!account || account.deleted_at) {
      throw new BadRequestException('Invalid reset token');
    }

    const isInvitation =
      account.invitation_token_hash !== null &&
      this.timingSafeCompare(
        Buffer.from(account.invitation_token_hash, 'hex'),
        Buffer.from(tokenHash, 'hex'),
      );
    const isPasswordReset =
      account.password_reset_token_hash !== null &&
      this.timingSafeCompare(
        Buffer.from(account.password_reset_token_hash, 'hex'),
        Buffer.from(tokenHash, 'hex'),
      );

    if (
      (isInvitation && account.status !== AdminAccountStatus.Invited) ||
      (isPasswordReset && account.status !== AdminAccountStatus.Active) ||
      (!isInvitation && !isPasswordReset)
    ) {
      throw new BadRequestException('Invalid reset token');
    }

    const expiresAt = isInvitation
      ? account.invitation_expires_at
      : account.password_reset_expires;

    if (!expiresAt || isBeforeNow(expiresAt)) {
      throw new BadRequestException('Reset token has expired');
    }

    account.password_hash = await hash(newPassword, this.bcryptRounds);
    account.status = AdminAccountStatus.Active;
    account.accepted_at = account.accepted_at ?? nowDate();
    account.invitation_token_hash = null;
    account.invitation_expires_at = null;
    account.password_reset_token_hash = null;
    account.password_reset_expires = null;
    await this.accountsRepository.save(account);
    await this.revokeAllSessions(account.id);
  }

  async listAdmins(
    currentAdmin: AdminActor,
    query: AdminListQuery = {},
  ): Promise<AdminMemberListResponse> {
    this.assertRoot(currentAdmin);
    const pagination = normalizePagination({
      defaultLimit: ADMIN_LIST_DEFAULT_LIMIT,
      limit: query.limit,
      maxLimit: ADMIN_LIST_MAX_LIMIT,
      page: query.page,
    });
    const search = normalizeSearch(query.query);

    const builder = this.accountsRepository
      .createQueryBuilder('admin')
      .select([...ADMIN_LIST_SELECT_COLUMNS])
      .where('admin.deleted_at IS NULL')
      .orderBy('admin.created_at', 'ASC')
      .addOrderBy('admin.id', 'ASC')
      .skip(pagination.offset)
      .take(pagination.limit);

    if (search) {
      builder.andWhere(
        `(
          admin.canonical_email ILIKE :search ESCAPE '\\'
          OR admin.name ILIKE :search ESCAPE '\\'
        )`,
        { search: `%${escapeLikePattern(search)}%` },
      );
    }

    const [accounts, total] = await builder.getManyAndCount();

    return {
      admins: accounts.map((account) => this.toMemberResponse(account)),
      ...buildPaginationMeta(total, pagination),
    };
  }

  async listSessions(
    currentAdmin: AdminAuthenticatedUser,
  ): Promise<AdminSessionResponse[]> {
    const session = await this.sessionsRepository.findOne({
      where: { admin_id: currentAdmin.id, revoked_at: IsNull() },
      order: { last_used_at: 'DESC' },
    });

    if (!session || !isAfterNow(session.expires_at)) {
      return [];
    }

    return [this.toSessionResponse(session, currentAdmin.sessionId)];
  }

  async getMfaStatus(
    currentAdmin: AdminAuthenticatedUser,
  ): Promise<AdminMfaStatusResponse> {
    const account = await this.accountsRepository.findOne({
      select: [...ADMIN_ACCOUNT_AUTH_SELECT_COLUMNS],
      where: {
        deleted_at: IsNull(),
        id: currentAdmin.id,
        status: AdminAccountStatus.Active,
      },
    });

    if (!account) {
      throw new UnauthorizedException();
    }

    return this.toMfaStatusResponse(account);
  }

  async startMfaSetup(
    currentAdmin: AdminAuthenticatedUser,
    currentPassword: string,
  ): Promise<AdminMfaSetupResponse> {
    const secret = generateTotpSecret();
    const expiresAt = new Date(nowDate().getTime() + ADMIN_MFA_SETUP_EXPIRY_MS);

    const account = await this.runAdminMutation(
      async ({ accountsRepository }) => {
        const lockedAccount = await accountsRepository.findOne({
          lock: { mode: 'pessimistic_write' },
          select: [...ADMIN_ACCOUNT_AUTH_SELECT_COLUMNS],
          where: {
            deleted_at: IsNull(),
            id: currentAdmin.id,
            status: AdminAccountStatus.Active,
          },
        });

        if (!lockedAccount) {
          throw new UnauthorizedException();
        }

        await this.assertCurrentPassword(lockedAccount, currentPassword);

        if (this.isMfaEnabled(lockedAccount)) {
          throw new ConflictException('MFA is already enabled');
        }

        lockedAccount.mfa_pending_totp_secret = secret;
        lockedAccount.mfa_pending_expires_at = expiresAt;
        await accountsRepository.save(lockedAccount);
        return lockedAccount;
      },
    );

    return {
      expiresAt: toIsoString(expiresAt),
      manualEntryKey: formatTotpSecret(secret),
      otpauthUri: buildTotpUri({ email: account.email, secret }),
      secret,
    };
  }

  async enableMfa(
    currentAdmin: AdminAuthenticatedUser,
    code: string,
    context: AdminSecurityContext,
  ): Promise<AdminMfaEnableResponse> {
    const recoveryCodes = generateRecoveryCodes();

    const account = await this.runAdminMutation(
      async ({ accountsRepository, auditLogsRepository }) => {
        const lockedAccount = await accountsRepository.findOne({
          lock: { mode: 'pessimistic_write' },
          select: [...ADMIN_ACCOUNT_AUTH_SELECT_COLUMNS],
          where: {
            deleted_at: IsNull(),
            id: currentAdmin.id,
            status: AdminAccountStatus.Active,
          },
        });

        if (!lockedAccount) {
          throw new UnauthorizedException();
        }
        if (this.isMfaEnabled(lockedAccount)) {
          throw new ConflictException('MFA is already enabled');
        }
        if (
          !lockedAccount.mfa_pending_totp_secret ||
          !lockedAccount.mfa_pending_expires_at ||
          isBeforeNow(lockedAccount.mfa_pending_expires_at)
        ) {
          throw new BadRequestException('MFA setup has expired');
        }

        const verification = verifyTotpCode(
          lockedAccount.mfa_pending_totp_secret,
          code,
        );
        if (!verification) {
          throw new UnauthorizedException('Invalid MFA code');
        }

        lockedAccount.mfa_totp_secret = lockedAccount.mfa_pending_totp_secret;
        lockedAccount.mfa_enabled_at = nowDate();
        lockedAccount.mfa_last_used_time_step = String(verification.timeStep);
        lockedAccount.mfa_recovery_code_hashes = recoveryCodes.map((value) =>
          this.sha256(normalizeRecoveryCode(value)),
        );
        lockedAccount.mfa_pending_totp_secret = null;
        lockedAccount.mfa_pending_expires_at = null;
        await accountsRepository.save(lockedAccount);

        await this.writeAdminAuditLog(
          {
            action: AdminAuditAction.AdminMfaEnabled,
            actor: currentAdmin,
            context: {
              ip: context.ip,
              reason: 'Admin enabled multi-factor authentication',
              sessionId: context.sessionId,
              userAgent: context.userAgent,
            },
            metadata: {
              recoveryCodesIssued: recoveryCodes.length,
            },
            targetAdminId: currentAdmin.id,
          },
          auditLogsRepository,
        );

        return lockedAccount;
      },
    );

    return {
      ...this.toMfaStatusResponse(account),
      recoveryCodes,
    };
  }

  async disableMfa(
    currentAdmin: AdminAuthenticatedUser,
    currentPassword: string,
    code: string,
    context: AdminSecurityContext,
  ): Promise<AdminMfaStatusResponse> {
    const account = await this.runAdminMutation(
      async ({ accountsRepository, auditLogsRepository }) => {
        const lockedAccount = await accountsRepository.findOne({
          lock: { mode: 'pessimistic_write' },
          select: [...ADMIN_ACCOUNT_AUTH_SELECT_COLUMNS],
          where: {
            deleted_at: IsNull(),
            id: currentAdmin.id,
            status: AdminAccountStatus.Active,
          },
        });

        if (!lockedAccount) {
          throw new UnauthorizedException();
        }

        await this.assertCurrentPassword(lockedAccount, currentPassword);

        if (!this.isMfaEnabled(lockedAccount)) {
          return lockedAccount;
        }

        await this.verifyAndApplyMfaCode(lockedAccount, code, {
          auditLogsRepository,
          ip: context.ip,
          sessionId: currentAdmin.sessionId,
          userAgent: context.userAgent,
        });

        lockedAccount.mfa_totp_secret = null;
        lockedAccount.mfa_enabled_at = null;
        lockedAccount.mfa_last_used_time_step = null;
        lockedAccount.mfa_recovery_code_hashes = null;
        lockedAccount.mfa_pending_totp_secret = null;
        lockedAccount.mfa_pending_expires_at = null;
        await accountsRepository.save(lockedAccount);

        await this.writeAdminAuditLog(
          {
            action: AdminAuditAction.AdminMfaDisabled,
            actor: currentAdmin,
            context: {
              ip: context.ip,
              reason: 'Admin disabled multi-factor authentication',
              sessionId: context.sessionId,
              userAgent: context.userAgent,
            },
            metadata: {},
            targetAdminId: currentAdmin.id,
          },
          auditLogsRepository,
        );

        return lockedAccount;
      },
    );

    return this.toMfaStatusResponse(account);
  }

  async regenerateMfaRecoveryCodes(
    currentAdmin: AdminAuthenticatedUser,
    currentPassword: string,
    code: string,
    context: AdminSecurityContext,
  ): Promise<AdminMfaEnableResponse> {
    const recoveryCodes = generateRecoveryCodes();

    const account = await this.runAdminMutation(
      async ({ accountsRepository, auditLogsRepository }) => {
        const lockedAccount = await accountsRepository.findOne({
          lock: { mode: 'pessimistic_write' },
          select: [...ADMIN_ACCOUNT_AUTH_SELECT_COLUMNS],
          where: {
            deleted_at: IsNull(),
            id: currentAdmin.id,
            status: AdminAccountStatus.Active,
          },
        });

        if (!lockedAccount || !this.isMfaEnabled(lockedAccount)) {
          throw new BadRequestException('MFA is not enabled');
        }

        await this.assertCurrentPassword(lockedAccount, currentPassword);
        await this.verifyAndApplyMfaCode(lockedAccount, code, {
          auditLogsRepository,
          ip: context.ip,
          sessionId: currentAdmin.sessionId,
          userAgent: context.userAgent,
        });

        lockedAccount.mfa_recovery_code_hashes = recoveryCodes.map((value) =>
          this.sha256(normalizeRecoveryCode(value)),
        );
        await accountsRepository.save(lockedAccount);

        await this.writeAdminAuditLog(
          {
            action: AdminAuditAction.AdminMfaRecoveryCodesRotated,
            actor: currentAdmin,
            context: {
              ip: context.ip,
              reason: 'Admin regenerated MFA recovery codes',
              sessionId: context.sessionId,
              userAgent: context.userAgent,
            },
            metadata: {
              recoveryCodesIssued: recoveryCodes.length,
            },
            targetAdminId: currentAdmin.id,
          },
          auditLogsRepository,
        );

        return lockedAccount;
      },
    );

    return {
      ...this.toMfaStatusResponse(account),
      recoveryCodes,
    };
  }

  async createAdmin(
    currentAdmin: AdminActor,
    input: CreateAdminInput,
    context: AdminAuditContext,
    language: AppLanguage = 'en',
  ): Promise<AdminMemberResponse> {
    this.assertRoot(currentAdmin);
    const reason = this.normalizeAuditReason(context.reason);
    const canonicalEmail = this.canonicalizeEmail(input.email);
    const adminName = this.normalizeAdminName(input.name);
    const invitationToken = randomBytes(32).toString('hex');

    const saved = await this.runAdminMutation(
      async ({ accountsRepository, auditLogsRepository }) => {
        const existing = await accountsRepository.findOne({
          where: { canonical_email: canonicalEmail, deleted_at: IsNull() },
          select: [
            'id',
            'email',
            'canonical_email',
            'name',
            'role',
            'status',
            'password_hash',
            'deleted_at',
          ],
        });

        if (existing) {
          throw new ConflictException('Admin account already exists');
        }

        const account = accountsRepository.create({
          accepted_at: null,
          canonical_email: canonicalEmail,
          created_by_admin_id: currentAdmin.id,
          deleted_at: null,
          email: input.email.trim(),
          invitation_expires_at: expiresFromDuration(
            this.adminInvitationExpiry,
          ),
          invitation_token_hash: this.sha256(invitationToken),
          last_login_at: null,
          name: adminName,
          password_hash: null,
          password_reset_expires: null,
          password_reset_token_hash: null,
          role: AdminAccountRole.Admin,
          status: AdminAccountStatus.Invited,
        });
        const savedAccount = await accountsRepository.save(account);

        await this.writeAdminAuditLog(
          {
            action: AdminAuditAction.AdminInvited,
            actor: currentAdmin,
            context: { ...context, reason },
            metadata: {
              targetEmail: savedAccount.email,
              targetRole: savedAccount.role,
              targetStatus: savedAccount.status,
            },
            targetAdminId: savedAccount.id,
          },
          auditLogsRepository,
        );

        return savedAccount;
      },
    );

    await this.sendInvitationEmailOrLogFailure(
      saved.email,
      invitationToken,
      currentAdmin.name,
      language,
    );

    return this.toMemberResponse(saved);
  }

  async resendAdminInvitation(
    currentAdmin: AdminActor,
    adminId: string,
    context: AdminAuditContext,
    language: AppLanguage = 'en',
  ): Promise<AdminMemberResponse> {
    this.assertRoot(currentAdmin);
    const reason = this.normalizeAuditReason(context.reason);
    const invitationToken = randomBytes(32).toString('hex');

    const saved = await this.runAdminMutation(
      async ({ accountsRepository, auditLogsRepository }) => {
        const account = await accountsRepository.findOne({
          where: { id: adminId, deleted_at: IsNull() },
          select: [
            'id',
            'email',
            'canonical_email',
            'name',
            'role',
            'status',
            'password_hash',
            'invitation_token_hash',
            'invitation_expires_at',
            'password_reset_token_hash',
            'password_reset_expires',
            'created_by_admin_id',
            'accepted_at',
            'last_login_at',
            'deleted_at',
            'created_at',
            'updated_at',
          ],
        });

        if (!account) {
          throw new NotFoundException('Admin account not found');
        }
        if (account.role === AdminAccountRole.Root) {
          throw new ForbiddenException(
            'Root admin invitations cannot be resent',
          );
        }
        if (account.status !== AdminAccountStatus.Invited) {
          throw new BadRequestException(
            'Only invited admin accounts can receive a new invitation',
          );
        }

        account.invitation_token_hash = this.sha256(invitationToken);
        account.invitation_expires_at = expiresFromDuration(
          this.adminInvitationExpiry,
        );
        account.password_reset_token_hash = null;
        account.password_reset_expires = null;
        const savedAccount = await accountsRepository.save(account);

        await this.writeAdminAuditLog(
          {
            action: AdminAuditAction.AdminInvitationResent,
            actor: currentAdmin,
            context: { ...context, reason },
            metadata: {
              targetEmail: savedAccount.email,
              targetRole: savedAccount.role,
              targetStatus: savedAccount.status,
            },
            targetAdminId: savedAccount.id,
          },
          auditLogsRepository,
        );

        return savedAccount;
      },
    );

    await this.sendInvitationEmailOrLogFailure(
      saved.email,
      invitationToken,
      currentAdmin.name,
      language,
    );

    return this.toMemberResponse(saved);
  }

  async deleteAdmin(
    currentAdmin: AdminActor,
    adminId: string,
    context: AdminAuditContext,
  ): Promise<void> {
    this.assertRoot(currentAdmin);
    const reason = this.normalizeAuditReason(context.reason);

    if (currentAdmin.id === adminId) {
      throw new ForbiddenException('Root admin cannot delete itself');
    }

    await this.runAdminMutation(
      async ({
        accountsRepository,
        auditLogsRepository,
        sessionsRepository,
      }) => {
        const account = await accountsRepository.findOne({
          where: { id: adminId, deleted_at: IsNull() },
        });

        if (!account) {
          return;
        }

        if (account.role === AdminAccountRole.Root) {
          throw new ForbiddenException('Root admin accounts cannot be deleted');
        }

        account.deleted_at = nowDate();
        account.status = AdminAccountStatus.Disabled;
        account.invitation_token_hash = null;
        account.invitation_expires_at = null;
        account.password_reset_token_hash = null;
        account.password_reset_expires = null;
        await accountsRepository.save(account);
        await this.revokeAllSessions(account.id, sessionsRepository);
        await this.writeAdminAuditLog(
          {
            action: AdminAuditAction.AdminDeleted,
            actor: currentAdmin,
            context: { ...context, reason },
            metadata: {
              targetEmail: account.email,
              targetRole: account.role,
              targetStatus: account.status,
            },
            targetAdminId: account.id,
          },
          auditLogsRepository,
        );
      },
    );
  }

  async findActiveAccountById(id: string): Promise<AdminAccount | null> {
    return this.accountsRepository.findOne({
      where: {
        id,
        deleted_at: IsNull(),
        status: AdminAccountStatus.Active,
      },
    });
  }

  private async bootstrapRootAdmin(): Promise<void> {
    const rootEmail = this.configService.get<string>('ADMIN_ROOT_EMAIL') ?? '';
    const canonicalEmail = this.canonicalizeEmail(rootEmail);

    if (!canonicalEmail) {
      throw new Error('ADMIN_ROOT_EMAIL is required');
    }

    const existing = await this.accountsRepository.findOne({
      where: { canonical_email: canonicalEmail },
      select: [...ADMIN_ACCOUNT_AUTH_SELECT_COLUMNS],
    });

    if (
      existing?.password_hash &&
      existing.status === AdminAccountStatus.Active &&
      !existing.deleted_at
    ) {
      existing.email = rootEmail.trim();
      existing.canonical_email = canonicalEmail;
      existing.name = existing.name || ROOT_ADMIN_NAME;
      existing.role = AdminAccountRole.Root;
      existing.invitation_token_hash = null;
      existing.invitation_expires_at = null;
      existing.password_reset_token_hash = null;
      existing.password_reset_expires = null;
      await this.accountsRepository.save(existing);
      return;
    }

    const rootSetupTokenHash = this.resolveRootSetupTokenHash();
    if (!rootSetupTokenHash) {
      throw new Error(
        'ADMIN_ROOT_SETUP_TOKEN_HASH is required until the root admin password has been set',
      );
    }

    const rootAccount =
      existing ??
      this.accountsRepository.create({
        accepted_at: null,
        canonical_email: canonicalEmail,
        created_by_admin_id: null,
        deleted_at: null,
        email: rootEmail.trim(),
        invitation_expires_at: expiresFromDuration(this.adminRootSetupExpiry),
        invitation_token_hash: rootSetupTokenHash,
        last_login_at: null,
        name: ROOT_ADMIN_NAME,
        password_reset_expires: null,
        password_reset_token_hash: null,
      });

    rootAccount.email = rootEmail.trim();
    rootAccount.canonical_email = canonicalEmail;
    rootAccount.name = rootAccount.name || ROOT_ADMIN_NAME;
    rootAccount.role = AdminAccountRole.Root;
    rootAccount.status = AdminAccountStatus.Invited;
    rootAccount.password_hash = null;
    rootAccount.deleted_at = null;
    const hasSameSetupToken =
      rootAccount.invitation_token_hash === rootSetupTokenHash;
    rootAccount.invitation_token_hash = rootSetupTokenHash;
    rootAccount.invitation_expires_at =
      hasSameSetupToken && rootAccount.invitation_expires_at
        ? rootAccount.invitation_expires_at
        : expiresFromDuration(this.adminRootSetupExpiry);
    rootAccount.password_reset_token_hash = null;
    rootAccount.password_reset_expires = null;
    rootAccount.accepted_at = null;

    await this.accountsRepository.save(rootAccount);
  }

  private resolveRootSetupTokenHash(): string | null {
    const configuredHash =
      this.configService.get<string>('ADMIN_ROOT_SETUP_TOKEN_HASH')?.trim() ??
      '';

    return configuredHash ? configuredHash.toLowerCase() : null;
  }

  private async findAccountForAuth(
    email: string,
  ): Promise<AdminAccount | null> {
    return this.accountsRepository.findOne({
      where: { canonical_email: this.canonicalizeEmail(email) },
      select: [...ADMIN_ACCOUNT_AUTH_SELECT_COLUMNS],
    });
  }

  private async createSession(
    account: AdminAccount,
    res: Response,
    ip?: string,
    userAgent?: string,
    mfaCode?: string,
  ): Promise<{ accessToken: string; authenticatedAccount: AdminAccount }> {
    const sessionId = ulid();
    const secret = randomBytes(32).toString('hex');
    const refreshToken = `${sessionId}.${secret}`;

    const sessionResult = await this.accountsRepository.manager.transaction(
      async (
        manager,
      ): Promise<{
        accessToken: string;
        authenticatedAccount: AdminAccount;
      }> => {
        const accountsRepository = manager.getRepository(AdminAccount);
        const sessionsRepository = manager.getRepository(AdminSession);
        const activeAccount = await accountsRepository.findOne({
          lock: { mode: 'pessimistic_write' },
          select: [...ADMIN_ACCOUNT_AUTH_SELECT_COLUMNS],
          where: {
            deleted_at: IsNull(),
            id: account.id,
            status: AdminAccountStatus.Active,
          },
        });

        if (!activeAccount) {
          throw new UnauthorizedException('Invalid credentials');
        }

        activeAccount.last_login_at = account.last_login_at;
        if (this.isMfaEnabled(activeAccount)) {
          if (!mfaCode) {
            throw new UnauthorizedException('MFA code required');
          }
          await this.verifyAndApplyMfaCode(activeAccount, mfaCode, {
            auditLogsRepository: manager.getRepository(AdminAuditLog),
            ip,
            sessionId,
            userAgent,
          });
        }
        await accountsRepository.save(activeAccount);
        await sessionsRepository.update(
          { admin_id: account.id, revoked_at: IsNull() },
          { revoked_at: nowDate() },
        );

        const session = sessionsRepository.create({
          admin_id: account.id,
          expires_at: expiresFromDuration(this.jwtRefreshExpiry),
          id: sessionId,
          ip_address: sanitizeIpAddress(ip),
          last_used_at: nowDate(),
          refresh_token_hash: this.sha256(secret),
          revoked_at: null,
          user_agent: sanitizeUserAgent(userAgent),
        });

        await sessionsRepository.save(session);

        return {
          accessToken: this.generateAccessToken(activeAccount, sessionId),
          authenticatedAccount: activeAccount,
        };
      },
    );

    this.setRefreshCookie(res, refreshToken);

    return sessionResult;
  }

  private generateAccessToken(
    account: AdminAccount,
    sessionId: string,
  ): string {
    const expiresIn = this.jwtAccessExpiry as SignOptions['expiresIn'];

    return this.jwtService.sign(
      {
        email: account.email,
        sid: sessionId,
        sub: account.id,
        typ: ADMIN_TOKEN_TYPE,
      },
      {
        audience: this.jwtAudience,
        expiresIn,
        issuer: this.jwtIssuer,
      },
    );
  }

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(this.adminCookieRefreshName, token, {
      domain: this.cookieDomain || undefined,
      httpOnly: true,
      maxAge: this.parseExpiryMs(this.jwtRefreshExpiry),
      path: '/api/v1/admin/auth',
      sameSite: this.cookieSameSite,
      secure: this.cookieSecure,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(this.adminCookieRefreshName, {
      domain: this.cookieDomain || undefined,
      path: '/api/v1/admin/auth',
      sameSite: this.cookieSameSite,
      secure: this.cookieSecure,
    });
  }

  private async revokeAllSessions(
    adminId: string,
    sessionsRepository = this.sessionsRepository,
  ): Promise<void> {
    await sessionsRepository.update(
      { admin_id: adminId, revoked_at: IsNull() },
      { revoked_at: nowDate() },
    );
  }

  private toMfaStatusResponse(account: AdminAccount): AdminMfaStatusResponse {
    const recoveryCodesRemaining =
      account.mfa_recovery_code_hashes?.length ?? 0;

    return {
      enabled: this.isMfaEnabled(account),
      enabledAt: toNullableIsoString(account.mfa_enabled_at),
      pendingSetupExpiresAt: toNullableIsoString(
        account.mfa_pending_expires_at,
      ),
      recoveryCodesRemaining,
    };
  }

  private isMfaEnabled(account: AdminAccount): boolean {
    return Boolean(account.mfa_enabled_at);
  }

  private async assertCurrentPassword(
    account: AdminAccount,
    currentPassword: string,
  ): Promise<void> {
    if (!account.password_hash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await compare(currentPassword, account.password_hash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }
  }

  private async verifyAndApplyMfaCode(
    account: AdminAccount,
    code: string,
    context: {
      auditLogsRepository: Repository<AdminAuditLog>;
      ip?: string;
      sessionId: string;
      userAgent?: string;
    },
  ): Promise<void> {
    if (!this.isMfaEnabled(account) || !account.mfa_totp_secret) {
      throw new UnauthorizedException('Invalid MFA code');
    }

    const totpVerification = verifyTotpCode(account.mfa_totp_secret, code);
    const lastUsedTimeStep = Number(account.mfa_last_used_time_step ?? -1);

    if (
      totpVerification &&
      Number.isFinite(lastUsedTimeStep) &&
      totpVerification.timeStep > lastUsedTimeStep
    ) {
      account.mfa_last_used_time_step = String(totpVerification.timeStep);
      return;
    }

    const recoveryCodeUsed = await this.consumeRecoveryCode(
      account,
      code,
      context,
    );
    if (recoveryCodeUsed) {
      return;
    }

    throw new UnauthorizedException('Invalid MFA code');
  }

  private async consumeRecoveryCode(
    account: AdminAccount,
    code: string,
    context: {
      auditLogsRepository: Repository<AdminAuditLog>;
      ip?: string;
      sessionId: string;
      userAgent?: string;
    },
  ): Promise<boolean> {
    const recoveryHashes = account.mfa_recovery_code_hashes ?? [];
    if (recoveryHashes.length === 0) {
      return false;
    }

    const normalizedHash = this.sha256(normalizeRecoveryCode(code));
    const matchedIndex = recoveryHashes.findIndex((hashValue) =>
      this.timingSafeCompare(
        Buffer.from(normalizedHash, 'hex'),
        Buffer.from(hashValue, 'hex'),
      ),
    );

    if (matchedIndex === -1) {
      return false;
    }

    account.mfa_recovery_code_hashes = recoveryHashes.filter(
      (_hashValue, index) => index !== matchedIndex,
    );

    await this.writeAdminAuditLog(
      {
        action: AdminAuditAction.AdminMfaRecoveryCodeUsed,
        actor: account,
        context: {
          ip: context.ip,
          reason: 'Admin used an MFA recovery code',
          sessionId: context.sessionId,
          userAgent: context.userAgent,
        },
        metadata: {
          recoveryCodesRemaining: account.mfa_recovery_code_hashes.length,
        },
        targetAdminId: account.id,
      },
      context.auditLogsRepository,
    );

    return true;
  }

  private toSessionResponse(
    session: AdminSession,
    currentSessionId: string,
  ): AdminSessionResponse {
    return {
      createdAt: toIsoString(session.created_at),
      current: session.id === currentSessionId,
      id: session.id,
      ipAddress: maskIpAddress(session.ip_address),
      lastUsedAt: toIsoString(session.last_used_at),
      userAgent: session.user_agent,
    };
  }

  private toMemberResponse(account: AdminAccount): AdminMemberResponse {
    return {
      acceptedAt: toNullableIsoString(account.accepted_at),
      createdAt: toIsoString(account.created_at ?? nowDate()),
      createdByAdminId: account.created_by_admin_id,
      email: account.email,
      id: account.id,
      invitedAt:
        account.status === AdminAccountStatus.Invited
          ? toIsoString(account.created_at ?? nowDate())
          : null,
      lastLoginAt: toNullableIsoString(account.last_login_at),
      mfaEnabled: this.isMfaEnabled(account),
      mfaEnabledAt: toNullableIsoString(account.mfa_enabled_at),
      name: account.name,
      permissions: [
        AdminPermission.MetricsRead,
        AdminPermission.UsersRead,
        AdminPermission.UsersRestrict,
        AdminPermission.JobsWrite,
        AdminPermission.AuditRead,
      ],
      role: account.role,
      roles: [account.role],
      status: account.status,
    };
  }

  private assertRoot(account: AdminActor): void {
    if (account.role !== AdminAccountRole.Root) {
      throw new ForbiddenException('Root admin privileges required');
    }
  }

  private normalizeAdminName(name: string): string {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      throw new BadRequestException(
        'Admin name must contain at least 2 characters',
      );
    }
    if (trimmed.length > 120) {
      throw new BadRequestException('Admin name cannot exceed 120 characters');
    }
    return trimmed;
  }

  private normalizeAuditReason(reason: string): string {
    const trimmed = reason.trim();
    if (!trimmed) {
      throw new BadRequestException('Admin audit reason is required');
    }
    return trimmed;
  }

  private async writeAdminAuditLog(
    input: {
      action: AdminAuditAction;
      actor: AdminActor;
      context: AdminAuditContext;
      metadata: Record<string, unknown>;
      targetAdminId: string | null;
    },
    auditLogsRepository = this.auditLogsRepository,
  ): Promise<void> {
    const auditLog = auditLogsRepository.create({
      action: input.action,
      actor_admin_id: input.actor.id,
      actor_session_id: input.context.sessionId,
      ip_address: sanitizeIpAddress(input.context.ip),
      metadata: input.metadata,
      reason: input.context.reason,
      target_admin_id: input.targetAdminId,
      user_agent: sanitizeUserAgent(input.context.userAgent),
    });

    await auditLogsRepository.save(auditLog);
  }

  private async runAdminMutation<T>(
    operation: (repositories: AdminMutationRepositories) => Promise<T>,
  ): Promise<T> {
    return this.accountsRepository.manager.transaction(async (manager) =>
      operation(this.getTransactionRepositories(manager)),
    );
  }

  private getTransactionRepositories(
    manager: EntityManager,
  ): AdminMutationRepositories {
    return {
      accountsRepository: manager.getRepository(AdminAccount),
      auditLogsRepository: manager.getRepository(AdminAuditLog),
      sessionsRepository: manager.getRepository(AdminSession),
    };
  }

  private parseRefreshToken(
    value: string | undefined,
  ): ParsedRefreshToken | null {
    if (!value) {
      return null;
    }

    const dotIndex = value.indexOf('.');
    if (dotIndex === -1) {
      return null;
    }

    const sessionId = value.substring(0, dotIndex);
    const secret = value.substring(dotIndex + 1);

    return sessionId && secret ? { secret, sessionId } : null;
  }

  private canonicalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private timingSafeCompare(left: Buffer, right: Buffer): boolean {
    if (left.length !== right.length) {
      return false;
    }
    return timingSafeEqual(left, right);
  }

  private isRefreshSecretValid(session: AdminSession, secret: string): boolean {
    const secretHash = this.sha256(secret);
    return this.timingSafeCompare(
      Buffer.from(secretHash, 'hex'),
      Buffer.from(session.refresh_token_hash, 'hex'),
    );
  }

  private async sendInvitationEmailOrLogFailure(
    email: string,
    token: string,
    invitedByName: string,
    language: AppLanguage,
  ): Promise<void> {
    try {
      await this.mailService.sendAdminInvitationEmail(
        email,
        token,
        invitedByName,
        language,
      );
    } catch (error) {
      this.logEmailDeliveryFailure('admin invitation', email, error);
    }
  }

  private async sendPasswordResetEmailOrLogFailure(
    email: string,
    token: string,
    name: string,
    language: AppLanguage,
  ): Promise<void> {
    try {
      await this.mailService.sendAdminPasswordResetEmail(
        email,
        token,
        name,
        language,
      );
    } catch (error) {
      this.logEmailDeliveryFailure('admin password reset', email, error);
    }
  }

  private logEmailDeliveryFailure(
    purpose: string,
    email: string,
    error: unknown,
  ): void {
    const deliveryError =
      error instanceof Error
        ? error
        : new Error('Email delivery failed with a non-Error value');

    this.logger.warn(
      `${MAIL_PROVIDER_LABEL} failed to send ${purpose} email to ${email}: ${deliveryError.message}`,
    );
  }

  private parseExpiryMs(value: string): number {
    const match = value.match(/^(\d+)([smhd])$/);
    if (!match) {
      return 7 * 24 * 60 * 60 * 1000;
    }

    const amount = Number.parseInt(match[1], 10);
    switch (match[2]) {
      case 's':
        return amount * 1000;
      case 'm':
        return amount * 60 * 1000;
      case 'h':
        return amount * 60 * 60 * 1000;
      case 'd':
        return amount * 24 * 60 * 60 * 1000;
      default:
        return 7 * 24 * 60 * 60 * 1000;
    }
  }
}

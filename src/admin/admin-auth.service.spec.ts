import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcrypt';
import { createHash } from 'crypto';
import { Response } from 'express';
import { Repository } from 'typeorm';
import { MailService } from '../mail/mail.service';
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
import { AdminAuthService } from './admin-auth.service';

type RepositoryMock = Record<
  'create' | 'createQueryBuilder' | 'find' | 'findOne' | 'save' | 'update',
  unknown
>;

type AdminAccountsQueryBuilderMock = {
  addOrderBy: jest.Mock<AdminAccountsQueryBuilderMock>;
  andWhere: jest.Mock<AdminAccountsQueryBuilderMock>;
  getManyAndCount: jest.Mock<Promise<[AdminAccount[], number]>>;
  orderBy: jest.Mock<AdminAccountsQueryBuilderMock>;
  select: jest.Mock<AdminAccountsQueryBuilderMock>;
  skip: jest.Mock<AdminAccountsQueryBuilderMock>;
  take: jest.Mock<AdminAccountsQueryBuilderMock>;
  where: jest.Mock<AdminAccountsQueryBuilderMock>;
};

const TEST_REFRESH_EXPIRY = '7d';
const TEST_ROOT_SETUP_TOKEN = 'a'.repeat(64);

function sha256ForTest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function createConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    ADMIN_COOKIE_REFRESH_NAME: 'ritora_admin_refresh',
    ADMIN_INVITATION_EXPIRY: '7d',
    ADMIN_ROOT_EMAIL: 'owner@ritora.app',
    ADMIN_ROOT_SETUP_EXPIRY: '24h',
    ADMIN_ROOT_SETUP_TOKEN_HASH: sha256ForTest(TEST_ROOT_SETUP_TOKEN),
    BCRYPT_SALT_ROUNDS: 4,
    COOKIE_DOMAIN: '',
    COOKIE_REFRESH_NAME: 'ritora_refresh',
    COOKIE_SAME_SITE: 'lax',
    COOKIE_SECURE: false,
    JWT_ACCESS_EXPIRY: '15m',
    JWT_AUDIENCE: 'ritora-web',
    JWT_ISSUER: 'ritora',
    JWT_REFRESH_EXPIRY: TEST_REFRESH_EXPIRY,
    NODE_ENV: 'test',
    PASSWORD_RESET_EXPIRY: '1h',
    ...overrides,
  };

  return {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => {
      const value = values[key];
      if (value === undefined) {
        throw new Error(`Missing config ${key}`);
      }
      return value;
    }),
  } as unknown as ConfigService;
}

function createResponse(): Response {
  return {
    clearCookie: jest.fn(),
    cookie: jest.fn(),
  } as unknown as Response;
}

function createAdminAccount(
  overrides: Partial<AdminAccount> = {},
): AdminAccount {
  return {
    accepted_at: null,
    canonical_email: 'owner@ritora.app',
    created_at: new Date('2026-05-20T10:00:00.000Z'),
    created_by_admin: null,
    created_by_admin_id: null,
    deleted_at: null,
    email: 'owner@ritora.app',
    generateId: jest.fn(),
    id: 'admin-root',
    invitation_expires_at: null,
    invitation_token_hash: null,
    last_login_at: null,
    name: 'Root Admin',
    password_hash:
      '$2b$04$abcdefghijklmnopqrstuu5WQz2If0sFxniq3JeiJdCzR4G9LQpQq',
    password_reset_expires: null,
    password_reset_token_hash: null,
    role: AdminAccountRole.Root,
    sessions: [],
    status: AdminAccountStatus.Active,
    updated_at: new Date('2026-05-20T10:00:00.000Z'),
    ...overrides,
  };
}

function createAdminAccountsQueryBuilderMock(
  accounts: AdminAccount[],
  total = accounts.length,
): AdminAccountsQueryBuilderMock {
  const builder: AdminAccountsQueryBuilderMock = {
    addOrderBy: jest.fn(() => builder),
    andWhere: jest.fn(() => builder),
    getManyAndCount: jest.fn(
      async (): Promise<[AdminAccount[], number]> => [accounts, total],
    ),
    orderBy: jest.fn(() => builder),
    select: jest.fn(() => builder),
    skip: jest.fn(() => builder),
    take: jest.fn(() => builder),
    where: jest.fn(() => builder),
  };

  return builder;
}

function createService(
  options: {
    accountsRepository?: Partial<RepositoryMock>;
    auditLogsRepository?: Partial<RepositoryMock>;
    sessionsRepository?: Partial<RepositoryMock>;
    configService?: ConfigService;
    jwtService?: Partial<JwtService>;
    mailService?: Partial<MailService>;
  } = {},
): AdminAuthService {
  const accountsRepository = {
    create: jest.fn((value: Partial<AdminAccount>) => value as AdminAccount),
    createQueryBuilder: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(async (value: AdminAccount) => value),
    update: jest.fn(),
    ...options.accountsRepository,
  } as unknown as Repository<AdminAccount>;
  const sessionsRepository = {
    create: jest.fn((value: Partial<AdminSession>) => value as AdminSession),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(async (value: AdminSession) => value),
    update: jest.fn(),
    ...options.sessionsRepository,
  } as unknown as Repository<AdminSession>;
  const auditLogsRepository = {
    create: jest.fn((value: Partial<AdminAuditLog>) => value as AdminAuditLog),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(async (value: AdminAuditLog) => value),
    update: jest.fn(),
    ...options.auditLogsRepository,
  } as unknown as Repository<AdminAuditLog>;
  const getRepository = jest.fn((entity: unknown) => {
    if (entity === AdminAccount) return accountsRepository;
    if (entity === AdminSession) return sessionsRepository;
    if (entity === AdminAuditLog) return auditLogsRepository;
    throw new Error('Unexpected transaction repository');
  });
  Object.defineProperty(accountsRepository, 'manager', {
    configurable: true,
    value: {
      transaction: jest.fn(
        async (
          operation: (manager: {
            getRepository: typeof getRepository;
          }) => Promise<unknown>,
        ) => operation({ getRepository }),
      ),
    },
  });
  const jwtService = {
    sign: jest.fn(() => 'admin-access-token'),
    ...options.jwtService,
  } as unknown as JwtService;
  const mailService = {
    sendAdminInvitationEmail: jest.fn(),
    sendAdminPasswordResetEmail: jest.fn(),
    ...options.mailService,
  } as unknown as MailService;

  return new AdminAuthService(
    options.configService ?? createConfig(),
    jwtService,
    mailService,
    accountsRepository,
    sessionsRepository,
    auditLogsRepository,
  );
}

describe('AdminAuthService', () => {
  it('bootstraps the root admin as an invited account from a one-time setup token', async () => {
    const save = jest.fn(async (value: AdminAccount) => value);
    const service = createService({
      accountsRepository: {
        findOne: jest.fn(async () => null),
        save,
      },
    });

    await service.onModuleInit();

    const savedRoot = save.mock.calls[0]?.[0];
    expect(savedRoot).toMatchObject({
      canonical_email: 'owner@ritora.app',
      email: 'owner@ritora.app',
      name: 'Root Admin',
      role: AdminAccountRole.Root,
      status: AdminAccountStatus.Invited,
    });
    expect(savedRoot?.password_hash).toBeNull();
    expect(savedRoot?.accepted_at).toBeNull();
    expect(savedRoot?.invitation_token_hash).toBe(
      sha256ForTest(TEST_ROOT_SETUP_TOKEN),
    );
    expect(savedRoot?.invitation_expires_at).toBeInstanceOf(Date);
  });

  it('does not rotate an active root admin password during bootstrap', async () => {
    const passwordHash = await hash('RootAdmin123!', 4);
    const activeRoot = createAdminAccount({ password_hash: passwordHash });
    const save = jest.fn(async (value: AdminAccount) => value);
    const service = createService({
      accountsRepository: {
        findOne: jest.fn(async () => activeRoot),
        save,
      },
      configService: createConfig({
        ADMIN_ROOT_SETUP_TOKEN_HASH: sha256ForTest('b'.repeat(64)),
      }),
    });

    await service.onModuleInit();

    const savedRoot = save.mock.calls[0]?.[0];
    expect(savedRoot?.password_hash).toBe(passwordHash);
    expect(savedRoot?.invitation_token_hash).toBeNull();
    await expect(
      compare('RootAdmin123!', savedRoot?.password_hash ?? ''),
    ).resolves.toBe(true);
  });

  it('preserves an invited root setup token expiry across restarts', async () => {
    const existingExpiry = new Date('2026-05-21T10:00:00.000Z');
    const invitedRoot = createAdminAccount({
      accepted_at: null,
      invitation_expires_at: existingExpiry,
      invitation_token_hash: sha256ForTest(TEST_ROOT_SETUP_TOKEN),
      password_hash: null,
      status: AdminAccountStatus.Invited,
    });
    const save = jest.fn(async (value: AdminAccount) => value);
    const service = createService({
      accountsRepository: {
        findOne: jest.fn(async () => invitedRoot),
        save,
      },
    });

    await service.onModuleInit();

    const savedRoot = save.mock.calls[0]?.[0];
    expect(savedRoot?.invitation_token_hash).toBe(
      sha256ForTest(TEST_ROOT_SETUP_TOKEN),
    );
    expect(savedRoot?.invitation_expires_at).toBe(existingExpiry);
  });

  it('rotates an invited root setup expiry when the configured hash changes', async () => {
    const previousExpiry = new Date('2026-05-21T10:00:00.000Z');
    const rotatedHash = sha256ForTest('b'.repeat(64));
    const invitedRoot = createAdminAccount({
      accepted_at: null,
      invitation_expires_at: previousExpiry,
      invitation_token_hash: sha256ForTest(TEST_ROOT_SETUP_TOKEN),
      password_hash: null,
      status: AdminAccountStatus.Invited,
    });
    const save = jest.fn(async (value: AdminAccount) => value);
    const service = createService({
      accountsRepository: {
        findOne: jest.fn(async () => invitedRoot),
        save,
      },
      configService: createConfig({
        ADMIN_ROOT_SETUP_TOKEN_HASH: rotatedHash,
      }),
    });

    await service.onModuleInit();

    const savedRoot = save.mock.calls[0]?.[0];
    expect(savedRoot?.invitation_token_hash).toBe(rotatedHash);
    expect(savedRoot?.invitation_expires_at).not.toBe(previousExpiry);
  });

  it('requires a one-time root setup token before the first root exists in every environment', async () => {
    const service = createService({
      accountsRepository: {
        findOne: jest.fn(async () => null),
      },
      configService: createConfig({
        ADMIN_ROOT_SETUP_TOKEN_HASH: '',
      }),
    });

    await expect(service.onModuleInit()).rejects.toThrow(
      'ADMIN_ROOT_SETUP_TOKEN_HASH',
    );
  });

  it('logs in an active admin and issues an admin refresh cookie', async () => {
    const passwordHash = await hash('RootAdmin123!', 4);
    const account = createAdminAccount({ password_hash: passwordHash });
    const sessionSave = jest.fn(async (value: AdminSession) => value);
    const service = createService({
      accountsRepository: {
        findOne: jest.fn(async () => account),
        save: jest.fn(async (value: AdminAccount) => value),
      },
      sessionsRepository: {
        save: sessionSave,
      },
    });
    const response = createResponse();

    const result = await service.login(
      'Owner@Ritora.app',
      'RootAdmin123!',
      response,
      '127.0.0.1',
      'Jest',
    );

    expect(result.accessToken).toBe('admin-access-token');
    expect(result.member).toMatchObject({
      email: 'owner@ritora.app',
      role: AdminAccountRole.Root,
    });
    expect(response.cookie).toHaveBeenCalledWith(
      'ritora_admin_refresh',
      expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}\.[a-f0-9]{64}$/),
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
    expect(sessionSave).toHaveBeenCalledWith(
      expect.objectContaining({
        admin_id: account.id,
        ip_address: '127.0.0.1',
        user_agent: 'Jest',
      }),
    );
  });

  it('returns product-operation permissions for active non-root admin logins', async () => {
    const passwordHash = await hash('AdminOps123!', 4);
    const account = createAdminAccount({
      canonical_email: 'ops@ritora.app',
      email: 'ops@ritora.app',
      id: 'admin-ops',
      name: 'Ops Admin',
      password_hash: passwordHash,
      role: AdminAccountRole.Admin,
    });
    const service = createService({
      accountsRepository: {
        findOne: jest.fn(async () => account),
        save: jest.fn(async (value: AdminAccount) => value),
      },
    });

    const result = await service.login(
      'ops@ritora.app',
      'AdminOps123!',
      createResponse(),
    );

    expect(result.member).toMatchObject({
      email: 'ops@ritora.app',
      permissions: [
        'metrics:read',
        'users:read',
        'users:restrict',
        'jobs:write',
        'audit:read',
      ],
      role: AdminAccountRole.Admin,
      roles: [AdminAccountRole.Admin],
    });
  });

  it('rejects disabled, invited, deleted, or wrong-password admin logins', async () => {
    const passwordHash = await hash('RootAdmin123!', 4);
    const service = createService({
      accountsRepository: {
        findOne: jest.fn(async () =>
          createAdminAccount({
            deleted_at: null,
            password_hash: passwordHash,
            status: AdminAccountStatus.Invited,
          }),
        ),
      },
    });

    await expect(
      service.login('owner@ritora.app', 'RootAdmin123!', createResponse()),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('creates invited admins, stores only a token hash, and sends an invitation email', async () => {
    const save = jest.fn(async (value: AdminAccount) => ({
      ...value,
      id: 'admin-invited',
    }));
    const auditSave = jest.fn(async (value: AdminAuditLog) => value);
    const sendAdminInvitationEmail = jest.fn();
    const service = createService({
      accountsRepository: {
        findOne: jest.fn(async () => null),
        save,
      },
      auditLogsRepository: {
        save: auditSave,
      },
      mailService: { sendAdminInvitationEmail },
    });

    const invited = await service.createAdmin(
      createAdminAccount(),
      {
        email: 'Ops@Ritora.app',
        name: 'Ops Lead',
        reason: 'Launch support coverage',
      },
      {
        ip: '127.0.0.1',
        reason: 'Launch support coverage',
        sessionId: 'session-root',
        userAgent: 'Jest',
      },
      'sv',
    );

    const savedAdmin = save.mock.calls[0]?.[0];
    expect(invited).toMatchObject({
      email: 'Ops@Ritora.app',
      role: AdminAccountRole.Admin,
      status: AdminAccountStatus.Invited,
    });
    expect(savedAdmin).toMatchObject({
      canonical_email: 'ops@ritora.app',
      created_by_admin_id: 'admin-root',
      invitation_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      password_hash: null,
    });
    expect(JSON.stringify(savedAdmin)).not.toContain('ritora-admin-invite');
    expect(sendAdminInvitationEmail).toHaveBeenCalledWith(
      'Ops@Ritora.app',
      expect.stringMatching(/^[a-f0-9]{64}$/),
      'Root Admin',
      'sv',
    );
    expect(auditSave).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AdminAuditAction.AdminInvited,
        actor_admin_id: 'admin-root',
        actor_session_id: 'session-root',
        ip_address: '127.0.0.1',
        reason: 'Launch support coverage',
        target_admin_id: 'admin-invited',
        user_agent: 'Jest',
      }),
    );
  });

  it('rejects admin invitations with blank names after trimming', async () => {
    const service = createService();

    await expect(
      service.createAdmin(
        createAdminAccount(),
        {
          email: 'ops@ritora.app',
          name: '   ',
          reason: 'Launch support coverage',
        },
        {
          reason: 'Launch support coverage',
          sessionId: 'session-root',
        },
        'en',
      ),
    ).rejects.toThrow('Admin name must contain at least 2 characters');
  });

  it('prevents non-root admins from listing admins', async () => {
    const service = createService();

    await expect(
      service.listAdmins(createAdminAccount({ role: AdminAccountRole.Admin })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('searches admins with a capped selective query and escaped wildcard input', async () => {
    const admin = createAdminAccount({
      email: 'ops_100@ritora.app',
      id: 'admin-ops',
      name: 'Ops Lead',
      role: AdminAccountRole.Admin,
    });
    const builder = createAdminAccountsQueryBuilderMock([admin], 101);
    const createQueryBuilder = jest.fn(() => builder);
    const service = createService({
      accountsRepository: { createQueryBuilder },
    });

    const result = await service.listAdmins(createAdminAccount(), {
      limit: 250,
      page: 2,
      query: '  ops_%  ',
    });

    expect(result).toEqual({
      admins: [
        expect.objectContaining({
          email: 'ops_100@ritora.app',
          id: 'admin-ops',
        }),
      ],
      hasNextPage: false,
      hasPreviousPage: true,
      limit: 100,
      page: 2,
      total: 101,
      totalPages: 2,
    });
    expect(createQueryBuilder).toHaveBeenCalledWith('admin');
    expect(builder.select).toHaveBeenCalledWith([
      'admin.id',
      'admin.email',
      'admin.canonical_email',
      'admin.name',
      'admin.role',
      'admin.status',
      'admin.created_by_admin_id',
      'admin.accepted_at',
      'admin.last_login_at',
      'admin.created_at',
      'admin.updated_at',
    ]);
    expect(builder.where).toHaveBeenCalledWith('admin.deleted_at IS NULL');
    expect(builder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining("ESCAPE '\\'"),
      { search: '%ops\\_\\%%' },
    );
    expect(builder.take).toHaveBeenCalledWith(100);
    expect(builder.skip).toHaveBeenCalledWith(100);
  });

  it('prevents non-root admins from creating admins', async () => {
    const service = createService();

    await expect(
      service.createAdmin(
        createAdminAccount({ role: AdminAccountRole.Admin }),
        {
          email: 'ops@ritora.app',
          name: 'Ops Lead',
          reason: 'Launch support coverage',
        },
        {
          reason: 'Launch support coverage',
          sessionId: 'session-root',
        },
        'en',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('resends invited admin invitations with a rotated token and audit trail', async () => {
    const invitedAdmin = createAdminAccount({
      email: 'ops@ritora.app',
      id: 'admin-ops',
      invitation_expires_at: new Date('2026-05-20T10:00:00.000Z'),
      invitation_token_hash: sha256ForTest('old-token'),
      name: 'Ops Lead',
      password_hash: null,
      role: AdminAccountRole.Admin,
      status: AdminAccountStatus.Invited,
    });
    const save = jest.fn(async (value: AdminAccount) => value);
    const auditSave = jest.fn(async (value: AdminAuditLog) => value);
    const sendAdminInvitationEmail = jest.fn();
    const service = createService({
      accountsRepository: {
        findOne: jest.fn(async () => invitedAdmin),
        save,
      },
      auditLogsRepository: {
        save: auditSave,
      },
      mailService: { sendAdminInvitationEmail },
    });

    const result = await service.resendAdminInvitation(
      createAdminAccount(),
      'admin-ops',
      {
        ip: '127.0.0.1',
        reason: 'Invitation link expired',
        sessionId: 'session-root',
        userAgent: 'Jest',
      },
      'sv',
    );

    const savedAdmin = save.mock.calls[0]?.[0];
    expect(result).toMatchObject({
      email: 'ops@ritora.app',
      status: AdminAccountStatus.Invited,
    });
    expect(savedAdmin?.invitation_token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(savedAdmin?.invitation_token_hash).not.toBe(
      sha256ForTest('old-token'),
    );
    expect(savedAdmin?.invitation_expires_at).toBeInstanceOf(Date);
    expect(sendAdminInvitationEmail).toHaveBeenCalledWith(
      'ops@ritora.app',
      expect.stringMatching(/^[a-f0-9]{64}$/),
      'Root Admin',
      'sv',
    );
    expect(JSON.stringify(savedAdmin)).not.toContain(
      sendAdminInvitationEmail.mock.calls[0]?.[1],
    );
    expect(auditSave).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AdminAuditAction.AdminInvitationResent,
        actor_admin_id: 'admin-root',
        actor_session_id: 'session-root',
        reason: 'Invitation link expired',
        target_admin_id: 'admin-ops',
      }),
    );
  });

  it('rejects resend invitation for active admin accounts', async () => {
    const service = createService({
      accountsRepository: {
        findOne: jest.fn(async () =>
          createAdminAccount({
            id: 'admin-ops',
            role: AdminAccountRole.Admin,
            status: AdminAccountStatus.Active,
          }),
        ),
      },
    });

    await expect(
      service.resendAdminInvitation(
        createAdminAccount(),
        'admin-ops',
        {
          reason: 'Invitation link expired',
          sessionId: 'session-root',
        },
        'en',
      ),
    ).rejects.toThrow(
      'Only invited admin accounts can receive a new invitation',
    );
  });

  it('prevents non-root admins from deleting admins', async () => {
    const service = createService();

    await expect(
      service.deleteAdmin(
        createAdminAccount({ role: AdminAccountRole.Admin }),
        'admin-ops',
        {
          reason: 'Contract ended',
          sessionId: 'session-admin',
        },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('activates invited admins through the reset-password flow', async () => {
    const invitationToken = 'a'.repeat(64);
    const account = createAdminAccount({
      invitation_expires_at: new Date(Date.now() + 60_000),
      invitation_token_hash: sha256ForTest(invitationToken),
      password_hash: null,
      role: AdminAccountRole.Admin,
      status: AdminAccountStatus.Invited,
    });
    const save = jest.fn(async (value: AdminAccount) => value);
    const service = createService({
      accountsRepository: {
        findOne: jest.fn(async () => account),
        save,
      },
    });

    await service.resetPassword(invitationToken, 'NewAdmin123!');

    const saved = save.mock.calls[0]?.[0];
    expect(saved).toMatchObject({
      accepted_at: expect.any(Date),
      invitation_expires_at: null,
      invitation_token_hash: null,
      password_reset_expires: null,
      password_reset_token_hash: null,
      status: AdminAccountStatus.Active,
    });
    await expect(
      compare('NewAdmin123!', saved?.password_hash ?? ''),
    ).resolves.toBe(true);
  });

  it('does not reactivate disabled admins through stale password-reset tokens', async () => {
    const resetToken = 'b'.repeat(64);
    const account = createAdminAccount({
      password_hash: await hash('OldAdmin123!', 4),
      password_reset_expires: new Date(Date.now() + 60_000),
      password_reset_token_hash: sha256ForTest(resetToken),
      role: AdminAccountRole.Admin,
      status: AdminAccountStatus.Disabled,
    });
    const save = jest.fn(async (value: AdminAccount) => value);
    const service = createService({
      accountsRepository: {
        findOne: jest.fn(async () => account),
        save,
      },
    });

    await expect(
      service.resetPassword(resetToken, 'NewAdmin123!'),
    ).rejects.toThrow(BadRequestException);
    expect(save).not.toHaveBeenCalled();
  });

  it('soft deletes non-root admins and revokes their sessions', async () => {
    const target = createAdminAccount({
      id: 'admin-ops',
      role: AdminAccountRole.Admin,
      status: AdminAccountStatus.Active,
    });
    const save = jest.fn(async (value: AdminAccount) => value);
    const revoke = jest.fn();
    const auditSave = jest.fn(async (value: AdminAuditLog) => value);
    const service = createService({
      accountsRepository: {
        findOne: jest.fn(async () => target),
        save,
      },
      auditLogsRepository: {
        save: auditSave,
      },
      sessionsRepository: {
        update: revoke,
      },
    });

    await service.deleteAdmin(createAdminAccount(), 'admin-ops', {
      ip: '127.0.0.1',
      reason: 'Contract ended',
      sessionId: 'session-root',
      userAgent: 'Jest',
    });

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        deleted_at: expect.any(Date),
        status: AdminAccountStatus.Disabled,
      }),
    );
    expect(revoke).toHaveBeenCalledWith(
      expect.objectContaining({ admin_id: 'admin-ops' }),
      expect.objectContaining({ revoked_at: expect.any(Date) }),
    );
    expect(auditSave).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AdminAuditAction.AdminDeleted,
        actor_admin_id: 'admin-root',
        actor_session_id: 'session-root',
        ip_address: '127.0.0.1',
        reason: 'Contract ended',
        target_admin_id: 'admin-ops',
        user_agent: 'Jest',
      }),
    );
  });

  it('does not allow root accounts to be deleted', async () => {
    const service = createService({
      accountsRepository: {
        findOne: jest.fn(async () => createAdminAccount()),
      },
    });

    await expect(
      service.deleteAdmin(createAdminAccount(), 'admin-root', {
        reason: 'Contract ended',
        sessionId: 'session-root',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws a conflict when inviting an existing active admin', async () => {
    const service = createService({
      accountsRepository: {
        findOne: jest.fn(async () => createAdminAccount()),
      },
    });

    await expect(
      service.createAdmin(
        createAdminAccount(),
        {
          email: 'owner@ritora.app',
          name: 'Owner',
          reason: 'Launch support coverage',
        },
        {
          reason: 'Launch support coverage',
          sessionId: 'session-root',
        },
      ),
    ).rejects.toThrow(ConflictException);
  });
});

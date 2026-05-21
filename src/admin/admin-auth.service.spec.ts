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
import { generateTotpCode } from './admin-totp';
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
    mfa_enabled_at: null,
    mfa_last_used_time_step: null,
    mfa_pending_expires_at: null,
    mfa_pending_totp_secret: null,
    mfa_recovery_code_hashes: null,
    mfa_totp_secret: null,
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

function createAdminSession(
  overrides: Partial<AdminSession> = {},
): AdminSession {
  return {
    admin: createAdminAccount(),
    admin_id: 'admin-root',
    created_at: new Date('2026-05-20T10:00:00.000Z'),
    expires_at: new Date(Date.now() + 60_000),
    generateId: jest.fn(),
    id: 'session-1',
    ip_address: '127.0.0.1',
    last_used_at: new Date('2026-05-20T10:30:00.000Z'),
    refresh_token_hash: sha256ForTest('refresh-secret'),
    revoked_at: null,
    user_agent: 'Jest Browser',
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
  const query = jest.fn();
  Object.defineProperty(accountsRepository, 'manager', {
    configurable: true,
    value: {
      transaction: jest.fn(
        async (
          operation: (manager: {
            getRepository: typeof getRepository;
            query: typeof query;
          }) => Promise<unknown>,
        ) => operation({ getRepository, query }),
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

    expect('accessToken' in result ? result.accessToken : null).toBe(
      'admin-access-token',
    );
    expect('member' in result ? result.member : null).toMatchObject({
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

  it('requires an MFA code before issuing a session for MFA-enabled admins', async () => {
    const passwordHash = await hash('RootAdmin123!', 4);
    const account = createAdminAccount({
      mfa_enabled_at: new Date('2026-05-20T09:00:00.000Z'),
      mfa_totp_secret: 'JBSWY3DPEHPK3PXP',
      password_hash: passwordHash,
    });
    const response = createResponse();
    const sessionSave = jest.fn();
    const service = createService({
      accountsRepository: {
        findOne: jest.fn(async () => account),
      },
      sessionsRepository: {
        save: sessionSave,
      },
    });

    await expect(
      service.login('owner@ritora.app', 'RootAdmin123!', response),
    ).resolves.toEqual({ mfaRequired: true });

    expect(sessionSave).not.toHaveBeenCalled();
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('verifies MFA inside the locked login transaction before issuing a session', async () => {
    const passwordHash = await hash('RootAdmin123!', 4);
    const mfaAccount = createAdminAccount({
      mfa_enabled_at: new Date('2026-05-20T09:00:00.000Z'),
      mfa_totp_secret: 'JBSWY3DPEHPK3PXP',
      password_hash: passwordHash,
    });
    const accountFindOne = jest
      .fn<Promise<AdminAccount | null>, []>()
      .mockResolvedValueOnce(mfaAccount)
      .mockResolvedValueOnce(mfaAccount);
    const sessionSave = jest.fn(async (value: AdminSession) => value);
    const service = createService({
      accountsRepository: {
        findOne: accountFindOne,
        save: jest.fn(async (value: AdminAccount) => value),
      },
      sessionsRepository: {
        save: sessionSave,
        update: jest.fn(),
      },
    });
    const code = generateTotpCode('JBSWY3DPEHPK3PXP');

    await expect(
      service.login(
        'owner@ritora.app',
        'RootAdmin123!',
        createResponse(),
        '127.0.0.1',
        'Jest',
        code,
      ),
    ).resolves.toMatchObject({ accessToken: 'admin-access-token' });

    expect(accountFindOne).toHaveBeenLastCalledWith(
      expect.objectContaining({
        lock: { mode: 'pessimistic_write' },
      }),
    );
    expect(sessionSave).toHaveBeenCalled();
    expect(Number(mfaAccount.mfa_last_used_time_step)).toBeGreaterThan(0);
  });

  it('rejects replayed MFA time steps before creating a login session', async () => {
    const passwordHash = await hash('RootAdmin123!', 4);
    const secret = 'JBSWY3DPEHPK3PXP';
    const timeStep = Math.floor(Date.now() / 1000 / 30);
    const mfaAccount = createAdminAccount({
      mfa_enabled_at: new Date('2026-05-20T09:00:00.000Z'),
      mfa_last_used_time_step: String(timeStep),
      mfa_totp_secret: secret,
      password_hash: passwordHash,
    });
    const sessionSave = jest.fn();
    const service = createService({
      accountsRepository: {
        findOne: jest
          .fn<Promise<AdminAccount | null>, []>()
          .mockResolvedValueOnce(mfaAccount)
          .mockResolvedValueOnce(mfaAccount),
      },
      sessionsRepository: {
        save: sessionSave,
      },
    });

    await expect(
      service.login(
        'owner@ritora.app',
        'RootAdmin123!',
        createResponse(),
        undefined,
        undefined,
        generateTotpCode(secret, timeStep),
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(sessionSave).not.toHaveBeenCalled();
  });

  it('revokes previous active admin sessions before issuing a new login session', async () => {
    const passwordHash = await hash('RootAdmin123!', 4);
    const account = createAdminAccount({ password_hash: passwordHash });
    const accountFindOne = jest
      .fn<Promise<AdminAccount | null>, []>()
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce(account);
    const sessionUpdate = jest.fn();
    const sessionSave = jest.fn(async (value: AdminSession) => value);
    const service = createService({
      accountsRepository: {
        findOne: accountFindOne,
        save: jest.fn(async (value: AdminAccount) => value),
      },
      sessionsRepository: {
        save: sessionSave,
        update: sessionUpdate,
      },
    });

    await service.login(
      'owner@ritora.app',
      'RootAdmin123!',
      createResponse(),
      '127.0.0.1',
      'Jest',
    );

    expect(sessionUpdate).toHaveBeenCalledWith(
      { admin_id: 'admin-root', revoked_at: expect.any(Object) },
      { revoked_at: expect.any(Date) },
    );
    expect(sessionUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      sessionSave.mock.invocationCallOrder[0],
    );
  });

  it('does not issue a new session if the admin is no longer active while logging in', async () => {
    const passwordHash = await hash('RootAdmin123!', 4);
    const account = createAdminAccount({ password_hash: passwordHash });
    const sessionUpdate = jest.fn();
    const sessionSave = jest.fn();
    const response = createResponse();
    const service = createService({
      accountsRepository: {
        findOne: jest
          .fn<Promise<AdminAccount | null>, []>()
          .mockResolvedValueOnce(account)
          .mockResolvedValueOnce(null),
        save: jest.fn(),
      },
      sessionsRepository: {
        save: sessionSave,
        update: sessionUpdate,
      },
    });

    await expect(
      service.login('owner@ritora.app', 'RootAdmin123!', response),
    ).rejects.toThrow(UnauthorizedException);

    expect(sessionUpdate).not.toHaveBeenCalled();
    expect(sessionSave).not.toHaveBeenCalled();
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('loads the single active admin session with masked IPs and current-session marker', async () => {
    const findOne = jest.fn(async () =>
      createAdminSession({ id: 'session-current' }),
    );
    const service = createService({
      sessionsRepository: { findOne },
    });

    await expect(
      service.listSessions({
        email: 'owner@ritora.app',
        id: 'admin-root',
        name: 'Root Admin',
        role: AdminAccountRole.Root,
        sessionId: 'session-current',
        status: AdminAccountStatus.Active,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        current: true,
        id: 'session-current',
        ipAddress: '127.0.0.0',
      }),
    ]);
    expect(findOne).toHaveBeenCalledWith({
      order: { last_used_at: 'DESC' },
      where: { admin_id: 'admin-root', revoked_at: expect.any(Object) },
    });
  });

  it('omits expired admin sessions from session inspection', async () => {
    const service = createService({
      sessionsRepository: {
        findOne: jest.fn(async () =>
          createAdminSession({
            expires_at: new Date(Date.now() - 60_000),
            id: 'session-expired',
          }),
        ),
      },
    });

    await expect(
      service.listSessions({
        email: 'owner@ritora.app',
        id: 'admin-root',
        name: 'Root Admin',
        role: AdminAccountRole.Root,
        sessionId: 'session-current',
        status: AdminAccountStatus.Active,
      }),
    ).resolves.toEqual([]);
  });

  it('starts MFA setup only after current password reauthentication', async () => {
    const passwordHash = await hash('RootAdmin123!', 4);
    const account = createAdminAccount({ password_hash: passwordHash });
    const save = jest.fn(async (value: AdminAccount) => value);
    const service = createService({
      accountsRepository: {
        findOne: jest.fn(async () => account),
        save,
      },
    });

    const setup = await service.startMfaSetup(
      {
        email: 'owner@ritora.app',
        id: 'admin-root',
        name: 'Root Admin',
        role: AdminAccountRole.Root,
        sessionId: 'session-current',
        status: AdminAccountStatus.Active,
      },
      'RootAdmin123!',
    );

    expect(setup.secret).toMatch(/^[A-Z2-7]+$/);
    expect(setup.manualEntryKey).toContain(' ');
    expect(setup.otpauthUri).toContain('otpauth://totp/');
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        mfa_pending_expires_at: expect.any(Date),
        mfa_pending_totp_secret: setup.secret,
      }),
    );
  });

  it('enables MFA from a pending secret and returns one-time recovery codes', async () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const account = createAdminAccount({
      mfa_pending_expires_at: new Date(Date.now() + 60_000),
      mfa_pending_totp_secret: secret,
    });
    const save = jest.fn(async (value: AdminAccount) => value);
    const auditSave = jest.fn(async (value: AdminAuditLog) => value);
    const service = createService({
      accountsRepository: {
        findOne: jest.fn(async () => account),
        save,
      },
      auditLogsRepository: { save: auditSave },
    });

    const result = await service.enableMfa(
      {
        email: 'owner@ritora.app',
        id: 'admin-root',
        name: 'Root Admin',
        role: AdminAccountRole.Root,
        sessionId: 'session-current',
        status: AdminAccountStatus.Active,
      },
      generateTotpCode(secret),
      {
        ip: '127.0.0.1',
        sessionId: 'session-current',
        userAgent: 'Jest',
      },
    );

    expect(result.enabled).toBe(true);
    expect(result.recoveryCodes).toHaveLength(10);
    expect(account.mfa_totp_secret).toBe(secret);
    expect(account.mfa_pending_totp_secret).toBeNull();
    expect(account.mfa_recovery_code_hashes).toHaveLength(10);
    expect(JSON.stringify(account.mfa_recovery_code_hashes)).not.toContain(
      result.recoveryCodes[0],
    );
    expect(auditSave).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AdminAuditAction.AdminMfaEnabled,
        actor_admin_id: 'admin-root',
        target_admin_id: 'admin-root',
      }),
    );
  });

  it('disables MFA only after password and second-factor verification', async () => {
    const passwordHash = await hash('RootAdmin123!', 4);
    const secret = 'JBSWY3DPEHPK3PXP';
    const account = createAdminAccount({
      mfa_enabled_at: new Date('2026-05-20T09:00:00.000Z'),
      mfa_recovery_code_hashes: [sha256ForTest('RECOVERYCODE')],
      mfa_totp_secret: secret,
      password_hash: passwordHash,
    });
    const save = jest.fn(async (value: AdminAccount) => value);
    const service = createService({
      accountsRepository: {
        findOne: jest.fn(async () => account),
        save,
      },
    });

    await expect(
      service.disableMfa(
        {
          email: 'owner@ritora.app',
          id: 'admin-root',
          name: 'Root Admin',
          role: AdminAccountRole.Root,
          sessionId: 'session-current',
          status: AdminAccountStatus.Active,
        },
        'RootAdmin123!',
        generateTotpCode(secret),
        { sessionId: 'session-current' },
      ),
    ).resolves.toEqual({
      enabled: false,
      enabledAt: null,
      pendingSetupExpiresAt: null,
      recoveryCodesRemaining: 0,
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        mfa_enabled_at: null,
        mfa_recovery_code_hashes: null,
        mfa_totp_secret: null,
      }),
    );
  });

  it('locks and rotates the active admin refresh session', async () => {
    const response = createResponse();
    const session = createAdminSession({
      refresh_token_hash: sha256ForTest('refresh-secret'),
    });
    const sessionFindOne = jest.fn(async () => session);
    const accountFindOne = jest.fn(async () => createAdminAccount());
    const save = jest.fn(async (value: AdminSession) => value);
    const service = createService({
      accountsRepository: {
        findOne: accountFindOne,
      },
      sessionsRepository: {
        findOne: sessionFindOne,
        save,
      },
    });

    await expect(
      service.refreshTokens(
        'session-1.refresh-secret',
        response,
        '127.0.0.1',
        'Jest',
      ),
    ).resolves.toEqual({ accessToken: 'admin-access-token' });

    expect(sessionFindOne).toHaveBeenCalledWith({
      lock: { mode: 'pessimistic_write' },
      where: { id: 'session-1' },
    });
    expect(accountFindOne).toHaveBeenCalledWith({
      where: {
        deleted_at: expect.any(Object),
        id: 'admin-root',
        status: AdminAccountStatus.Active,
      },
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        ip_address: '127.0.0.1',
        last_used_at: expect.any(Date),
        user_agent: 'Jest',
      }),
    );
    expect(session.refresh_token_hash).not.toBe(
      sha256ForTest('refresh-secret'),
    );
    expect(response.cookie).toHaveBeenCalledWith(
      'ritora_admin_refresh',
      expect.stringMatching(/^session-1\.[a-f0-9]{64}$/),
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it('rejects forged admin refresh tokens without rotating the session', async () => {
    const response = createResponse();
    const save = jest.fn();
    const service = createService({
      accountsRepository: {
        findOne: jest.fn(async () => createAdminAccount()),
      },
      sessionsRepository: {
        findOne: jest.fn(async () =>
          createAdminSession({
            refresh_token_hash: sha256ForTest('real-secret'),
          }),
        ),
        save,
      },
    });

    await expect(
      service.refreshTokens('session-1.forged-secret', response),
    ).rejects.toThrow(UnauthorizedException);
    expect(save).not.toHaveBeenCalled();
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('logs out only when the refresh token secret matches and records an audit event', async () => {
    const response = createResponse();
    const session = createAdminSession({
      admin: createAdminAccount(),
      refresh_token_hash: sha256ForTest('refresh-secret'),
    });
    const save = jest.fn(async (value: AdminSession) => value);
    const auditSave = jest.fn(async (value: AdminAuditLog) => value);
    const service = createService({
      auditLogsRepository: { save: auditSave },
      sessionsRepository: {
        findOne: jest.fn(async () => session),
        save,
      },
    });

    await service.logout('session-1.refresh-secret', response, {
      ip: '127.0.0.1',
      userAgent: 'Jest',
    });

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ revoked_at: expect.any(Date) }),
    );
    expect(auditSave).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AdminAuditAction.AdminLoggedOut,
        actor_admin_id: 'admin-root',
        actor_session_id: 'session-1',
        reason: 'Admin signed out',
        target_admin_id: 'admin-root',
      }),
    );
    expect(response.clearCookie).toHaveBeenCalledWith(
      'ritora_admin_refresh',
      expect.objectContaining({ path: '/api/v1/admin/auth' }),
    );
  });

  it('does not revoke a session when the refresh token secret is invalid', async () => {
    const response = createResponse();
    const save = jest.fn();
    const service = createService({
      sessionsRepository: {
        findOne: jest.fn(async () =>
          createAdminSession({
            refresh_token_hash: sha256ForTest('real-secret'),
          }),
        ),
        save,
      },
    });

    await service.logout('session-1.forged-secret', response, {
      ip: '127.0.0.1',
      userAgent: 'Jest',
    });

    expect(save).not.toHaveBeenCalled();
    expect(response.clearCookie).toHaveBeenCalled();
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

    expect('member' in result ? result.member : null).toMatchObject({
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
      'admin.mfa_enabled_at',
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

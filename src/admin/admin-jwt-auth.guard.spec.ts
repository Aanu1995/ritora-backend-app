import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import {
  AdminAccount,
  AdminAccountRole,
  AdminAccountStatus,
} from './entities/admin-account.entity';
import { AdminSession } from './entities/admin-session.entity';
import { AdminJwtAuthGuard } from './admin-jwt-auth.guard';

type GuardRequest = {
  headers: Record<string, string | undefined>;
  user?: unknown;
};

function createContext(request: GuardRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

function createAccount(overrides: Partial<AdminAccount> = {}): AdminAccount {
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
    password_hash: null,
    password_reset_expires: null,
    password_reset_token_hash: null,
    role: AdminAccountRole.Root,
    sessions: [],
    status: AdminAccountStatus.Active,
    updated_at: new Date('2026-05-20T10:00:00.000Z'),
    ...overrides,
  };
}

function createGuard(
  options: {
    payload?: Record<string, unknown>;
    account?: AdminAccount | null;
    session?: AdminSession | null;
  } = {},
) {
  const configService = {
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string> = {
        JWT_AUDIENCE: 'ritora-web',
        JWT_ISSUER: 'ritora',
        JWT_SECRET: 'test-secret',
      };
      return values[key];
    }),
  } as unknown as ConfigService;
  const jwtService = {
    verifyAsync: jest.fn(async () => options.payload),
  } as unknown as JwtService;
  const accountsRepository = {
    findOne: jest.fn(async () => options.account ?? createAccount()),
  } as unknown as Repository<AdminAccount>;
  const sessionsRepository = {
    findOne: jest.fn(async () =>
      options.session === undefined
        ? ({
            admin_id: 'admin-root',
            expires_at: new Date(Date.now() + 60_000),
            id: 'session-1',
            revoked_at: null,
          } as AdminSession)
        : options.session,
    ),
  } as unknown as Repository<AdminSession>;

  return new AdminJwtAuthGuard(
    configService,
    jwtService,
    accountsRepository,
    sessionsRepository,
  );
}

describe('AdminJwtAuthGuard', () => {
  it('attaches the active admin account to the request', async () => {
    const guard = createGuard({
      payload: {
        aud: 'ritora-web',
        email: 'owner@ritora.app',
        iss: 'ritora',
        sid: 'session-1',
        sub: 'admin-root',
        typ: 'admin',
      },
    });
    const request: GuardRequest = {
      headers: { authorization: 'Bearer admin-token' },
    };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(request.user).toMatchObject({
      email: 'owner@ritora.app',
      id: 'admin-root',
      role: AdminAccountRole.Root,
      sessionId: 'session-1',
    });
  });

  it('rejects missing bearer tokens', async () => {
    const guard = createGuard();

    await expect(
      guard.canActivate(createContext({ headers: {} })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects non-admin JWT payloads', async () => {
    const guard = createGuard({
      payload: {
        sid: 'session-1',
        sub: 'admin-root',
        typ: 'user',
      },
    });

    await expect(
      guard.canActivate(
        createContext({ headers: { authorization: 'Bearer user-token' } }),
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects revoked sessions', async () => {
    const guard = createGuard({
      payload: {
        sid: 'session-1',
        sub: 'admin-root',
        typ: 'admin',
      },
      session: null,
    });

    await expect(
      guard.canActivate(
        createContext({ headers: { authorization: 'Bearer admin-token' } }),
      ),
    ).rejects.toThrow(UnauthorizedException);
  });
});

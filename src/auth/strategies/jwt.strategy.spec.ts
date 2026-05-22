import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { AuthSession } from '../entities/auth-session.entity';
import { UserRestrictionCapability } from '../../users/user-restrictions';
import { UsersService } from '../../users/users.service';
import type { Repository } from 'typeorm';

describe('JwtStrategy', () => {
  const configValues: Record<string, string> = {
    JWT_ISSUER: 'ritora',
    JWT_AUDIENCE: 'ritora-web',
    JWT_SECRET: 'jwt-secret',
  };
  const configService = {
    get: jest.fn((key: string) => configValues[key]),
    getOrThrow: jest.fn((key: string) => configValues[key]),
  } as unknown as ConfigService;

  const sessionsRepository = {
    query: jest.fn(),
  } as unknown as Repository<AuthSession>;

  const usersService = {
    clearExpiredAccountRestriction: jest.fn(),
  } as unknown as UsersService;

  function makeStrategy(): JwtStrategy {
    return new JwtStrategy(configService, sessionsRepository, usersService);
  }

  function makeSessionUserRow(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      account_restricted_at: null,
      account_restriction_capabilities: null,
      account_restriction_expires_at: null,
      email: 'test@example.com',
      preferred_language: 'sv',
      session_id: '01SESSION',
      time_zone: 'Europe/Stockholm',
      user_id: '01USER',
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a sanitized user payload for valid users', async () => {
    (sessionsRepository.query as jest.Mock).mockResolvedValue([
      makeSessionUserRow(),
    ]);

    const strategy = makeStrategy();
    const result = await strategy.validate({
      sub: '01USER',
      email: 'test@example.com',
      sid: '01SESSION',
      iss: 'ritora',
      aud: 'ritora-web',
    });

    expect(result).toEqual({
      account_restricted_at: null,
      account_restriction_capabilities: null,
      account_restriction_expires_at: null,
      id: '01USER',
      email: 'test@example.com',
      language: 'sv',
      timeZone: 'Europe/Stockholm',
      sessionId: '01SESSION',
    });
    const sql = String(
      (sessionsRepository.query as jest.Mock).mock.calls[0][0],
    );
    expect(sql).toContain('FROM auth_sessions sessions');
    expect(sql).toContain('INNER JOIN users users');
    expect(sql).toContain('sessions.id = $1');
    expect(sql).toContain('sessions.user_id = $2');
    expect(sql).toContain('sessions.revoked_at IS NULL');
    expect(sql).toContain('sessions.expires_at > now()');
    expect(sessionsRepository.query).toHaveBeenCalledWith(expect.any(String), [
      '01SESSION',
      '01USER',
    ]);
  });

  it('throws when the user no longer exists', async () => {
    (sessionsRepository.query as jest.Mock).mockResolvedValue([]);

    const strategy = makeStrategy();

    await expect(
      strategy.validate({
        sub: 'missing',
        email: 'missing@example.com',
        sid: '01SESSION',
        iss: 'ritora',
        aud: 'ritora-web',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws when the user account is restricted', async () => {
    (sessionsRepository.query as jest.Mock).mockResolvedValue([
      makeSessionUserRow({
        account_restricted_at: new Date('2026-05-20T09:00:00.000Z'),
        account_restriction_capabilities: [
          UserRestrictionCapability.DisableLogin,
        ],
        preferred_language: 'en',
      }),
    ]);

    const strategy = makeStrategy();

    await expect(
      strategy.validate({
        sub: '01USER',
        email: 'test@example.com',
        sid: '01SESSION',
        iss: 'ritora',
        aud: 'ritora-web',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('allows privacy export requests for login-restricted users with a valid session', async () => {
    (sessionsRepository.query as jest.Mock).mockResolvedValue([
      makeSessionUserRow({
        account_restricted_at: new Date('2026-05-20T09:00:00.000Z'),
        account_restriction_capabilities: [
          UserRestrictionCapability.DisableLogin,
        ],
        preferred_language: 'en',
      }),
    ]);

    const strategy = makeStrategy();

    await expect(
      strategy.validate(
        {
          method: 'POST',
          originalUrl: '/auth/export',
        } as never,
        {
          sub: '01USER',
          email: 'test@example.com',
          sid: '01SESSION',
          iss: 'ritora',
          aud: 'ritora-web',
        },
      ),
    ).resolves.toMatchObject({
      id: '01USER',
      sessionId: '01SESSION',
    });
  });

  it('allows an active session when the restriction does not disable login', async () => {
    (sessionsRepository.query as jest.Mock).mockResolvedValue([
      makeSessionUserRow({
        account_restricted_at: new Date('2026-05-20T09:00:00.000Z'),
        account_restriction_capabilities: [
          UserRestrictionCapability.DisableNotifications,
        ],
        preferred_language: 'en',
      }),
    ]);

    const strategy = makeStrategy();

    await expect(
      strategy.validate({
        sub: '01USER',
        email: 'test@example.com',
        sid: '01SESSION',
        iss: 'ritora',
        aud: 'ritora-web',
      }),
    ).resolves.toMatchObject({
      id: '01USER',
      sessionId: '01SESSION',
    });
  });

  it('soft-clears an expired login restriction before returning the session payload', async () => {
    (sessionsRepository.query as jest.Mock).mockResolvedValue([
      makeSessionUserRow({
        account_restricted_at: new Date('2026-05-20T09:00:00.000Z'),
        account_restriction_capabilities: [
          UserRestrictionCapability.DisableLogin,
        ],
        account_restriction_expires_at: new Date('2026-05-20T10:00:00.000Z'),
        preferred_language: 'en',
      }),
    ]);

    const strategy = makeStrategy();

    await expect(
      strategy.validate({
        sub: '01USER',
        email: 'test@example.com',
        sid: '01SESSION',
        iss: 'ritora',
        aud: 'ritora-web',
      }),
    ).resolves.toMatchObject({
      account_restricted_at: null,
      account_restriction_capabilities: null,
      account_restriction_expires_at: null,
      id: '01USER',
      sessionId: '01SESSION',
    });
    expect(usersService.clearExpiredAccountRestriction).toHaveBeenCalledWith(
      '01USER',
    );
  });

  it('throws when the session is revoked or missing', async () => {
    (sessionsRepository.query as jest.Mock).mockResolvedValue([]);

    const strategy = makeStrategy();

    await expect(
      strategy.validate({
        sub: '01USER',
        email: 'test@example.com',
        sid: 'revoked',
        iss: 'ritora',
        aud: 'ritora-web',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });
});

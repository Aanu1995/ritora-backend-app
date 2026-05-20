import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { UsersService } from '../../users/users.service';
import { AuthSession } from '../entities/auth-session.entity';
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

  const usersService = {
    findById: jest.fn(),
  } as unknown as UsersService;

  const sessionsRepository = {
    findOne: jest.fn(),
  } as unknown as Repository<AuthSession>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a sanitized user payload for valid users', async () => {
    (sessionsRepository.findOne as jest.Mock).mockResolvedValue({
      id: '01SESSION',
      user_id: '01USER',
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null,
    });
    (usersService.findById as jest.Mock).mockResolvedValue({
      id: '01USER',
      email: 'test@example.com',
      preferred_language: 'sv',
      time_zone: 'Europe/Stockholm',
    });

    const strategy = new JwtStrategy(
      configService,
      usersService,
      sessionsRepository,
    );
    const result = await strategy.validate({
      sub: '01USER',
      email: 'test@example.com',
      sid: '01SESSION',
      iss: 'ritora',
      aud: 'ritora-web',
    });

    expect(result).toEqual({
      id: '01USER',
      email: 'test@example.com',
      language: 'sv',
      timeZone: 'Europe/Stockholm',
      sessionId: '01SESSION',
    });
  });

  it('throws when the user no longer exists', async () => {
    (sessionsRepository.findOne as jest.Mock).mockResolvedValue({
      id: '01SESSION',
      user_id: 'missing',
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null,
    });
    (usersService.findById as jest.Mock).mockResolvedValue(null);

    const strategy = new JwtStrategy(
      configService,
      usersService,
      sessionsRepository,
    );

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
    (sessionsRepository.findOne as jest.Mock).mockResolvedValue({
      id: '01SESSION',
      user_id: '01USER',
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null,
    });
    (usersService.findById as jest.Mock).mockResolvedValue({
      id: '01USER',
      email: 'test@example.com',
      preferred_language: 'en',
      time_zone: 'Europe/Stockholm',
      account_restricted_at: new Date('2026-05-20T09:00:00.000Z'),
    });

    const strategy = new JwtStrategy(
      configService,
      usersService,
      sessionsRepository,
    );

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

  it('throws when the session is revoked or missing', async () => {
    (sessionsRepository.findOne as jest.Mock).mockResolvedValue(null);

    const strategy = new JwtStrategy(
      configService,
      usersService,
      sessionsRepository,
    );

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

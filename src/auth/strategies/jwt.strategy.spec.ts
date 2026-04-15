import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { UsersService } from '../../users/users.service';

describe('JwtStrategy', () => {
  const configService = {
    get: jest.fn((key: string, fallback?: string) => {
      switch (key) {
        case 'JWT_ISSUER':
          return 'ritora';
        case 'JWT_AUDIENCE':
          return 'ritora-web';
        case 'JWT_SECRET':
          return 'jwt-secret';
        default:
          return fallback;
      }
    }),
  } as unknown as ConfigService;

  const usersService = {
    findById: jest.fn(),
  } as unknown as UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a sanitized user payload for valid users', async () => {
    (usersService.findById as jest.Mock).mockResolvedValue({
      id: '01USER',
      email: 'test@example.com',
    });

    const strategy = new JwtStrategy(configService, usersService);
    const result = await strategy.validate({
      sub: '01USER',
      email: 'test@example.com',
      iss: 'ritora',
      aud: 'ritora-web',
    });

    expect(result).toEqual({
      id: '01USER',
      email: 'test@example.com',
    });
  });

  it('throws when the user no longer exists', async () => {
    (usersService.findById as jest.Mock).mockResolvedValue(null);

    const strategy = new JwtStrategy(configService, usersService);

    await expect(
      strategy.validate({
        sub: 'missing',
        email: 'missing@example.com',
        iss: 'ritora',
        aud: 'ritora-web',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });
});

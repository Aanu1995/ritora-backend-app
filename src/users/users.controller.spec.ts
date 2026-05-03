import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';

const mockUsersService = () => ({
  findByIdOrFail: jest.fn(),
  updateProfile: jest.fn(),
  updatePreferredLanguage: jest.fn(),
  updateTimeZone: jest.fn(),
});

const mockRes = () => ({
  cookie: jest.fn(),
});

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: ReturnType<typeof mockUsersService>;

  beforeEach(async () => {
    usersService = mockUsersService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: usersService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'COOKIE_DOMAIN') return '';
              if (key === 'COOKIE_SECURE') return false;
              if (key === 'COOKIE_SAME_SITE') return 'lax';
              return undefined;
            }),
            getOrThrow: jest.fn((key: string) => {
              if (key === 'COOKIE_DOMAIN') return '';
              if (key === 'COOKIE_SECURE') return false;
              if (key === 'COOKIE_SAME_SITE') return 'lax';
              throw new Error(`Missing config ${key}`);
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  const fakeUser = (overrides: Partial<User> = {}): User =>
    ({
      id: '01TESTUSER',
      email: 'test@example.com',
      first_name: 'Jane',
      last_name: 'Doe',
      email_verified: true,
      preferred_language: 'en',
      time_zone: 'Europe/Stockholm',
      created_at: new Date('2024-01-01T00:00:00.000Z'),
      updated_at: new Date('2024-01-01T00:00:00.000Z'),
      generateId: jest.fn(),
      ...overrides,
    }) as User;

  it('getMe returns the current user DTO', async () => {
    usersService.findByIdOrFail.mockResolvedValue(fakeUser());

    const result = await controller.getMe('01TESTUSER');

    expect(usersService.findByIdOrFail).toHaveBeenCalledWith('01TESTUSER');
    expect(result).toBeInstanceOf(UserResponseDto);
    expect(result.firstName).toBe('Jane');
  });

  it('updateMe trims and returns the updated profile DTO', async () => {
    usersService.updateProfile.mockResolvedValue(
      fakeUser({ first_name: 'Ada', last_name: 'Lovelace' }),
    );

    const result = await controller.updateMe('01TESTUSER', {
      firstName: 'Ada',
      lastName: 'Lovelace',
    });

    expect(usersService.updateProfile).toHaveBeenCalledWith('01TESTUSER', {
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    expect(result.firstName).toBe('Ada');
    expect(result.lastName).toBe('Lovelace');
  });

  it('surfaces not found errors from the service', async () => {
    usersService.findByIdOrFail.mockRejectedValue(
      new NotFoundException('User not found'),
    );

    await expect(controller.getMe('missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('updateLanguage returns the updated user DTO', async () => {
    const res = mockRes();
    usersService.updatePreferredLanguage.mockResolvedValue(
      fakeUser({ preferred_language: 'sv' }),
    );

    const result = await controller.updateLanguage(
      '01TESTUSER',
      {
        preferredLanguage: 'sv',
      },
      res as never,
    );

    expect(usersService.updatePreferredLanguage).toHaveBeenCalledWith(
      '01TESTUSER',
      'sv',
    );
    expect(result.preferredLanguage).toBe('sv');
    expect(res.cookie).toHaveBeenCalledWith(
      'NEXT_LOCALE',
      'sv',
      expect.objectContaining({
        httpOnly: false,
        path: '/',
      }),
    );
  });

  it('updateTimeZone returns the updated user DTO', async () => {
    usersService.updateTimeZone.mockResolvedValue(
      fakeUser({ time_zone: 'America/New_York' }),
    );

    const result = await controller.updateTimeZone('01TESTUSER', {
      timeZone: 'America/New_York',
    });

    expect(usersService.updateTimeZone).toHaveBeenCalledWith(
      '01TESTUSER',
      'America/New_York',
    );
    expect(result.timeZone).toBe('America/New_York');
  });

  it('rejects unsupported explicit timezones', async () => {
    usersService.updateTimeZone.mockRejectedValue(
      new BadRequestException('validation.timeZone.unsupported'),
    );

    await expect(
      controller.updateTimeZone('01TESTUSER', {
        timeZone: '+01:00',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(usersService.updateTimeZone).toHaveBeenCalledWith(
      '01TESTUSER',
      '+01:00',
    );
  });
});

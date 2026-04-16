import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';

const mockUsersService = () => ({
  findByIdOrFail: jest.fn(),
  updateProfile: jest.fn(),
});

describe('UsersController', () => {
  let controller: UsersController;
  let usersService: ReturnType<typeof mockUsersService>;

  beforeEach(async () => {
    usersService = mockUsersService();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersService }],
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
});

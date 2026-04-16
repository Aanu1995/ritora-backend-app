import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';

const mockRepository = () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  createQueryBuilder: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
});

describe('UsersService', () => {
  let service: UsersService;
  let repo: jest.Mocked<Repository<User>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useFactory: mockRepository },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    repo = module.get(getRepositoryToken(User));
  });

  describe('findByEmail', () => {
    it('finds a user by lowercase email', async () => {
      const user = { id: '01', email: 'test@example.com' } as User;
      repo.findOne.mockResolvedValue(user);

      const result = await service.findByEmail('Test@Example.COM');

      expect(repo.findOne).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
      expect(result).toEqual(user);
    });

    it('returns null when user not found', async () => {
      repo.findOne.mockResolvedValue(null);

      const result = await service.findByEmail('missing@example.com');

      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('finds a user by id', async () => {
      const user = { id: '01' } as User;
      repo.findOne.mockResolvedValue(user);

      const result = await service.findById('01');

      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: '01' } });
      expect(result).toEqual(user);
    });
  });

  describe('findByIdOrFail', () => {
    it('returns the user when found', async () => {
      const user = { id: '01' } as User;
      repo.findOne.mockResolvedValue(user);

      const result = await service.findByIdOrFail('01');

      expect(result).toEqual(user);
    });

    it('throws when the user does not exist', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.findByIdOrFail('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByEmailForAuth', () => {
    it('loads the password hash for authentication checks', async () => {
      const user = { id: '01', email: 'test@example.com' } as User;
      const getOne = jest.fn().mockResolvedValue(user);
      const where = jest.fn().mockReturnValue({ getOne });
      const addSelect = jest.fn().mockReturnValue({ where });
      repo.createQueryBuilder.mockReturnValue({ addSelect } as never);

      const result = await service.findByEmailForAuth('Test@Example.COM');

      expect(repo.createQueryBuilder).toHaveBeenCalledWith('user');
      expect(addSelect).toHaveBeenCalledWith('user.password_hash');
      expect(where).toHaveBeenCalledWith('LOWER(user.email) = :email', {
        email: 'test@example.com',
      });
      expect(result).toEqual(user);
    });
  });

  describe('findByIdForAuth', () => {
    it('loads the password hash for password confirmation checks', async () => {
      const user = { id: '01' } as User;
      const getOne = jest.fn().mockResolvedValue(user);
      const where = jest.fn().mockReturnValue({ getOne });
      const addSelect = jest.fn().mockReturnValue({ where });
      repo.createQueryBuilder.mockReturnValue({ addSelect } as never);

      const result = await service.findByIdForAuth('01');

      expect(repo.createQueryBuilder).toHaveBeenCalledWith('user');
      expect(addSelect).toHaveBeenCalledWith('user.password_hash');
      expect(where).toHaveBeenCalledWith('user.id = :id', { id: '01' });
      expect(result).toEqual(user);
    });
  });

  describe('create', () => {
    it('normalizes email to lowercase and trims', async () => {
      const user = {
        email: 'test@example.com',
        first_name: 'Jane',
      } as User;
      repo.create.mockReturnValue(user);
      repo.save.mockResolvedValue(user);

      const result = await service.create({
        email: '  Test@Example.COM  ',
        password_hash: 'hashed',
        first_name: 'Jane',
        last_name: 'Doe',
        preferred_language: 'en',
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'test@example.com' }),
      );
      expect(result).toEqual(user);
    });
  });

  describe('update', () => {
    it('merges and saves partial data', async () => {
      const existing = {
        id: '01',
        email: 'test@example.com',
        email_verified: false,
      } as User;
      const updated = { ...existing, email_verified: true } as User;

      repo.findOne.mockResolvedValue(existing);
      repo.save.mockResolvedValue(updated);

      const result = await service.update('01', { email_verified: true });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ email_verified: true }),
      );
      expect(result).toEqual(updated);
    });

    it('throws when updating a missing user', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.update('missing', { email_verified: true }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('trims first and last name before saving', async () => {
      const existing = {
        id: '01',
        first_name: 'Jane',
        last_name: 'Doe',
      } as User;
      const updated = {
        ...existing,
        first_name: 'Ada',
        last_name: 'Lovelace',
      } as User;

      repo.findOne.mockResolvedValue(existing);
      repo.save.mockResolvedValue(updated);

      const result = await service.updateProfile('01', {
        firstName: '  Ada  ',
        lastName: '  Lovelace  ',
      });

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          first_name: 'Ada',
          last_name: 'Lovelace',
        }),
      );
      expect(result).toEqual(updated);
    });
  });

  describe('findByVerificationTokenHash', () => {
    it('finds a user by verification token hash', async () => {
      const user = { id: '01' } as User;
      repo.findOne.mockResolvedValue(user);

      const result = await service.findByVerificationTokenHash('hash-123');

      expect(repo.findOne).toHaveBeenCalledWith({
        where: { email_verification_token_hash: 'hash-123' },
      });
      expect(result).toEqual(user);
    });
  });

  describe('findByResetTokenHash', () => {
    it('finds a user by password reset token hash', async () => {
      const user = { id: '01' } as User;
      repo.findOne.mockResolvedValue(user);

      const result = await service.findByResetTokenHash('hash-456');

      expect(repo.findOne).toHaveBeenCalledWith({
        where: { password_reset_token_hash: 'hash-456' },
      });
      expect(result).toEqual(user);
    });
  });

  describe('remove', () => {
    it('deletes a user by entity', async () => {
      const user = { id: '01' } as User;
      repo.findOne.mockResolvedValue(user);
      repo.remove.mockResolvedValue(user);

      await service.remove('01');

      expect(repo.remove).toHaveBeenCalledWith(user);
    });

    it('throws when removing a missing user', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

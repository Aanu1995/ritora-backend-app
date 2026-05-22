import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
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
  manager: createMockEntityManager(),
});

function createMockEntityManager() {
  const manager = {
    delete: jest.fn(),
    remove: jest.fn(),
    transaction: jest.fn(),
  };
  manager.transaction.mockImplementation(
    async (work: (transactionManager: typeof manager) => Promise<void>) =>
      work(manager),
  );
  return manager;
}

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
    it('finds a user by canonical email identity', async () => {
      const user = { id: '01', email: 'test@example.com' } as User;
      repo.findOne.mockResolvedValue(user);

      const result = await service.findByEmail('Test+promo@Example.COM');

      expect(repo.findOne).toHaveBeenCalledWith({
        where: { canonical_email: 'test@example.com' },
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

      const result = await service.findByEmailForAuth(
        'Test.User+promo@Gmail.COM',
      );

      expect(repo.createQueryBuilder).toHaveBeenCalledWith('user');
      expect(addSelect).toHaveBeenCalledWith([
        'user.password_hash',
        'user.account_deletion_confirm_token_hash',
      ]);
      expect(where).toHaveBeenCalledWith(
        'user.canonical_email = :canonicalEmail',
        {
          canonicalEmail: 'testuser@gmail.com',
        },
      );
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
      expect(addSelect).toHaveBeenCalledWith([
        'user.password_hash',
        'user.account_deletion_confirm_token_hash',
      ]);
      expect(where).toHaveBeenCalledWith('user.id = :id', { id: '01' });
      expect(result).toEqual(user);
    });
  });

  describe('create', () => {
    it('stores normalized and canonical email identities', async () => {
      const user = {
        email: 'test@example.com',
        canonical_email: 'test@example.com',
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
        expect.objectContaining({
          email: 'test@example.com',
          canonical_email: 'test@example.com',
        }),
      );
      expect(result).toEqual(user);
    });

    it('maps email identity unique violations to a conflict', async () => {
      repo.create.mockReturnValue({ email: 'test@example.com' } as User);
      repo.save.mockRejectedValue({
        code: '23505',
        constraint: 'idx_users_canonical_email',
      });

      await expect(
        service.create({
          email: 'test+promo@example.com',
          password_hash: 'hashed',
          first_name: 'Jane',
          last_name: 'Doe',
          preferred_language: 'en',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('createGoogleUser', () => {
    it('stores the canonical email identity for Google users', async () => {
      const user = {
        email: 'john.doe+promo@gmail.com',
        canonical_email: 'johndoe@gmail.com',
        google_subject: 'google-subject',
      } as User;
      repo.create.mockReturnValue(user);
      repo.save.mockResolvedValue(user);

      const result = await service.createGoogleUser({
        email: 'John.Doe+promo@Gmail.COM',
        google_subject: 'google-subject',
        first_name: 'John',
        last_name: 'Doe',
        preferred_language: 'en',
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'john.doe+promo@gmail.com',
          canonical_email: 'johndoe@gmail.com',
        }),
      );
      expect(result).toEqual(user);
    });
  });

  describe('createAppleUser', () => {
    it('stores the canonical email identity for Apple users', async () => {
      const user = {
        email: 'jane+promo@example.com',
        canonical_email: 'jane@example.com',
        apple_subject: 'apple-subject',
      } as User;
      repo.create.mockReturnValue(user);
      repo.save.mockResolvedValue(user);

      const result = await service.createAppleUser({
        email: 'Jane+promo@Example.COM',
        apple_subject: 'apple-subject',
        first_name: 'Jane',
        last_name: 'Doe',
        preferred_language: 'en',
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'jane+promo@example.com',
          canonical_email: 'jane@example.com',
        }),
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

  describe('clearExpiredAccountRestriction', () => {
    it('clears expired account restriction fields without deleting audit history', async () => {
      const execute = jest.fn().mockResolvedValue({ affected: 1 });
      const queryBuilder = {
        andWhere: jest.fn(),
        execute,
        set: jest.fn(),
        update: jest.fn(),
        where: jest.fn(),
      };
      queryBuilder.update.mockReturnValue(queryBuilder);
      queryBuilder.set.mockReturnValue(queryBuilder);
      queryBuilder.where.mockReturnValue(queryBuilder);
      queryBuilder.andWhere.mockReturnValue(queryBuilder);
      repo.createQueryBuilder.mockReturnValue(queryBuilder as never);
      const now = new Date('2026-05-21T10:00:00.000Z');

      const cleared = await service.clearExpiredAccountRestriction(
        '01USER',
        now,
      );

      expect(cleared).toBe(true);
      expect(queryBuilder.update).toHaveBeenCalledWith(User);
      expect(queryBuilder.set).toHaveBeenCalledWith({
        account_restricted_at: null,
        account_restricted_by_admin_id: null,
        account_restriction_capabilities: null,
        account_restriction_expires_at: null,
        account_restriction_internal_note: null,
        account_restriction_reason: null,
        account_restriction_user_message: null,
      });
      expect(queryBuilder.where).toHaveBeenCalledWith('id = :id', {
        id: '01USER',
      });
      expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(
        1,
        'account_restricted_at IS NOT NULL',
      );
      expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(
        2,
        'account_restriction_expires_at IS NOT NULL',
      );
      expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(
        3,
        'account_restriction_expires_at <= :now',
        { now },
      );
      expect(execute).toHaveBeenCalled();
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

  describe('updatePreferredLanguage', () => {
    it('normalizes the preferred language before saving', async () => {
      const existing = {
        id: '01',
        preferred_language: 'en',
      } as User;
      const updated = {
        ...existing,
        preferred_language: 'sv',
      } as User;

      repo.findOne.mockResolvedValue(existing);
      repo.save.mockResolvedValue(updated);

      const result = await service.updatePreferredLanguage('01', '  SV  ');

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          preferred_language: 'sv',
        }),
      );
      expect(result).toEqual(updated);
    });
  });

  describe('updateTimeZone', () => {
    it('trims the timezone before saving', async () => {
      const existing = {
        id: '01',
        time_zone: null,
      } as User;
      const updated = {
        ...existing,
        time_zone: 'Europe/Stockholm',
      } as User;

      repo.findOne.mockResolvedValue(existing);
      repo.save.mockResolvedValue(updated);

      const result = await service.updateTimeZone('01', ' Europe/Stockholm ');

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          time_zone: 'Europe/Stockholm',
        }),
      );
      expect(result).toEqual(updated);
    });

    it('rejects unsupported timezones', async () => {
      await expect(service.updateTimeZone('01', '+01:00')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('linkGoogleSubject', () => {
    it('links the Google subject only when the account is not already linked', async () => {
      const updated = {
        id: '01',
        google_subject: 'google-subject',
        email_verified: true,
      } as User;
      const execute = jest.fn().mockResolvedValue({ affected: 1 });
      const andWhere = jest.fn().mockReturnValue({ execute });
      const where = jest.fn().mockReturnValue({ andWhere });
      const set = jest.fn().mockReturnValue({ where });
      const update = jest.fn().mockReturnValue({ set });
      repo.createQueryBuilder.mockReturnValue({ update } as never);
      repo.findOne.mockResolvedValue(updated);

      const result = await service.linkGoogleSubject('01', 'google-subject');

      expect(update).toHaveBeenCalledWith(User);
      expect(set).toHaveBeenCalledWith({
        google_subject: 'google-subject',
        email_verified: true,
        email_verification_token_hash: null,
        email_verification_expires: null,
      });
      expect(where).toHaveBeenCalledWith('id = :id', { id: '01' });
      expect(andWhere).toHaveBeenCalledWith(
        '(google_subject IS NULL OR google_subject = :googleSubject)',
        { googleSubject: 'google-subject' },
      );
      expect(result).toEqual(updated);
    });

    it('rejects linking when another Google subject won the race', async () => {
      const execute = jest.fn().mockResolvedValue({ affected: 0 });
      const andWhere = jest.fn().mockReturnValue({ execute });
      const where = jest.fn().mockReturnValue({ andWhere });
      const set = jest.fn().mockReturnValue({ where });
      const update = jest.fn().mockReturnValue({ set });
      repo.createQueryBuilder.mockReturnValue({ update } as never);

      await expect(
        service.linkGoogleSubject('01', 'google-subject'),
      ).rejects.toThrow(ConflictException);

      expect(repo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('linkAppleSubject', () => {
    it('links the Apple subject only when the account is not already linked', async () => {
      const updated = {
        id: '01',
        apple_subject: 'apple-subject',
        email_verified: true,
      } as User;
      const execute = jest.fn().mockResolvedValue({ affected: 1 });
      const andWhere = jest.fn().mockReturnValue({ execute });
      const where = jest.fn().mockReturnValue({ andWhere });
      const set = jest.fn().mockReturnValue({ where });
      const update = jest.fn().mockReturnValue({ set });
      repo.createQueryBuilder.mockReturnValue({ update } as never);
      repo.findOne.mockResolvedValue(updated);

      const result = await service.linkAppleSubject('01', 'apple-subject');

      expect(update).toHaveBeenCalledWith(User);
      expect(set).toHaveBeenCalledWith({
        apple_subject: 'apple-subject',
        email_verified: true,
        email_verification_token_hash: null,
        email_verification_expires: null,
      });
      expect(where).toHaveBeenCalledWith('id = :id', { id: '01' });
      expect(andWhere).toHaveBeenCalledWith(
        '(apple_subject IS NULL OR apple_subject = :appleSubject)',
        { appleSubject: 'apple-subject' },
      );
      expect(result).toEqual(updated);
    });

    it('rejects linking when another Apple subject won the race', async () => {
      const execute = jest.fn().mockResolvedValue({ affected: 0 });
      const andWhere = jest.fn().mockReturnValue({ execute });
      const where = jest.fn().mockReturnValue({ andWhere });
      const set = jest.fn().mockReturnValue({ where });
      const update = jest.fn().mockReturnValue({ set });
      repo.createQueryBuilder.mockReturnValue({ update } as never);

      await expect(
        service.linkAppleSubject('01', 'apple-subject'),
      ).rejects.toThrow(ConflictException);

      expect(repo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('captureTimeZoneIfMissing', () => {
    it('persists the timezone when the user does not have one yet', async () => {
      const updated = { id: '01', time_zone: 'Europe/Stockholm' } as User;
      const execute = jest.fn().mockResolvedValue({ affected: 1 });
      const andWhere = jest.fn().mockReturnValue({ execute });
      const where = jest.fn().mockReturnValue({ andWhere });
      const set = jest.fn().mockReturnValue({ where });
      const update = jest.fn().mockReturnValue({ set });
      repo.createQueryBuilder.mockReturnValue({ update } as never);
      repo.findOne.mockResolvedValue(updated);

      const result = await service.captureTimeZoneIfMissing(
        '01',
        'Europe/Stockholm',
      );

      expect(update).toHaveBeenCalledWith(User);
      expect(set).toHaveBeenCalledWith({ time_zone: 'Europe/Stockholm' });
      expect(where).toHaveBeenCalledWith('id = :id', { id: '01' });
      expect(andWhere).toHaveBeenCalledWith('time_zone IS NULL');
      expect(result).toEqual(updated);
    });

    it('does not overwrite an existing timezone', async () => {
      const existing = { id: '01', time_zone: 'America/New_York' } as User;
      const execute = jest.fn().mockResolvedValue({ affected: 0 });
      const andWhere = jest.fn().mockReturnValue({ execute });
      const where = jest.fn().mockReturnValue({ andWhere });
      const set = jest.fn().mockReturnValue({ where });
      const update = jest.fn().mockReturnValue({ set });
      repo.createQueryBuilder.mockReturnValue({ update } as never);
      repo.findOne.mockResolvedValue(existing);

      const result = await service.captureTimeZoneIfMissing(
        '01',
        'Europe/Stockholm',
      );

      expect(set).toHaveBeenCalledWith({ time_zone: 'Europe/Stockholm' });
      expect(result).toEqual(existing);
    });

    it('rejects unsupported timezones before attempting capture', async () => {
      await expect(
        service.captureTimeZoneIfMissing('01', '+01:00'),
      ).rejects.toThrow(BadRequestException);

      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
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

  describe('markAccountDeletionCancellationComplete', () => {
    it('atomically consumes a pending cancellation token', async () => {
      const execute = jest.fn().mockResolvedValue({ affected: 1 });
      const builder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute,
      };
      repo.createQueryBuilder.mockReturnValue(builder as never);
      const cancelledAt = new Date('2026-05-15T12:00:00.000Z');

      const result = await service.markAccountDeletionCancellationComplete(
        '01',
        'token-hash',
        cancelledAt,
      );

      expect(result).toBe(true);
      expect(builder.update).toHaveBeenCalledWith(User);
      expect(builder.set).toHaveBeenCalledWith({
        account_deletion_requested_at: null,
        account_deletion_scheduled_for: null,
        account_deletion_cancel_token_hash: 'token-hash',
        account_deletion_cancel_token_consumed_at: cancelledAt,
        account_deletion_confirm_token_hash: null,
        account_deletion_confirm_expires: null,
      });
      expect(builder.where).toHaveBeenCalledWith('id = :id', { id: '01' });
      expect(builder.andWhere).toHaveBeenNthCalledWith(
        1,
        'account_deletion_cancel_token_hash = :cancelTokenHash',
        { cancelTokenHash: 'token-hash' },
      );
      expect(builder.andWhere).toHaveBeenNthCalledWith(
        2,
        'account_deletion_scheduled_for IS NOT NULL',
      );
    });

    it('reports a duplicate or already-cancelled token as not changed', async () => {
      const execute = jest.fn().mockResolvedValue({ affected: 0 });
      const builder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute,
      };
      repo.createQueryBuilder.mockReturnValue(builder as never);

      const result = await service.markAccountDeletionCancellationComplete(
        '01',
        'token-hash',
        new Date('2026-05-15T12:00:00.000Z'),
      );

      expect(result).toBe(false);
    });
  });

  describe('clearExpiredAccountDeletionCancellationReceipts', () => {
    it('removes consumed token hashes after the retry window', async () => {
      const execute = jest.fn().mockResolvedValue({ affected: 2 });
      const builder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute,
      };
      repo.createQueryBuilder.mockReturnValue(builder as never);
      const olderThan = new Date('2026-05-14T12:00:00.000Z');

      const result =
        await service.clearExpiredAccountDeletionCancellationReceipts(
          olderThan,
        );

      expect(result).toBe(2);
      expect(builder.update).toHaveBeenCalledWith(User);
      expect(builder.set).toHaveBeenCalledWith({
        account_deletion_cancel_token_hash: null,
        account_deletion_cancel_token_consumed_at: null,
      });
      expect(builder.where).toHaveBeenCalledWith(
        'account_deletion_scheduled_for IS NULL',
      );
      expect(builder.andWhere).toHaveBeenCalledWith(
        'account_deletion_cancel_token_consumed_at <= :olderThan',
        { olderThan },
      );
    });
  });

  describe('remove', () => {
    it('deletes explicit user-owned rows before deleting the user entity', async () => {
      const user = { id: '01' } as User;
      const manager = repo.manager as unknown as {
        delete: jest.Mock;
        remove: jest.Mock;
      };
      repo.findOne.mockResolvedValue(user);
      manager.remove.mockResolvedValue(user);

      await service.remove('01');

      expect(manager.delete).toHaveBeenCalledWith(
        'push_notification_deliveries',
        { user_id: '01' },
      );
      expect(manager.delete).toHaveBeenCalledWith(
        'skin_journal_media_deletion_jobs',
        { user_id: '01' },
      );
      expect(manager.remove).toHaveBeenCalledWith(User, user);
    });

    it('throws when removing a missing user', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

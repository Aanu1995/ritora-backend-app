import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import {
  buildTimeZonePatch,
  canonicalizeEmailForIdentity,
  normalizeEmail,
  normalizePreferredLanguage,
  normalizeProfileName,
} from './users.service.utils';

type AuthUserLookup = {
  clause: string;
  params: Record<string, string>;
};

type DatabaseError = {
  code?: unknown;
  constraint?: unknown;
};

const POSTGRES_UNIQUE_VIOLATION_CODE = '23505';
const EMAIL_IDENTITY_UNIQUE_CONSTRAINTS = new Set([
  'idx_users_canonical_email',
  'idx_users_email_lower',
]);
const EMAIL_IN_USE_MESSAGE = 'Email already in use';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { canonical_email: canonicalizeEmailForIdentity(email) },
    });
  }

  async findByEmailForAuth(email: string): Promise<User | null> {
    return this.findForAuth({
      clause: 'user.canonical_email = :canonicalEmail',
      params: { canonicalEmail: canonicalizeEmailForIdentity(email) },
    });
  }

  async findByGoogleSubject(googleSubject: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { google_subject: googleSubject },
    });
  }

  async findByAppleSubject(appleSubject: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { apple_subject: appleSubject },
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  async findByIdOrFail(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async findByIdForAuth(id: string): Promise<User | null> {
    return this.findForAuth({
      clause: 'user.id = :id',
      params: { id },
    });
  }

  async create(data: {
    email: string;
    password_hash: string | null;
    first_name: string;
    last_name: string;
    preferred_language: string;
    email_verification_token_hash?: string;
    email_verification_expires?: Date;
  }): Promise<User> {
    return this.saveCreatedUser(
      this.usersRepository.create({
        ...data,
        email: normalizeEmail(data.email),
        canonical_email: canonicalizeEmailForIdentity(data.email),
      }),
    );
  }

  async createGoogleUser(data: {
    email: string;
    google_subject: string;
    first_name: string;
    last_name: string;
    preferred_language: string;
  }): Promise<User> {
    return this.saveCreatedUser(
      this.usersRepository.create({
        ...data,
        email: normalizeEmail(data.email),
        canonical_email: canonicalizeEmailForIdentity(data.email),
        password_hash: null,
        email_verified: true,
        email_verification_token_hash: null,
        email_verification_expires: null,
      }),
    );
  }

  async createAppleUser(data: {
    email: string;
    apple_subject: string;
    first_name: string;
    last_name: string;
    preferred_language: string;
  }): Promise<User> {
    return this.saveCreatedUser(
      this.usersRepository.create({
        ...data,
        email: normalizeEmail(data.email),
        canonical_email: canonicalizeEmailForIdentity(data.email),
        password_hash: null,
        email_verified: true,
        email_verification_token_hash: null,
        email_verification_expires: null,
      }),
    );
  }

  async update(id: string, data: Partial<User>): Promise<User> {
    const user = await this.findByIdOrFail(id);
    return this.saveUserPatch(user, data);
  }

  async updateProfile(
    id: string,
    data: { firstName: string; lastName: string },
  ): Promise<User> {
    return this.update(id, {
      first_name: normalizeProfileName(data.firstName),
      last_name: normalizeProfileName(data.lastName),
    });
  }

  async updatePreferredLanguage(
    id: string,
    preferredLanguage: string,
  ): Promise<User> {
    return this.update(id, {
      preferred_language: normalizePreferredLanguage(preferredLanguage),
    });
  }

  async updateTimeZone(id: string, timeZone: string): Promise<User> {
    return this.update(id, buildTimeZonePatch(timeZone));
  }

  async linkGoogleSubject(id: string, googleSubject: string): Promise<User> {
    const result = await this.usersRepository
      .createQueryBuilder()
      .update(User)
      .set({
        google_subject: googleSubject,
        email_verified: true,
        email_verification_token_hash: null,
        email_verification_expires: null,
      })
      .where('id = :id', { id })
      .andWhere('(google_subject IS NULL OR google_subject = :googleSubject)', {
        googleSubject,
      })
      .execute();

    if (result.affected !== 1) {
      throw new ConflictException('Email already linked to Google');
    }

    return this.findByIdOrFail(id);
  }

  async linkAppleSubject(id: string, appleSubject: string): Promise<User> {
    const result = await this.usersRepository
      .createQueryBuilder()
      .update(User)
      .set({
        apple_subject: appleSubject,
        email_verified: true,
        email_verification_token_hash: null,
        email_verification_expires: null,
      })
      .where('id = :id', { id })
      .andWhere('(apple_subject IS NULL OR apple_subject = :appleSubject)', {
        appleSubject,
      })
      .execute();

    if (result.affected !== 1) {
      throw new ConflictException('Email already linked to Apple');
    }

    return this.findByIdOrFail(id);
  }

  async captureTimeZoneIfMissing(id: string, timeZone: string): Promise<User> {
    const timeZonePatch = buildTimeZonePatch(timeZone);

    await this.usersRepository
      .createQueryBuilder()
      .update(User)
      .set(timeZonePatch)
      .where('id = :id', { id })
      .andWhere('time_zone IS NULL')
      .execute();

    return this.findByIdOrFail(id);
  }

  async findByVerificationTokenHash(hash: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { email_verification_token_hash: hash },
    });
  }

  async findByResetTokenHash(hash: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { password_reset_token_hash: hash },
    });
  }

  async remove(id: string): Promise<void> {
    const user = await this.findByIdOrFail(id);
    await this.usersRepository.remove(user);
  }

  private findForAuth({
    clause,
    params,
  }: AuthUserLookup): Promise<User | null> {
    return this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.password_hash')
      .where(clause, params)
      .getOne();
  }

  private saveUserPatch(user: User, data: Partial<User>): Promise<User> {
    Object.assign(user, data);
    return this.usersRepository.save(user);
  }

  private async saveCreatedUser(user: User): Promise<User> {
    try {
      return await this.usersRepository.save(user);
    } catch (error: unknown) {
      if (isEmailIdentityUniqueViolation(error)) {
        throw new ConflictException(EMAIL_IN_USE_MESSAGE);
      }

      throw error;
    }
  }
}

function isEmailIdentityUniqueViolation(error: unknown): boolean {
  if (!isDatabaseError(error)) {
    return false;
  }

  return (
    error.code === POSTGRES_UNIQUE_VIOLATION_CODE &&
    typeof error.constraint === 'string' &&
    EMAIL_IDENTITY_UNIQUE_CONSTRAINTS.has(error.constraint)
  );
}

function isDatabaseError(error: unknown): error is DatabaseError {
  return typeof error === 'object' && error !== null;
}

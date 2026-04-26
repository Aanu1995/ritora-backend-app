import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import {
  buildTimeZonePatch,
  normalizeEmail,
  normalizePreferredLanguage,
  normalizeProfileName,
} from './users.service.utils';

type AuthUserLookup = {
  clause: string;
  params: Record<string, string>;
};

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { email: normalizeEmail(email) },
    });
  }

  async findByEmailForAuth(email: string): Promise<User | null> {
    return this.findForAuth({
      clause: 'LOWER(user.email) = :email',
      params: { email: normalizeEmail(email) },
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
    password_hash: string;
    first_name: string;
    last_name: string;
    preferred_language: string;
    email_verification_token_hash?: string;
    email_verification_expires?: Date;
  }): Promise<User> {
    return this.usersRepository.save(
      this.usersRepository.create({
        ...data,
        email: normalizeEmail(data.email),
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
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { email: email.toLowerCase().trim() },
    });
  }

  async findByEmailForAuth(email: string): Promise<User | null> {
    return this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.password_hash')
      .where('LOWER(user.email) = :email', {
        email: email.toLowerCase().trim(),
      })
      .getOne();
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  async findByIdForAuth(id: string): Promise<User | null> {
    return this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.password_hash')
      .where('user.id = :id', { id })
      .getOne();
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
    const user = this.usersRepository.create({
      ...data,
      email: data.email.toLowerCase().trim(),
    });
    return this.usersRepository.save(user);
  }

  async update(id: string, data: Partial<User>): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    Object.assign(user, data);
    return this.usersRepository.save(user);
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
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    await this.usersRepository.remove(user);
  }
}

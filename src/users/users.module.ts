import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UserConsent } from './entities/user-consent.entity';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserConsent])],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}

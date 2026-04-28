import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersController } from './users.controller';
import { User } from './entities/user.entity';
import { UserConsent } from './entities/user-consent.entity';
import { UserDataAccessLog } from './entities/user-data-access-log.entity';
import { UserDataAccessLogService } from './user-data-access-log.service';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserConsent, UserDataAccessLog])],
  controllers: [UsersController],
  providers: [UsersService, UserDataAccessLogService],
  exports: [UsersService, UserDataAccessLogService],
})
export class UsersModule {}

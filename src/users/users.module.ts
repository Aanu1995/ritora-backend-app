import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformGlobalRestrictionsModule } from '../platform-controls/platform-global-restrictions.module';
import { UsersController } from './users.controller';
import { User } from './entities/user.entity';
import { UserConsent } from './entities/user-consent.entity';
import { UserDataAccessLog } from './entities/user-data-access-log.entity';
import { UserDataAccessLogService } from './user-data-access-log.service';
import { UserCapabilitySnapshotService } from './user-capability-snapshot.service';
import { UserRestrictionEnforcementService } from './user-restriction-enforcement.service';
import { UserRestrictionGuard } from './user-restriction.guard';
import { UsersService } from './users.service';

@Module({
  imports: [
    PlatformGlobalRestrictionsModule,
    TypeOrmModule.forFeature([User, UserConsent, UserDataAccessLog]),
  ],
  controllers: [UsersController],
  providers: [
    UsersService,
    UserDataAccessLogService,
    UserCapabilitySnapshotService,
    UserRestrictionEnforcementService,
    UserRestrictionGuard,
  ],
  exports: [
    UsersService,
    UserDataAccessLogService,
    UserCapabilitySnapshotService,
    UserRestrictionEnforcementService,
    UserRestrictionGuard,
  ],
})
export class UsersModule {}

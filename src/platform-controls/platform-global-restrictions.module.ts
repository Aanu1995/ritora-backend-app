import { Module } from '@nestjs/common';
import { PlatformGlobalRestrictionsService } from './platform-global-restrictions.service';

@Module({
  providers: [PlatformGlobalRestrictionsService],
  exports: [PlatformGlobalRestrictionsService],
})
export class PlatformGlobalRestrictionsModule {}

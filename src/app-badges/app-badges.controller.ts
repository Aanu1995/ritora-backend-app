import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { UserCapabilitiesDto } from '../users/dto/user-capabilities.dto';
import { UserCapabilitySnapshotService } from '../users/user-capability-snapshot.service';
import {
  APP_BADGES_CONTROLLER_PATH,
  APP_CAPABILITIES_PATH,
  APP_NAV_BADGES_PATH,
} from './app-badges.constants';
import { AppBadgesService } from './app-badges.service';
import { AppNavBadgesResponseDto } from './dto/app-nav-badges-response.dto';

@ApiTags('app-badges')
@Controller(APP_BADGES_CONTROLLER_PATH)
export class AppBadgesController {
  constructor(
    private readonly service: AppBadgesService,
    private readonly capabilitySnapshot: UserCapabilitySnapshotService,
  ) {}

  @Public()
  @Get(APP_CAPABILITIES_PATH)
  @ApiOkResponse({ type: UserCapabilitiesDto })
  async getCapabilities(): Promise<UserCapabilitiesDto> {
    return this.capabilitySnapshot.buildPublicPlatformCapabilities();
  }

  @Get(APP_NAV_BADGES_PATH)
  @ApiOkResponse({ type: AppNavBadgesResponseDto })
  async getNavBadges(
    @CurrentUser('id') userId: string,
  ): Promise<AppNavBadgesResponseDto> {
    return this.service.getNavBadges(userId);
  }
}

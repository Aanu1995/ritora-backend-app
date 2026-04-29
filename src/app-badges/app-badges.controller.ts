import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  APP_BADGES_CONTROLLER_PATH,
  APP_NAV_BADGES_PATH,
} from './app-badges.constants';
import { AppBadgesService } from './app-badges.service';
import { AppNavBadgesResponseDto } from './dto/app-nav-badges-response.dto';

@ApiTags('app-badges')
@Controller(APP_BADGES_CONTROLLER_PATH)
export class AppBadgesController {
  constructor(private readonly service: AppBadgesService) {}

  @Get(APP_NAV_BADGES_PATH)
  @ApiOkResponse({ type: AppNavBadgesResponseDto })
  async getNavBadges(
    @CurrentUser('id') userId: string,
  ): Promise<AppNavBadgesResponseDto> {
    return this.service.getNavBadges(userId);
  }
}

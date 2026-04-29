import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import {
  PreferencesResponseDto,
  UpdatePreferencesDto,
} from './dto/notification-preference.dto';
import { NotificationListQueryDto } from './dto/notification-list-query.dto';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  async list(
    @CurrentUser('id') userId: string,
    @Query() query: NotificationListQueryDto,
  ) {
    return this.service.list(userId, query);
  }

  @Post(':id/read')
  async markRead(@CurrentUser('id') userId: string, @Param('id') id: string) {
    await this.service.markRead(userId, id);
    return { ok: true };
  }

  @Post('read-all')
  async markAllRead(@CurrentUser('id') userId: string) {
    await this.service.markAllRead(userId);
    return { ok: true };
  }

  @Get('preferences')
  @ApiOkResponse({ type: PreferencesResponseDto })
  async getPreferences(@CurrentUser('id') userId: string) {
    return this.service.getPreferences(userId);
  }

  @Patch('preferences')
  @ApiOkResponse({ type: PreferencesResponseDto })
  async updatePreferences(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdatePreferencesDto,
  ) {
    return this.service.updatePreferences(userId, dto);
  }
}

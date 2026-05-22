import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { ApplicationTrackingService } from './application-tracking.service';
import {
  EditApplicationDto,
  RecordApplicationDto,
} from './dto/application-log-item.dto';
import {
  ApplicationTrackingAnalyticsDto,
  ApplicationLogResponseDto,
  ApplicationLogVersionResponseDto,
} from './dto/application-log-response.dto';

@ApiBearerAuth()
@ApiTags('application-logs')
@Controller('application-logs')
export class ApplicationLogsController {
  constructor(
    private readonly applicationTracking: ApplicationTrackingService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record what was actually applied for a slot' })
  async record(
    @CurrentUser() user: User,
    @Body() body: RecordApplicationDto,
  ): Promise<ApplicationLogResponseDto> {
    return this.applicationTracking.record(user, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit an existing application record' })
  async edit(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: EditApplicationDto,
  ): Promise<ApplicationLogResponseDto> {
    return this.applicationTracking.edit(user, id, body);
  }

  @Get('analytics/summary')
  @ApiOperation({ summary: 'Routine tracking analytics for suggestions' })
  async getAnalytics(
    @CurrentUser() user: User,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<ApplicationTrackingAnalyticsDto> {
    return this.applicationTracking.getAnalytics(user, { from, to });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a single application record' })
  async getOne(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<ApplicationLogResponseDto> {
    return this.applicationTracking.getOne(user, id);
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'Full version history for an application record' })
  async getVersions(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<ApplicationLogVersionResponseDto[]> {
    return this.applicationTracking.getVersions(user, id);
  }
}

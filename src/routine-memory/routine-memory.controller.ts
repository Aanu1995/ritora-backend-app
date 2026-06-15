import { Controller, Get, Query, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { readTimeZoneHeaderFromRequest } from '../common/timezone/timezone-header.utils';
import { User } from '../users/entities/user.entity';
import { RoutineMemoryResponseDto } from './dto/routine-memory-response.dto';
import { RoutineMemoryService } from './routine-memory.service';

@ApiBearerAuth()
@ApiTags('routine-memory')
@Controller('routine-memory')
export class RoutineMemoryController {
  constructor(private readonly service: RoutineMemoryService) {}

  @Get('timeline')
  @ApiOperation({
    summary:
      'Routine memory timeline connecting product use, changes, reactions, and recovery',
  })
  @ApiOkResponse({ type: RoutineMemoryResponseDto })
  async getTimeline(
    @CurrentUser() user: User,
    @Req() request: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<RoutineMemoryResponseDto> {
    return this.service.getTimeline(
      user,
      { from, to },
      new Date(),
      readTimeZoneHeaderFromRequest(request),
    );
  }
}

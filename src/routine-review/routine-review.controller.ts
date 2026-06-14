import { Controller, Get, Req } from '@nestjs/common';
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
import { RoutineReviewResponseDto } from './dto/routine-review-response.dto';
import { RoutineReviewService } from './routine-review.service';

@ApiBearerAuth()
@ApiTags('routine-review')
@Controller('routine-review')
export class RoutineReviewController {
  constructor(private readonly service: RoutineReviewService) {}

  @Get('current')
  @ApiOperation({
    summary: 'Current routine decision review based on recent skin response',
  })
  @ApiOkResponse({ type: RoutineReviewResponseDto })
  async getCurrentReview(
    @CurrentUser() user: User,
    @Req() request: Request,
  ): Promise<RoutineReviewResponseDto> {
    return this.service.getCurrentReview(
      user,
      readTimeZoneHeaderFromRequest(request),
    );
  }
}

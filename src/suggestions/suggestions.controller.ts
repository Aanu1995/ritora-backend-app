import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import {
  RegenerateSuggestionDto,
  SuggestionHistoryDayDto,
  SuggestionHistoryListQueryDto,
  SuggestionHistoryListResponseDto,
} from './dto/suggestion-history.dto';
import { SuggestionInstanceResponseDto } from './dto/suggestion-instance-response.dto';
import { TodaysSuggestionResponseDto } from './dto/todays-suggestion-response.dto';
import { SuggestionsService } from './services/suggestions.service';

@ApiBearerAuth()
@ApiTags('suggestions')
@Controller('suggestions')
export class SuggestionsController {
  constructor(private readonly suggestionsService: SuggestionsService) {}

  /**
   * Today's Suggestion page payload. The slots are returned in
   * chronological order. Slots whose visibility window has not yet opened
   * appear as `isVisible=false` so the UI can show the locked state with
   * a countdown.
   */
  @Get('today')
  @ApiOperation({ summary: "Today's slots and their suggestions" })
  async getTodaysSuggestion(
    @CurrentUser() user: User,
    @Req() request: Request,
  ): Promise<TodaysSuggestionResponseDto> {
    return this.suggestionsService.getTodaysSuggestion(
      user,
      requestTimeZone(request),
    );
  }

  @Get('history')
  @ApiOperation({ summary: 'Date-grouped suggestion history' })
  async getHistory(
    @CurrentUser() user: User,
    @Req() request: Request,
    @Query() query: SuggestionHistoryListQueryDto,
  ): Promise<SuggestionHistoryListResponseDto> {
    return this.suggestionsService.getHistory(
      user,
      requestTimeZone(request),
      query,
    );
  }

  @Get('history/:date')
  @ApiOperation({ summary: 'Single past day in suggestion history' })
  async getHistoryDay(
    @CurrentUser() user: User,
    @Req() request: Request,
    @Param('date') date: string,
  ): Promise<SuggestionHistoryDayDto> {
    return this.suggestionsService.getHistoryDay(
      user,
      requestTimeZone(request),
      date,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Single suggestion (used by the why-this drawer)' })
  async getOne(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<SuggestionInstanceResponseDto> {
    return this.suggestionsService.getSuggestion(user, id);
  }

  @Post(':id/regenerate')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Supersede the current suggestion and queue a fresh generation',
  })
  async regenerate(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: RegenerateSuggestionDto,
  ): Promise<SuggestionInstanceResponseDto> {
    return this.suggestionsService.regenerateSuggestion(user, id, body ?? {});
  }
}

function requestTimeZone(request: Request): string | null {
  const headerValue = request.header('x-time-zone');
  if (typeof headerValue !== 'string') return null;
  return headerValue.trim() || null;
}

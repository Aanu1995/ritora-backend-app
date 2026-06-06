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
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { readTimeZoneHeaderFromRequest } from '../common/timezone/timezone-header.utils';
import { User } from '../users/entities/user.entity';
import {
  RequireUnrestrictedUserCapabilities,
  UserRestrictionGuard,
} from '../users/user-restriction.guard';
import { UserRestrictionCapability } from '../users/user-restrictions';
import {
  SuggestionAiConsentResponseDto,
  UpdateSuggestionAiConsentDto,
} from './dto/suggestion-ai-consent.dto';
import { CreateOnDemandSuggestionDto } from './dto/on-demand-suggestion.dto';
import {
  RegenerateSuggestionDto,
  SuggestionHistoryDayDto,
  SuggestionHistoryListQueryDto,
  SuggestionHistoryListResponseDto,
} from './dto/suggestion-history.dto';
import { SuggestionInstanceResponseDto } from './dto/suggestion-instance-response.dto';
import {
  RoutineBreakStateResponseDto,
  StartRoutineBreakDto,
  UpdateRoutineBreakDto,
} from './dto/suggestion-routine-break.dto';
import {
  NormalRoutineOverrideResponseDto,
  RecordingReminderSnoozeResponseDto,
  RecordSuggestionGapActionDto,
  SnoozeRecordingReminderDto,
  SuggestionGapActionResponseDto,
} from './dto/suggestion-today-actions.dto';
import { TodaysSuggestionResponseDto } from './dto/todays-suggestion-response.dto';
import { SuggestionConsentService } from './services/suggestion-consent.service';
import { SuggestionOnDemandService } from './services/suggestion-on-demand.service';
import { RoutineBreakService } from './services/routine-break.service';
import { SuggestionTodayActionService } from './services/suggestion-today-action.service';
import { SuggestionsService } from './services/suggestions.service';

@ApiBearerAuth()
@ApiTags('suggestions')
@Controller('suggestions')
export class SuggestionsController {
  constructor(
    private readonly suggestionsService: SuggestionsService,
    private readonly suggestionConsentService: SuggestionConsentService,
    private readonly todayActionService: SuggestionTodayActionService,
    private readonly routineBreakService: RoutineBreakService,
    private readonly onDemandService: SuggestionOnDemandService,
  ) {}

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

  @Post('on-demand')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireUnrestrictedUserCapabilities(
    UserRestrictionCapability.DisableAiGeneration,
  )
  @UseGuards(UserRestrictionGuard)
  @ApiOperation({ summary: 'Queue an on-demand skincare suggestion' })
  async createOnDemandSuggestion(
    @CurrentUser() user: User,
    @Req() request: Request,
    @Body() body: CreateOnDemandSuggestionDto,
  ): Promise<SuggestionInstanceResponseDto> {
    return this.onDemandService.create(user, requestTimeZone(request), body);
  }

  @Post('on-demand/:id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireUnrestrictedUserCapabilities(
    UserRestrictionCapability.DisableAiGeneration,
  )
  @UseGuards(UserRestrictionGuard)
  @ApiOperation({ summary: 'Retry a failed on-demand skincare suggestion' })
  async retryOnDemandSuggestion(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<SuggestionInstanceResponseDto> {
    return this.onDemandService.retryFailed(user, id);
  }

  @Post('today/reaction/normal-routine')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Use normal routine for today despite reaction mode',
  })
  async useNormalRoutineForToday(
    @CurrentUser() user: User,
    @Req() request: Request,
  ): Promise<NormalRoutineOverrideResponseDto> {
    return this.todayActionService.useNormalRoutineForToday(
      user,
      requestTimeZone(request),
    );
  }

  @Post('gap-actions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save or dismiss a suggestion gap recommendation' })
  async recordGapAction(
    @CurrentUser() user: User,
    @Body() body: RecordSuggestionGapActionDto,
  ): Promise<SuggestionGapActionResponseDto> {
    return this.todayActionService.recordGapAction(user, body);
  }

  @Post('today/reminders/later')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Snooze a Today recording reminder' })
  async snoozeRecordingReminder(
    @CurrentUser() user: User,
    @Body() body: SnoozeRecordingReminderDto,
  ): Promise<RecordingReminderSnoozeResponseDto> {
    return this.todayActionService.snoozeRecordingReminder(user, body);
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

  @Get('ai-consent')
  @ApiOperation({ summary: 'AI suggestion processing consent status' })
  async getAiConsent(
    @CurrentUser() user: User,
  ): Promise<SuggestionAiConsentResponseDto> {
    return toAiConsentResponse(
      await this.suggestionConsentService.evaluate(user.id),
    );
  }

  @Post('ai-consent')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Grant or revoke AI suggestion processing consent' })
  async updateAiConsent(
    @CurrentUser() user: User,
    @Req() request: Request,
    @Body() body: UpdateSuggestionAiConsentDto,
  ): Promise<SuggestionAiConsentResponseDto> {
    return toAiConsentResponse(
      await this.suggestionConsentService.updateAiSuggestionConsent(
        user.id,
        body.granted,
        request.ip ?? null,
      ),
    );
  }

  @Get('break')
  @ApiOperation({ summary: 'Current routine break state' })
  async getRoutineBreak(
    @CurrentUser() user: User,
  ): Promise<RoutineBreakStateResponseDto> {
    return this.routineBreakService.getBreakState(user);
  }

  @Post('break')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start a user-wide routine break' })
  async startRoutineBreak(
    @CurrentUser() user: User,
    @Body() body: StartRoutineBreakDto,
  ): Promise<RoutineBreakStateResponseDto> {
    return this.routineBreakService.startBreak(user, body ?? {});
  }

  @Post('break/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume the active routine break immediately' })
  async resumeRoutineBreak(
    @CurrentUser() user: User,
  ): Promise<RoutineBreakStateResponseDto> {
    return this.routineBreakService.resumeActiveBreak(user);
  }

  @Patch('break/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a planned routine resume date' })
  async updateRoutineBreak(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: UpdateRoutineBreakDto,
  ): Promise<RoutineBreakStateResponseDto> {
    return this.routineBreakService.updateBreak(user, id, body ?? {});
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
  @RequireUnrestrictedUserCapabilities(
    UserRestrictionCapability.DisableAiGeneration,
  )
  @UseGuards(UserRestrictionGuard)
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
  return readTimeZoneHeaderFromRequest(request);
}

function toAiConsentResponse(decision: {
  aiPersonalizationAllowed: boolean;
  canReadSensitiveContext: boolean;
  blockedReason: string | null;
  grantedAt: Date | null;
  activeSensitiveConsentTypes: string[];
}): SuggestionAiConsentResponseDto {
  return {
    granted: decision.aiPersonalizationAllowed,
    grantedAt: decision.grantedAt?.toISOString() ?? null,
    canReadSensitiveContext: decision.canReadSensitiveContext,
    blockedReason: decision.blockedReason,
    activeSensitiveConsentTypes: decision.activeSensitiveConsentTypes,
  };
}

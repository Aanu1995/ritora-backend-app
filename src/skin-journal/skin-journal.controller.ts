import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AllowBrowserCache } from '../common/decorators/http-cache.decorator';
import { Public } from '../common/decorators/public.decorator';
import { PlatformGlobalRestrictionsService } from '../platform-controls/platform-global-restrictions.service';
import { PlatformGlobalRestrictionCapability } from '../platform-controls/platform-global-restrictions';
import { UserRestrictionEnforcementService } from '../users/user-restriction-enforcement.service';
import {
  RequireUnrestrictedUserCapabilities,
  UserRestrictionGuard,
} from '../users/user-restriction.guard';
import { UserRestrictionCapability } from '../users/user-restrictions';
import { SkinJournalService } from './skin-journal.service';
import { SkinJournalPhotoUploadRestrictionGuard } from './skin-journal-photo-upload-restriction.guard';
import { UpsertEntryDto } from './dto/upsert-entry.dto';
import { JournalEntryResponseDto } from './dto/journal-entry-response.dto';
import { CalendarResponseDto } from './dto/calendar-response.dto';
import { DayDetailResponseDto } from './dto/day-detail-response.dto';
import { JournalEventResponseDto } from './dto/event-response.dto';
import { JournalInsightsResponseDto } from './dto/insight-response.dto';
import { RecordInsightActionDto } from './dto/insight-interaction.dto';
import { RecordAnalysisFeedbackDto } from './dto/analysis-feedback.dto';
import { JournalStatsResponseDto } from './dto/stats-response.dto';
import { WrappedResponseDto } from './dto/wrapped-response.dto';
import { PhotoDatesResponseDto } from './dto/photo-dates-response.dto';
import { PhotoFiltersResponseDto } from './dto/photo-filters-response.dto';
import { PhotoPageResponseDto } from './dto/photo-page-response.dto';
import { StartSimplificationDto } from './dto/start-simplification.dto';
import type { Angle, EventKind, InsightWindow } from './skin-journal.constants';
import {
  SKIN_JOURNAL_FRONT_PHOTO_ANGLE,
  SKIN_JOURNAL_PHOTO_MAX_BYTES,
} from './skin-journal.constants';
import { todayInTimeZone } from './skin-journal.utils';

interface UploadedPhoto {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

type UploadedPhotoMap = Partial<
  Record<
    'photo' | 'photo_head_on' | 'photo_left_profile' | 'photo_right_profile',
    UploadedPhoto[]
  >
>;

const INSIGHT_WINDOWS: ReadonlySet<InsightWindow> = new Set([
  'all',
  'week',
  'month',
]);

@ApiTags('skin-journal')
@Controller('skin-journal')
export class SkinJournalController {
  constructor(
    private readonly service: SkinJournalService,
    private readonly restrictionEnforcement: UserRestrictionEnforcementService,
    private readonly platformRestrictions: PlatformGlobalRestrictionsService,
  ) {}

  private resolveInsightWindow(value: string | undefined): InsightWindow {
    if (!value || value.trim() === '') {
      return 'all';
    }
    if (!INSIGHT_WINDOWS.has(value as InsightWindow)) {
      throw new BadRequestException('Invalid insight window');
    }
    return value as InsightWindow;
  }

  @Public()
  @AllowBrowserCache()
  @Get('media/:token')
  async getSignedLocalMedia(
    @Param('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    const media = await this.service.readSignedLocalMedia(token);
    res.setHeader('Content-Type', media.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Cache-Control',
      `private, max-age=${Math.min(media.maxAgeSeconds, 300)}`,
    );
    res.send(media.buffer);
  }

  @Get('today')
  @ApiOkResponse()
  async getToday(
    @CurrentUser('id') userId: string,
    @CurrentUser('timeZone') timeZone: string | null,
    @Headers('x-timezone') requestTimeZone?: string,
  ) {
    return this.service.getToday(userId, timeZone || requestTimeZone || 'UTC');
  }

  @Get('calendar')
  @ApiOkResponse({ type: CalendarResponseDto })
  async getCalendar(
    @CurrentUser('id') userId: string,
    @Query('month') month?: string,
  ) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      throw new BadRequestException('Query param month=YYYY-MM is required');
    }
    return this.service.getCalendar(userId, month);
  }

  @Get('days/:date')
  @ApiOkResponse({ type: DayDetailResponseDto })
  async getDay(@CurrentUser('id') userId: string, @Param('date') date: string) {
    return this.service.getDay(userId, date);
  }

  @Get('entries')
  @ApiOkResponse({ type: [JournalEntryResponseDto] })
  async listEntries(
    @CurrentUser('id') userId: string,
    @Query('month') month?: string,
  ) {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      throw new BadRequestException('Query param month=YYYY-MM is required');
    }
    return this.service.getMonthEntries(userId, month);
  }

  @Get('photos')
  @ApiOkResponse({ type: PhotoPageResponseDto })
  async listPhotos(
    @CurrentUser('id') userId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filter') filter?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.listPhotos(userId, {
      from,
      to,
      filter,
      limit: parseOptionalPositiveInteger(limit),
      cursor,
    });
  }

  @Get('photo-filters')
  @ApiOkResponse({ type: PhotoFiltersResponseDto })
  async listPhotoFilters(
    @CurrentUser('id') userId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.listPhotoFilters(userId, { from, to });
  }

  @Get('photo-dates')
  @ApiOkResponse({ type: PhotoDatesResponseDto })
  async listPhotoDates(
    @CurrentUser('id') userId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.listPhotoDates(userId, { from, to });
  }

  @Post('today')
  @UseGuards(SkinJournalPhotoUploadRestrictionGuard)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'photo', maxCount: 1 },
        { name: 'photo_head_on', maxCount: 1 },
        { name: 'photo_left_profile', maxCount: 1 },
        { name: 'photo_right_profile', maxCount: 1 },
      ],
      {
        limits: { fileSize: SKIN_JOURNAL_PHOTO_MAX_BYTES },
      },
    ),
  )
  async upsertToday(
    @CurrentUser('id') userId: string,
    @CurrentUser('timeZone') timeZone: string | null,
    @Headers('x-timezone') requestTimeZone: string | undefined,
    @UploadedFiles() files: UploadedPhotoMap | undefined,
    @Body() body: UpsertEntryDto,
  ) {
    const tz = timeZone || requestTimeZone || 'UTC';
    const photos = normalizeUploadedPhotoAngles(files);
    if (Object.keys(photos).length > 0) {
      await this.platformRestrictions.assertAllAllowed([
        PlatformGlobalRestrictionCapability.DisableImageUpload,
        PlatformGlobalRestrictionCapability.DisableAiGeneration,
      ]);
      await this.restrictionEnforcement.assertAllAllowed(userId, [
        UserRestrictionCapability.DisableImageUpload,
        UserRestrictionCapability.DisableAiGeneration,
      ]);
    }

    return this.service.upsertEntryForResolvedDate({
      userId,
      targetDate: todayInTimeZone(tz),
      timeZone: tz,
      photos,
      body,
    });
  }

  @Patch('entries/:id')
  async updateEntry(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: UpsertEntryDto,
  ) {
    return this.service.updateEntryById(userId, id, body);
  }

  @Delete('entries/:id')
  async deleteEntry(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    await this.service.deleteEntry(userId, id);
    return { ok: true };
  }

  @Post('entries/:id/analyze/retry')
  @RequireUnrestrictedUserCapabilities(
    UserRestrictionCapability.DisableAiGeneration,
  )
  @UseGuards(UserRestrictionGuard)
  async retryAnalysis(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.service.retryAnalysis(userId, id);
  }

  @Post('entries/:id/analyze/reinterpret')
  async reinterpretAnalysis(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.service.reinterpretAnalysis(userId, id);
  }

  @Post('entries/:id/analysis-feedback')
  async recordAnalysisFeedback(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: RecordAnalysisFeedbackDto,
  ) {
    return this.service.recordAnalysisFeedback(userId, id, body);
  }

  @Get('compare')
  async compare(
    @CurrentUser('id') userId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    if (!from || !to) {
      throw new BadRequestException('Both from and to are required');
    }
    return this.service.getCompare(userId, from, to);
  }

  @Get('events')
  @ApiOkResponse({ type: [JournalEventResponseDto] })
  async listEvents(
    @CurrentUser('id') userId: string,
    @Query('kind') kind?: EventKind,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('acknowledged') acknowledged?: string,
  ) {
    return this.service.listEvents(userId, {
      kind,
      from,
      to,
      acknowledged: parseOptionalBooleanQuery(acknowledged, 'acknowledged'),
    });
  }

  @Post('events/:id/acknowledge')
  async acknowledgeEvent(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.service.acknowledgeEvent(userId, id);
  }

  @Get('insights')
  @ApiOkResponse({ type: JournalInsightsResponseDto })
  async listInsights(
    @CurrentUser('id') userId: string,
    @Query('window') window?: string,
    @Query('locale') locale?: string,
  ) {
    return this.service.listInsights(userId, {
      window: this.resolveInsightWindow(window),
      locale: locale?.trim() || 'en',
    });
  }

  @Post('insights/:id/dismiss')
  async dismissInsight(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    await this.service.dismissInsight(userId, id);
    return { ok: true };
  }

  @Post('insights/:id/seen')
  async markInsightSeen(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    await this.service.markInsightSeen(userId, id);
    return { ok: true };
  }

  @Post('insights/:id/interactions')
  async recordInsightAction(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: RecordInsightActionDto,
  ) {
    await this.service.recordInsightAction(userId, id, body);
    return { ok: true };
  }

  @Get('wrapped')
  @ApiOkResponse({ type: [WrappedResponseDto] })
  async listWrapped(@CurrentUser('id') userId: string) {
    return this.service.listWrapped(userId);
  }

  @Get('wrapped/:id')
  async getWrapped(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.service.getWrapped(userId, id);
  }

  @Get('simplification/active')
  async activeSimplification(@CurrentUser('id') userId: string) {
    return this.service.getActiveSimplification(userId);
  }

  @Get('simplification/:id')
  async getSimplification(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.service.getSimplification(userId, id);
  }

  @Post('simplification/:id/acknowledge')
  async acknowledgeSimplification(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.service.acknowledgeSimplification(userId, id);
  }

  @Post('simplification/start')
  async startSimplification(
    @CurrentUser('id') userId: string,
    @Body() body: StartSimplificationDto,
  ) {
    return this.service.startSimplification({
      userId,
      triggeredByEventId: body.triggered_by_event_id ?? null,
      reason: body.reason ?? 'User-initiated barrier-repair simplification',
      recoveryTriggerSource: body.recovery_trigger_source,
      recoveryTriggerSymptoms: body.recovery_trigger_symptoms,
      recoveryTriggerSeverity: body.recovery_trigger_severity,
      recoveryActiveOveruse: body.recovery_active_overuse,
    });
  }

  @Get('stats')
  @ApiOkResponse({ type: JournalStatsResponseDto })
  async stats(@CurrentUser('id') userId: string) {
    return this.service.getStats(userId);
  }

  @Public()
  @Get('ops/analysis-queue')
  async analysisQueueOperations(
    @Headers('x-ritora-ops-token') operationsToken?: string,
  ) {
    return this.service.getAnalysisQueueOperations(operationsToken);
  }

  @Public()
  @Get('ops/insights')
  async insightOperations(
    @Headers('x-ritora-ops-token') operationsToken?: string,
  ) {
    return this.service.getInsightOperations(operationsToken);
  }
}

function normalizeUploadedPhotoAngles(
  files: UploadedPhotoMap | undefined,
): Partial<Record<Angle, { buffer: Buffer; contentType: string }>> {
  const namedFront = files?.photo_head_on?.[0];
  const legacyFront = files?.photo?.[0];
  if (namedFront && legacyFront) {
    throw new BadRequestException('Only one front photo can be uploaded');
  }
  const front = namedFront ?? legacyFront;

  const photos: Partial<
    Record<Angle, { buffer: Buffer; contentType: string }>
  > = {};
  if (front) {
    photos[SKIN_JOURNAL_FRONT_PHOTO_ANGLE] = {
      buffer: front.buffer,
      contentType: front.mimetype,
    };
  }

  const left = files?.photo_left_profile?.[0];
  if (left) {
    photos.left_profile = { buffer: left.buffer, contentType: left.mimetype };
  }
  const right = files?.photo_right_profile?.[0];
  if (right) {
    photos.right_profile = {
      buffer: right.buffer,
      contentType: right.mimetype,
    };
  }

  return photos;
}

function parseOptionalPositiveInteger(
  value: string | undefined,
): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new BadRequestException('Invalid positive integer');
  }
  return parsed;
}

function parseOptionalBooleanQuery(
  value: string | undefined,
  name: string,
): boolean | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new BadRequestException(`Invalid boolean query parameter: ${name}`);
}

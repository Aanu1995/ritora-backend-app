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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkinJournalService } from './skin-journal.service';
import { UpsertEntryDto } from './dto/upsert-entry.dto';
import { JournalEntryResponseDto } from './dto/journal-entry-response.dto';
import { CalendarResponseDto } from './dto/calendar-response.dto';
import { DayDetailResponseDto } from './dto/day-detail-response.dto';
import { JournalEventResponseDto } from './dto/event-response.dto';
import { JournalInsightResponseDto } from './dto/insight-response.dto';
import { JournalStatsResponseDto } from './dto/stats-response.dto';
import { WrappedResponseDto } from './dto/wrapped-response.dto';
import { PhotoDatesResponseDto } from './dto/photo-dates-response.dto';
import { PhotoFiltersResponseDto } from './dto/photo-filters-response.dto';
import { PhotoPageResponseDto } from './dto/photo-page-response.dto';
import {
  CreateJournalExportDto,
  JournalExportResponseDto,
} from './dto/export-journal.dto';
import { StartSimplificationDto } from './dto/start-simplification.dto';
import type { EventKind } from './skin-journal.constants';
import { SKIN_JOURNAL_PHOTO_MAX_BYTES } from './skin-journal.constants';
import { todayInTimeZone } from './skin-journal.utils';

interface UploadedPhoto {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

@ApiTags('skin-journal')
@Controller('skin-journal')
export class SkinJournalController {
  constructor(private readonly service: SkinJournalService) {}

  @Public()
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
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: SKIN_JOURNAL_PHOTO_MAX_BYTES },
    }),
  )
  async upsertToday(
    @CurrentUser('id') userId: string,
    @CurrentUser('timeZone') timeZone: string | null,
    @Headers('x-timezone') requestTimeZone: string | undefined,
    @UploadedFile() photo: UploadedPhoto | undefined,
    @Body() body: UpsertEntryDto,
  ) {
    const tz = timeZone || requestTimeZone || 'UTC';
    return this.service.upsertEntryForResolvedDate({
      userId,
      targetDate: todayInTimeZone(tz),
      timeZone: tz,
      photo: photo
        ? { buffer: photo.buffer, contentType: photo.mimetype }
        : null,
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
  async retryAnalysis(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.service.retryAnalysis(userId, id);
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
  @ApiOkResponse({ type: [JournalInsightResponseDto] })
  async listInsights(@CurrentUser('id') userId: string) {
    await this.service.generateInsightsIfNeeded(userId);
    return this.service.listInsights(userId);
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

  @Post('export')
  @ApiOkResponse({ type: JournalExportResponseDto })
  async createExport(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateJournalExportDto,
  ) {
    return this.service.createExport(userId, dto);
  }

  @Get('export/:jobId')
  @ApiOkResponse({ type: JournalExportResponseDto })
  async getExport(
    @CurrentUser('id') userId: string,
    @Param('jobId') jobId: string,
  ) {
    return this.service.getExport(userId, jobId);
  }
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

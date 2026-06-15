import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { OriginCheckGuard } from '../common/guards/origin-check.guard';
import { AdminJwtAuthGuard } from '../admin/admin-jwt-auth.guard';
import type { AdminAuthenticatedUser } from '../admin/admin.types';
import { CommunityService } from './community.service';
import {
  AdminCommunityAssignDto,
  AdminCommunityModerationDto,
  AdminCommunityModerationQueryDto,
  AdminCommunityNoteDto,
  AdminCommunityReportStatusDto,
  AdminCommunitySettingsDto,
  AdminCommunityWarningDto,
  CommunityCursorPageQueryDto,
  CommunityHelpfulnessDto,
  CommunityListQueryDto,
  CommunityOutcomeResultsQueryDto,
  CommunityOutcomeSignalDto,
  CreateCommunityReportDto,
  CreateCommunityReviewDto,
  CreateCommunityRoutineDto,
  EditCommunityReviewDto,
  EditCommunityRoutineDto,
  SaveCommunityAdaptationDto,
} from './dto/community.dto';

function adminContext(user: AdminAuthenticatedUser, req?: Request) {
  return {
    ip: req?.ip,
    sessionId: user.sessionId,
    userAgent: req?.headers['user-agent']?.toString(),
  };
}

@ApiTags('community')
@Controller('community')
export class CommunityController {
  constructor(private readonly communityService: CommunityService) {}

  @Get('home')
  getHome(@CurrentUser('id') userId: string) {
    return this.communityService.getHome(userId);
  }

  @Get('people-like-me')
  getPeopleLikeMe(
    @CurrentUser('id') userId: string,
    @Query() query: CommunityCursorPageQueryDto,
  ) {
    return this.communityService.getPeopleLikeMe(userId, query);
  }

  @Get('routines')
  listRoutines(
    @CurrentUser('id') userId: string,
    @Query() query: CommunityListQueryDto,
  ) {
    return this.communityService.listRoutines(userId, query);
  }

  @Get('bookmarks')
  listBookmarks(
    @CurrentUser('id') userId: string,
    @Query() query: CommunityCursorPageQueryDto,
  ) {
    return this.communityService.listBookmarks(userId, query);
  }

  @Get('routines/:id')
  getRoutine(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.communityService.getRoutine(userId, id);
  }

  @Get('products/:id/evidence')
  getProductEvidence(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.communityService.getProductEvidence(userId, id);
  }

  @Post('routines')
  @UseGuards(OriginCheckGuard)
  createRoutine(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateCommunityRoutineDto,
  ) {
    return this.communityService.createRoutine(userId, dto);
  }

  @Patch('routines/:id')
  @UseGuards(OriginCheckGuard)
  updateRoutine(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: EditCommunityRoutineDto,
  ) {
    return this.communityService.updateRoutine(userId, id, dto);
  }

  @Post('routines/:id/report')
  @UseGuards(OriginCheckGuard)
  reportRoutine(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: CreateCommunityReportDto,
  ) {
    return this.communityService.reportRoutine(userId, id, dto);
  }

  @Post('routines/:id/bookmark')
  @UseGuards(OriginCheckGuard)
  bookmarkRoutine(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.communityService.bookmarkRoutine(userId, id);
  }

  @Delete('routines/:id/bookmark')
  @UseGuards(OriginCheckGuard)
  unbookmarkRoutine(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.communityService.unbookmarkRoutine(userId, id);
  }

  @Post('routines/:id/helpfulness')
  @UseGuards(OriginCheckGuard)
  voteRoutine(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: CommunityHelpfulnessDto,
  ) {
    return this.communityService.voteRoutine(userId, id, dto);
  }

  @Post('routines/:id/outcome-signal')
  @UseGuards(OriginCheckGuard)
  signalRoutineOutcome(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: CommunityOutcomeSignalDto,
  ) {
    return this.communityService.signalRoutineOutcome(userId, id, dto);
  }

  @Get('routines/:id/results')
  listRoutineResults(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Query() query: CommunityOutcomeResultsQueryDto,
  ) {
    return this.communityService.listRoutineResults(userId, id, query);
  }

  @Post('routines/:id/adapt-to-shelf')
  @UseGuards(OriginCheckGuard)
  adaptRoutine(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.communityService.adaptRoutine(userId, id);
  }

  @Post('routines/:id/save-adaptation')
  @UseGuards(OriginCheckGuard)
  saveAdaptation(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: SaveCommunityAdaptationDto,
  ) {
    return this.communityService.saveAdaptation(userId, id, dto.adaptationId);
  }

  @Get('reviews')
  listReviews(
    @CurrentUser('id') userId: string,
    @Query() query: CommunityListQueryDto,
  ) {
    return this.communityService.listReviews(userId, query);
  }

  @Post('reviews')
  @UseGuards(OriginCheckGuard)
  createReview(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateCommunityReviewDto,
  ) {
    return this.communityService.createReview(userId, dto);
  }

  @Patch('reviews/:id')
  @UseGuards(OriginCheckGuard)
  updateReview(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: EditCommunityReviewDto,
  ) {
    return this.communityService.updateReview(userId, id, dto);
  }

  @Post('reviews/:id/report')
  @UseGuards(OriginCheckGuard)
  reportReview(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: CreateCommunityReportDto,
  ) {
    return this.communityService.reportReview(userId, id, dto);
  }

  @Post('reviews/:id/bookmark')
  @UseGuards(OriginCheckGuard)
  bookmarkReview(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.communityService.bookmarkReview(userId, id);
  }

  @Delete('reviews/:id/bookmark')
  @UseGuards(OriginCheckGuard)
  unbookmarkReview(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.communityService.unbookmarkReview(userId, id);
  }

  @Post('reviews/:id/helpfulness')
  @UseGuards(OriginCheckGuard)
  voteReview(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: CommunityHelpfulnessDto,
  ) {
    return this.communityService.voteReview(userId, id, dto);
  }

  @Post('reviews/:id/outcome-signal')
  @UseGuards(OriginCheckGuard)
  signalReviewOutcome(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: CommunityOutcomeSignalDto,
  ) {
    return this.communityService.signalReviewOutcome(userId, id, dto);
  }

  @Get('reviews/:id/results')
  listReviewResults(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Query() query: CommunityOutcomeResultsQueryDto,
  ) {
    return this.communityService.listReviewResults(userId, id, query);
  }

  @Get('warnings')
  listWarnings() {
    return this.communityService.listWarnings();
  }

  @Get('eligibility')
  getPostingEligibility(@CurrentUser('id') userId: string) {
    return this.communityService.getPostingEligibility(userId);
  }

  @Post('guidelines/accept')
  @UseGuards(OriginCheckGuard)
  acceptGuidelines(@CurrentUser('id') userId: string, @Req() req: Request) {
    return this.communityService.acceptCommunityGuidelines(userId, req.ip);
  }

  @Get('me/submissions')
  listMySubmissions(
    @CurrentUser('id') userId: string,
    @Query() query: CommunityCursorPageQueryDto,
  ) {
    return this.communityService.listMySubmissions(userId, query);
  }

  @Post('content/:id/resubmit')
  @UseGuards(OriginCheckGuard)
  resubmitContent(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.communityService.resubmitContent(userId, id);
  }

  @Delete('content/:id')
  @UseGuards(OriginCheckGuard)
  withdrawContent(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.communityService.withdrawContent(userId, id);
  }
}

@ApiTags('admin-community')
@Controller('admin/community')
@Public()
@UseGuards(AdminJwtAuthGuard)
export class AdminCommunityController {
  constructor(private readonly communityService: CommunityService) {}

  @Get('moderation')
  listModeration(@Query() query: AdminCommunityModerationQueryDto) {
    return this.communityService.listAdminModeration(query);
  }

  @Get('reports')
  listReports() {
    return this.communityService.listAdminReports();
  }

  @Get('settings')
  getSettings() {
    return this.communityService.getCommunitySettings();
  }

  @Patch('settings')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard)
  updateSettings(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Body() dto: AdminCommunitySettingsDto,
    @Req() req: Request,
  ) {
    return this.communityService.updateCommunitySettings(
      user.id,
      dto,
      adminContext(user, req),
    );
  }

  @Get('content/:id')
  getContent(@Param('id') id: string) {
    return this.communityService.getAdminContentDetail(id);
  }

  @Patch('reports/:id')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard)
  updateReport(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminCommunityReportStatusDto,
    @Req() req: Request,
  ) {
    return this.communityService.updateAdminReportStatus(
      user.id,
      id,
      dto,
      adminContext(user, req),
    );
  }

  @Patch('content/:id/moderation')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard)
  moderate(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminCommunityModerationDto,
    @Req() _req: Request,
  ) {
    return this.communityService.moderateContent(
      user.id,
      id,
      dto,
      adminContext(user, _req),
    );
  }

  @Patch('content/:id/assignment')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard)
  assign(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminCommunityAssignDto,
    @Req() req: Request,
  ) {
    return this.communityService.assignContent(
      user.id,
      id,
      dto,
      adminContext(user, req),
    );
  }

  @Post('content/:id/notes')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard)
  addNote(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminCommunityNoteDto,
    @Req() req: Request,
  ) {
    return this.communityService.addAdminNote(
      user.id,
      id,
      dto.note,
      adminContext(user, req),
    );
  }

  @Post('warnings')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard)
  createWarning(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Body() dto: AdminCommunityWarningDto,
    @Req() req: Request,
  ) {
    return this.communityService.createWarning(
      dto,
      user.id,
      adminContext(user, req),
    );
  }

  @Patch('warnings/:id')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard)
  updateWarning(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminCommunityWarningDto,
    @Req() req: Request,
  ) {
    return this.communityService.updateWarning(
      id,
      dto,
      user.id,
      adminContext(user, req),
    );
  }
}

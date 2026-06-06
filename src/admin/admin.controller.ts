import {
  Body,
  Controller,
  Delete,
  Get,
  Optional,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { normalizeLanguage } from '../common/i18n/i18n';
import { OriginCheckGuard } from '../common/guards/origin-check.guard';
import { AdminAuthService } from './admin-auth.service';
import { AdminJwtAuthGuard } from './admin-jwt-auth.guard';
import { AdminRootGuard } from './admin-root.guard';
import { AdminService } from './admin.service';
import { AdminAiCostUserListQueryDto } from './dto/admin-ai-cost-user-list-query.dto';
import { AdminAuditLogQueryDto } from './dto/admin-audit-log-query.dto';
import { AdminNotificationListQueryDto } from './dto/admin-notification.dto';
import { AdminListQueryDto } from './dto/admin-list-query.dto';
import { CreateAdminDto } from './dto/create-admin.dto';
import { DeleteAdminDto } from './dto/delete-admin.dto';
import { ResendAdminInvitationDto } from './dto/resend-admin-invitation.dto';
import { AdminUserListQueryDto } from './dto/admin-user-list-query.dto';
import {
  AdminUserNoteListQueryDto,
  CreateAdminUserNoteDto,
} from './dto/admin-user-note.dto';
import {
  AdminOperationalIncidentListQueryDto,
  CreateOperationalIncidentDto,
  ResolveOperationalIncidentDto,
} from './dto/admin-operational-incident.dto';
import {
  AdminAccountMonitoringTimelineQueryDto,
  AdminAccountMonitoringListQueryDto,
  CreateAdminAccountMonitoringFlagDto,
  CreateAdminAccountMonitoringSupportEventDto,
  ResolveAdminAccountMonitoringFlagDto,
  UpdateAdminAccountMonitoringFlagDto,
  UpdateAdminAccountMonitoringSettingsDto,
} from './dto/admin-account-monitoring.dto';
import {
  AdminPlatformGlobalRestrictionParamDto,
  DisablePlatformGlobalRestrictionDto,
  EnablePlatformGlobalRestrictionDto,
} from './dto/admin-platform-global-restriction.dto';
import {
  AdminUserRestrictionDto,
  AdminUserUnrestrictionDto,
} from './dto/admin-user-restriction.dto';
import {
  AdminSupportFeedbackListQueryDto,
  AdminSupportFeedbackNoteListQueryDto,
  CreateAdminSupportFeedbackDto,
  CreateAdminSupportFeedbackNoteDto,
  UpdateAdminSupportFeedbackDto,
} from '../support/dto/support-feedback.dto';
import { SupportService } from '../support/support.service';
import type {
  SupportFeedbackListResponse,
  SupportFeedbackNoteListResponse,
  SupportFeedbackNoteResponse,
  SupportFeedbackResponse,
} from '../support/support.types';
import type {
  AdminAuthenticatedUser,
  AdminAccountMonitoringAutomatedScanResponse,
  AdminAccountMonitoringEventTimelineResponse,
  AdminAccountMonitoringFlagListResponse,
  AdminAccountMonitoringFlagResponse,
  AdminAccountMonitoringSettingsResponse,
  AdminAiCostByUserListResponse,
  AdminAuditLogListResponse,
  AdminMemberListResponse,
  AdminMemberResponse,
  AdminNotificationListResponse,
  AdminNotificationResponse,
  AdminOperationalIncidentListResponse,
  AdminOperationalIncidentResponse,
  AdminOperationsMonitoringResponse,
  AdminOverviewResponse,
  AdminPlatformGlobalRestrictionListResponse,
  AdminPlatformGlobalRestrictionResponse,
  AdminSkinJournalAnalysisFeedbackReportResponse,
  AdminUserDetailResponse,
  AdminUserListResponse,
  AdminUserNoteListResponse,
  AdminUserNoteResponse,
  AdminUserResponse,
} from './admin.types';

function getHeaderValue(
  headers: Request['headers'],
  key: string,
): string | undefined {
  const value = headers[key];
  return Array.isArray(value) ? value[0] : value;
}

@ApiTags('admin')
@Controller('admin')
@Public()
@UseGuards(AdminJwtAuthGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminAuthService: AdminAuthService,
    @Optional() private readonly supportService?: SupportService,
  ) {}

  @Get('me')
  getMe(@CurrentUser() user: AdminAuthenticatedUser): AdminMemberResponse {
    return this.adminService.getCurrentAdmin(user);
  }

  @Get('metrics/overview')
  getOverview(): Promise<AdminOverviewResponse> {
    return this.adminService.getOverview();
  }

  @Get('metrics/ai-cost/users')
  listAiCostByUsers(
    @Query() query: AdminAiCostUserListQueryDto,
  ): Promise<AdminAiCostByUserListResponse> {
    return this.adminService.listAiCostByUsers(query);
  }

  @Get('users')
  listUsers(
    @Query() query: AdminUserListQueryDto,
  ): Promise<AdminUserListResponse> {
    return this.adminService.listUsers(query);
  }

  @Get('users/:id')
  getUser(@Param('id') id: string): Promise<AdminUserDetailResponse> {
    return this.adminService.getUser(id);
  }

  @Get('users/:id/notes')
  listUserNotes(
    @Param('id') id: string,
    @Query() query: AdminUserNoteListQueryDto,
  ): Promise<AdminUserNoteListResponse> {
    return this.adminService.listUserNotes(id, query);
  }

  @Post('users/:id/notes')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard)
  createUserNote(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateAdminUserNoteDto,
    @Req() req: Request,
  ): Promise<AdminUserNoteResponse> {
    return this.adminService.createUserNote(user, id, dto, {
      ip: req.ip,
      sessionId: user.sessionId,
      userAgent: getHeaderValue(req.headers, 'user-agent'),
    });
  }

  @Get('support/feedback')
  listSupportFeedback(
    @Query() query: AdminSupportFeedbackListQueryDto,
  ): Promise<SupportFeedbackListResponse> {
    return this.getSupportService().listAdminFeedback(query);
  }

  @Post('support/feedback')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard)
  createSupportFeedback(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Body() dto: CreateAdminSupportFeedbackDto,
    @Req() req: Request,
  ): Promise<SupportFeedbackResponse> {
    return this.getSupportService().createAdminFeedback(
      user,
      {
        context: dto.context,
        description: dto.description,
        priority: dto.priority,
        reason: dto.reason,
        reporterEmail: dto.reporterEmail,
        source: dto.source,
        title: dto.title,
        type: dto.type,
        userIdentifier: dto.userIdentifier,
      },
      {
        ip: req.ip,
        sessionId: user.sessionId,
        userAgent: getHeaderValue(req.headers, 'user-agent'),
      },
    );
  }

  @Patch('support/feedback/:id')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard)
  updateSupportFeedback(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateAdminSupportFeedbackDto,
    @Req() req: Request,
  ): Promise<SupportFeedbackResponse> {
    return this.getSupportService().updateAdminFeedback(
      user,
      id,
      {
        assignedAdminId: dto.assignedAdminId,
        priority: dto.priority,
        reason: dto.reason,
        status: dto.status,
      },
      {
        ip: req.ip,
        sessionId: user.sessionId,
        userAgent: getHeaderValue(req.headers, 'user-agent'),
      },
    );
  }

  @Get('support/feedback/:id/notes')
  listSupportFeedbackNotes(
    @Param('id') id: string,
    @Query() query: AdminSupportFeedbackNoteListQueryDto,
  ): Promise<SupportFeedbackNoteListResponse> {
    return this.getSupportService().listAdminFeedbackNotes(id, query);
  }

  @Post('support/feedback/:id/notes')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard)
  createSupportFeedbackNote(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateAdminSupportFeedbackNoteDto,
    @Req() req: Request,
  ): Promise<SupportFeedbackNoteResponse> {
    return this.getSupportService().createAdminFeedbackNote(
      user,
      id,
      {
        body: dto.body,
        reason: dto.reason,
      },
      {
        ip: req.ip,
        sessionId: user.sessionId,
        userAgent: getHeaderValue(req.headers, 'user-agent'),
      },
    );
  }

  @Get('audit-logs')
  listAuditLogs(
    @Query() query: AdminAuditLogQueryDto,
  ): Promise<AdminAuditLogListResponse> {
    return this.adminService.listAuditLogs(query);
  }

  @Get('notifications')
  listNotifications(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Query() query: AdminNotificationListQueryDto,
  ): Promise<AdminNotificationListResponse> {
    return this.adminService.listNotifications(user, { limit: query.limit });
  }

  @Post('notifications/:id/read')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard)
  markNotificationRead(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Param('id') id: string,
  ): Promise<AdminNotificationResponse> {
    return this.adminService.markNotificationRead(user, id);
  }

  @Get('account-monitoring')
  listAccountMonitoringFlags(
    @Query() query: AdminAccountMonitoringListQueryDto,
  ): Promise<AdminAccountMonitoringFlagListResponse> {
    return this.adminService.listAccountMonitoringFlags(query);
  }

  @Post('account-monitoring')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard)
  createAccountMonitoringFlag(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Body() dto: CreateAdminAccountMonitoringFlagDto,
    @Req() req: Request,
  ): Promise<AdminAccountMonitoringFlagResponse> {
    return this.adminService.createAccountMonitoringFlag(
      user,
      {
        internalNote: dto.internalNote,
        latestSignal: dto.latestSignal,
        nextReviewAt: dto.nextReviewAt,
        reason: dto.reason,
        severity: dto.severity,
        signalType: dto.signalType,
        summary: dto.summary,
        userIdentifier: dto.userIdentifier,
      },
      {
        ip: req.ip,
        sessionId: user.sessionId,
        userAgent: getHeaderValue(req.headers, 'user-agent'),
      },
    );
  }

  @Post('account-monitoring/automated-scan')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard)
  runAccountMonitoringAutomatedScan(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Req() req: Request,
  ): Promise<AdminAccountMonitoringAutomatedScanResponse> {
    return this.adminService.runAccountMonitoringAutomatedScan(user, {
      ip: req.ip,
      sessionId: user.sessionId,
      userAgent: getHeaderValue(req.headers, 'user-agent'),
    });
  }

  @Post('account-monitoring/support-events')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard)
  createAccountMonitoringSupportEvent(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Body() dto: CreateAdminAccountMonitoringSupportEventDto,
    @Req() req: Request,
  ): Promise<AdminAccountMonitoringFlagResponse> {
    return this.adminService.createAccountMonitoringSupportEvent(
      user,
      {
        internalNote: dto.internalNote,
        latestSignal: dto.latestSignal,
        reason: dto.reason,
        severity: dto.severity,
        summary: dto.summary,
        supportReference: dto.supportReference,
        userIdentifier: dto.userIdentifier,
      },
      {
        ip: req.ip,
        sessionId: user.sessionId,
        userAgent: getHeaderValue(req.headers, 'user-agent'),
      },
    );
  }

  @Get('account-monitoring/:id/events')
  getAccountMonitoringEventTimeline(
    @Param('id') id: string,
    @Query() query: AdminAccountMonitoringTimelineQueryDto,
  ): Promise<AdminAccountMonitoringEventTimelineResponse> {
    return this.adminService.getAccountMonitoringEventTimeline(id, {
      limit: query.limit,
    });
  }

  @Get('account-monitoring/settings')
  getAccountMonitoringSettings(): Promise<AdminAccountMonitoringSettingsResponse> {
    return this.adminService.getAccountMonitoringSettings();
  }

  @Patch('account-monitoring/settings')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard)
  updateAccountMonitoringSettings(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Body() dto: UpdateAdminAccountMonitoringSettingsDto,
    @Req() req: Request,
  ): Promise<AdminAccountMonitoringSettingsResponse> {
    return this.adminService.updateAccountMonitoringSettings(
      user,
      { reason: dto.reason, thresholds: dto.thresholds },
      {
        ip: req.ip,
        sessionId: user.sessionId,
        userAgent: getHeaderValue(req.headers, 'user-agent'),
      },
    );
  }

  @Patch('account-monitoring/:id')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard)
  updateAccountMonitoringFlag(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateAdminAccountMonitoringFlagDto,
    @Req() req: Request,
  ): Promise<AdminAccountMonitoringFlagResponse> {
    return this.adminService.updateAccountMonitoringFlag(
      user,
      id,
      {
        assignedAdminId: dto.assignedAdminId,
        internalNote: dto.internalNote,
        latestSignal: dto.latestSignal,
        nextReviewAt: dto.nextReviewAt,
        reason: dto.reason,
        status: dto.status,
      },
      {
        ip: req.ip,
        sessionId: user.sessionId,
        userAgent: getHeaderValue(req.headers, 'user-agent'),
      },
    );
  }

  @Post('account-monitoring/:id/resolve')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard)
  resolveAccountMonitoringFlag(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ResolveAdminAccountMonitoringFlagDto,
    @Req() req: Request,
  ): Promise<AdminAccountMonitoringFlagResponse> {
    return this.adminService.resolveAccountMonitoringFlag(
      user,
      id,
      {
        reason: dto.reason,
        resolutionNote: dto.resolutionNote,
      },
      {
        ip: req.ip,
        sessionId: user.sessionId,
        userAgent: getHeaderValue(req.headers, 'user-agent'),
      },
    );
  }

  @Get('operations/monitoring')
  getOperationsMonitoring(): Promise<AdminOperationsMonitoringResponse> {
    return this.adminService.getOperationsMonitoring();
  }

  @Get('skin-journal/analysis-feedback')
  getSkinJournalAnalysisFeedbackReport(): Promise<AdminSkinJournalAnalysisFeedbackReportResponse> {
    return this.adminService.getSkinJournalAnalysisFeedbackReport();
  }

  @Get('operations/incidents')
  listOperationalIncidents(
    @Query() query: AdminOperationalIncidentListQueryDto,
  ): Promise<AdminOperationalIncidentListResponse> {
    return this.adminService.listOperationalIncidents(query);
  }

  @Post('operations/incidents')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard)
  createOperationalIncident(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Body() dto: CreateOperationalIncidentDto,
    @Req() req: Request,
  ): Promise<AdminOperationalIncidentResponse> {
    return this.adminService.createOperationalIncident(user, dto, {
      ip: req.ip,
      sessionId: user.sessionId,
      userAgent: getHeaderValue(req.headers, 'user-agent'),
    });
  }

  @Post('operations/incidents/:id/resolve')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard)
  resolveOperationalIncident(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ResolveOperationalIncidentDto,
    @Req() req: Request,
  ): Promise<AdminOperationalIncidentResponse> {
    return this.adminService.resolveOperationalIncident(user, id, dto, {
      ip: req.ip,
      sessionId: user.sessionId,
      userAgent: getHeaderValue(req.headers, 'user-agent'),
    });
  }

  @Post('users/:id/restrictions')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard)
  restrictUser(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminUserRestrictionDto,
    @Req() req: Request,
  ): Promise<AdminUserResponse> {
    return this.adminService.restrictUser(user, id, {
      capabilities: dto.capabilities,
      expiresAt: dto.expiresAt,
      internalNote: dto.internalNote,
      ip: req.ip,
      reason: dto.reason,
      sessionId: user.sessionId,
      userMessage: dto.userMessage,
      userAgent: getHeaderValue(req.headers, 'user-agent'),
    });
  }

  @Delete('users/:id/restrictions')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard)
  unrestrictUser(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminUserUnrestrictionDto,
    @Req() req: Request,
  ): Promise<AdminUserResponse> {
    return this.adminService.unrestrictUser(user, id, {
      ip: req.ip,
      reason: dto.reason,
      sessionId: user.sessionId,
      userAgent: getHeaderValue(req.headers, 'user-agent'),
    });
  }

  @Get('platform/restrictions')
  listPlatformGlobalRestrictions(): Promise<AdminPlatformGlobalRestrictionListResponse> {
    return this.adminService.listPlatformGlobalRestrictions();
  }

  @Post('platform/restrictions/:capability')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard)
  enablePlatformGlobalRestriction(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Param() params: AdminPlatformGlobalRestrictionParamDto,
    @Body() dto: EnablePlatformGlobalRestrictionDto,
    @Req() req: Request,
  ): Promise<AdminPlatformGlobalRestrictionResponse> {
    return this.adminService.enablePlatformGlobalRestriction(
      user,
      params.capability,
      {
        expiresAt: dto.expiresAt,
        internalNote: dto.internalNote,
        ip: req.ip,
        reason: dto.reason,
        sessionId: user.sessionId,
        userAgent: getHeaderValue(req.headers, 'user-agent'),
      },
    );
  }

  @Delete('platform/restrictions/:capability')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard)
  disablePlatformGlobalRestriction(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Param() params: AdminPlatformGlobalRestrictionParamDto,
    @Body() dto: DisablePlatformGlobalRestrictionDto,
    @Req() req: Request,
  ): Promise<AdminPlatformGlobalRestrictionResponse> {
    return this.adminService.disablePlatformGlobalRestriction(
      user,
      params.capability,
      {
        ip: req.ip,
        reason: dto.reason,
        sessionId: user.sessionId,
        userAgent: getHeaderValue(req.headers, 'user-agent'),
      },
    );
  }

  @Get('admins')
  @UseGuards(AdminJwtAuthGuard, AdminRootGuard)
  listAdmins(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Query() query: AdminListQueryDto,
  ): Promise<AdminMemberListResponse> {
    return this.adminAuthService.listAdmins(user, query);
  }

  @Post('admins')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard, AdminRootGuard)
  createAdmin(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Body() dto: CreateAdminDto,
    @Req() req: Request,
  ): Promise<AdminMemberResponse> {
    return this.adminAuthService.createAdmin(
      user,
      dto,
      {
        ip: req.ip,
        reason: dto.reason,
        sessionId: user.sessionId,
        userAgent: getHeaderValue(req.headers, 'user-agent'),
      },
      normalizeLanguage(dto.language),
    );
  }

  @Post('admins/:id/invitations')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard, AdminRootGuard)
  resendAdminInvitation(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ResendAdminInvitationDto,
    @Req() req: Request,
  ): Promise<AdminMemberResponse> {
    return this.adminAuthService.resendAdminInvitation(
      user,
      id,
      {
        ip: req.ip,
        reason: dto.reason,
        sessionId: user.sessionId,
        userAgent: getHeaderValue(req.headers, 'user-agent'),
      },
      normalizeLanguage(dto.language),
    );
  }

  @Delete('admins/:id')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard, AdminRootGuard)
  async deleteAdmin(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DeleteAdminDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.adminAuthService.deleteAdmin(user, id, {
      ip: req.ip,
      reason: dto.reason,
      sessionId: user.sessionId,
      userAgent: getHeaderValue(req.headers, 'user-agent'),
    });
  }

  private getSupportService(): SupportService {
    if (!this.supportService) {
      throw new Error('Support service is not configured');
    }

    return this.supportService;
  }
}

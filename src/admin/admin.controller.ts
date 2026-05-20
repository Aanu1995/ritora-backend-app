import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
import { AdminAuditLogQueryDto } from './dto/admin-audit-log-query.dto';
import { AdminListQueryDto } from './dto/admin-list-query.dto';
import { CreateAdminDto } from './dto/create-admin.dto';
import { DeleteAdminDto } from './dto/delete-admin.dto';
import { ResendAdminInvitationDto } from './dto/resend-admin-invitation.dto';
import { AdminUserListQueryDto } from './dto/admin-user-list-query.dto';
import { AdminUserRestrictionDto } from './dto/admin-user-restriction.dto';
import type {
  AdminAuthenticatedUser,
  AdminAuditLogListResponse,
  AdminMemberListResponse,
  AdminMemberResponse,
  AdminOperationsMonitoringResponse,
  AdminOverviewResponse,
  AdminUserDetailResponse,
  AdminUserListResponse,
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
  ) {}

  @Get('me')
  getMe(@CurrentUser() user: AdminAuthenticatedUser): AdminMemberResponse {
    return this.adminService.getCurrentAdmin(user);
  }

  @Get('metrics/overview')
  getOverview(): Promise<AdminOverviewResponse> {
    return this.adminService.getOverview();
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

  @Get('audit-logs')
  listAuditLogs(
    @Query() query: AdminAuditLogQueryDto,
  ): Promise<AdminAuditLogListResponse> {
    return this.adminService.listAuditLogs(query);
  }

  @Get('operations/monitoring')
  getOperationsMonitoring(): Promise<AdminOperationsMonitoringResponse> {
    return this.adminService.getOperationsMonitoring();
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
      ip: req.ip,
      reason: dto.reason,
      sessionId: user.sessionId,
      userAgent: getHeaderValue(req.headers, 'user-agent'),
    });
  }

  @Delete('users/:id/restrictions')
  @UseGuards(AdminJwtAuthGuard, OriginCheckGuard)
  unrestrictUser(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminUserRestrictionDto,
    @Req() req: Request,
  ): Promise<AdminUserResponse> {
    return this.adminService.unrestrictUser(user, id, {
      ip: req.ip,
      reason: dto.reason,
      sessionId: user.sessionId,
      userAgent: getHeaderValue(req.headers, 'user-agent'),
    });
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
}

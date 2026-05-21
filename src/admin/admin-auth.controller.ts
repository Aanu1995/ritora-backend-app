import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { OriginCheckGuard } from '../common/guards/origin-check.guard';
import { normalizeLanguage, translate } from '../common/i18n/i18n';
import { AdminAuthService } from './admin-auth.service';
import { AdminJwtAuthGuard } from './admin-jwt-auth.guard';
import { AdminForgotPasswordDto } from './dto/admin-forgot-password.dto';
import { AdminLoginDto } from './dto/admin-login.dto';
import {
  AdminMfaChallengeDto,
  AdminMfaEnableDto,
  AdminMfaPasswordDto,
} from './dto/admin-mfa.dto';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import type {
  AdminAuthenticatedUser,
  AdminLoginResponse,
  AdminMfaEnableResponse,
  AdminMfaSetupResponse,
  AdminMfaStatusResponse,
  AdminSessionResponse,
} from './admin.types';

const adminAuthThrottle = (limit: number) => ({
  default: {
    ttl: 60000,
    limit: process.env.NODE_ENV === 'test' ? 100 : limit,
  },
});

function getHeaderValue(
  headers: Request['headers'],
  key: string,
): string | undefined {
  const value = headers[key];
  return Array.isArray(value) ? value[0] : value;
}

function getCookieValue(req: Request, cookieName: string): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[cookieName];
  return typeof value === 'string' ? value : undefined;
}

@ApiTags('admin-auth')
@Controller('admin/auth')
@Public()
export class AdminAuthController {
  private readonly adminCookieRefreshName: string;

  constructor(
    private readonly adminAuthService: AdminAuthService,
    private readonly configService: ConfigService,
  ) {
    this.adminCookieRefreshName = configService.getOrThrow(
      'ADMIN_COOKIE_REFRESH_NAME',
    );
  }

  @Post('login')
  @UseGuards(OriginCheckGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle(adminAuthThrottle(5))
  @ApiOkResponse({
    schema: {
      properties: {
        accessToken: { type: 'string' },
        member: { type: 'object' },
      },
    },
  })
  login(
    @Body() dto: AdminLoginDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ): Promise<AdminLoginResponse> {
    return this.adminAuthService.login(
      dto.email,
      dto.password,
      res,
      req.ip,
      getHeaderValue(req.headers, 'user-agent'),
      dto.mfaCode,
    );
  }

  @Post('refresh')
  @UseGuards(OriginCheckGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle(adminAuthThrottle(20))
  @ApiOkResponse({
    schema: { properties: { accessToken: { type: 'string' } } },
  })
  refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    const refreshToken = getCookieValue(req, this.adminCookieRefreshName);

    if (!refreshToken) {
      throw new UnauthorizedException('No refresh token');
    }

    return this.adminAuthService.refreshTokens(
      refreshToken,
      res,
      req.ip,
      getHeaderValue(req.headers, 'user-agent'),
    );
  }

  @Post('forgot-password')
  @UseGuards(OriginCheckGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle(adminAuthThrottle(5))
  async forgotPassword(
    @Body() dto: AdminForgotPasswordDto,
  ): Promise<{ message: string }> {
    const language = normalizeLanguage(dto.language);
    await this.adminAuthService.forgotPassword(dto.email, language);
    return {
      message: translate(language, 'messages.adminAuth.forgotPassword.success'),
    };
  }

  @Post('reset-password')
  @UseGuards(OriginCheckGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle(adminAuthThrottle(5))
  async resetPassword(
    @Body() dto: AdminResetPasswordDto,
  ): Promise<{ message: string }> {
    const language = normalizeLanguage(dto.language);
    await this.adminAuthService.resetPassword(dto.token, dto.newPassword);
    return {
      message: translate(language, 'messages.adminAuth.resetPassword.success'),
    };
  }

  @Get('sessions')
  @UseGuards(AdminJwtAuthGuard)
  @ApiOkResponse({ type: Array })
  listSessions(
    @CurrentUser() user: AdminAuthenticatedUser,
  ): Promise<AdminSessionResponse[]> {
    return this.adminAuthService.listSessions(user);
  }

  @Get('mfa')
  @UseGuards(AdminJwtAuthGuard)
  @ApiOkResponse({ type: Object })
  getMfaStatus(
    @CurrentUser() user: AdminAuthenticatedUser,
  ): Promise<AdminMfaStatusResponse> {
    return this.adminAuthService.getMfaStatus(user);
  }

  @Post('mfa/setup')
  @UseGuards(OriginCheckGuard, AdminJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle(adminAuthThrottle(5))
  @ApiOkResponse({ type: Object })
  startMfaSetup(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Body() dto: AdminMfaPasswordDto,
  ): Promise<AdminMfaSetupResponse> {
    return this.adminAuthService.startMfaSetup(user, dto.currentPassword);
  }

  @Post('mfa/enable')
  @UseGuards(OriginCheckGuard, AdminJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle(adminAuthThrottle(5))
  @ApiOkResponse({ type: Object })
  enableMfa(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Body() dto: AdminMfaEnableDto,
    @Req() req: Request,
  ): Promise<AdminMfaEnableResponse> {
    return this.adminAuthService.enableMfa(user, dto.code, {
      ip: req.ip,
      sessionId: user.sessionId,
      userAgent: getHeaderValue(req.headers, 'user-agent'),
    });
  }

  @Post('mfa/recovery-codes')
  @UseGuards(OriginCheckGuard, AdminJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle(adminAuthThrottle(5))
  @ApiOkResponse({ type: Object })
  regenerateMfaRecoveryCodes(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Body() dto: AdminMfaChallengeDto,
    @Req() req: Request,
  ): Promise<AdminMfaEnableResponse> {
    return this.adminAuthService.regenerateMfaRecoveryCodes(
      user,
      dto.currentPassword,
      dto.code,
      {
        ip: req.ip,
        sessionId: user.sessionId,
        userAgent: getHeaderValue(req.headers, 'user-agent'),
      },
    );
  }

  @Post('mfa/disable')
  @UseGuards(OriginCheckGuard, AdminJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle(adminAuthThrottle(5))
  @ApiOkResponse({ type: Object })
  disableMfa(
    @CurrentUser() user: AdminAuthenticatedUser,
    @Body() dto: AdminMfaChallengeDto,
    @Req() req: Request,
  ): Promise<AdminMfaStatusResponse> {
    return this.adminAuthService.disableMfa(
      user,
      dto.currentPassword,
      dto.code,
      {
        ip: req.ip,
        sessionId: user.sessionId,
        userAgent: getHeaderValue(req.headers, 'user-agent'),
      },
    );
  }

  @Post('logout')
  @UseGuards(OriginCheckGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle(adminAuthThrottle(20))
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    await this.adminAuthService.logout(
      getCookieValue(req, this.adminCookieRefreshName),
      res,
      {
        ip: req.ip,
        userAgent: getHeaderValue(req.headers, 'user-agent'),
      },
    );
    return { message: translate('en', 'messages.auth.logout.success') };
  }
}

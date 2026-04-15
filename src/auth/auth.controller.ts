import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { OriginCheckGuard } from '../common/guards/origin-check.guard';
import { NoCacheInterceptor } from '../common/interceptors/no-cache.interceptor';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { ConfirmPasswordDto } from './dto/confirm-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SessionResponseDto } from './dto/session-response.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { AuthService } from './auth.service';

const authThrottle = (limit: number) => ({
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

@ApiTags('auth')
@Controller('auth')
@UseInterceptors(NoCacheInterceptor)
export class AuthController {
  private readonly cookieRefreshName: string;

  constructor(
    private readonly authService: AuthService,
    configService: ConfigService,
  ) {
    this.cookieRefreshName = configService.get(
      'COOKIE_REFRESH_NAME',
      'ritora_refresh',
    );
  }

  @Post('register')
  @Public()
  @UseGuards(OriginCheckGuard)
  @Throttle(authThrottle(3))
  @ApiOkResponse({ type: AuthResponseDto })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ): Promise<AuthResponseDto> {
    return this.authService.register(
      dto,
      res,
      req.ip,
      getHeaderValue(req.headers, 'user-agent'),
    );
  }

  @Post('login')
  @Public()
  @UseGuards(OriginCheckGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle(authThrottle(5))
  @ApiOkResponse({ type: AuthResponseDto })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ): Promise<AuthResponseDto> {
    return this.authService.login(
      dto.email,
      dto.password,
      res,
      req.ip,
      getHeaderValue(req.headers, 'user-agent'),
    );
  }

  @Post('refresh')
  @Public()
  @UseGuards(OriginCheckGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({
    schema: { properties: { accessToken: { type: 'string' } } },
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    const refreshToken = getCookieValue(req, this.cookieRefreshName);

    if (!refreshToken) {
      throw new UnauthorizedException('No refresh token');
    }

    return this.authService.refreshTokens(
      refreshToken,
      res,
      req.ip,
      getHeaderValue(req.headers, 'user-agent'),
    );
  }

  @Post('verify-email')
  @Public()
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<{ message: string }> {
    await this.authService.verifyEmail(dto.token);
    return { message: 'Email verified successfully' };
  }

  @Post('resend-verification')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle(authThrottle(3))
  async resendVerification(
    @Body() dto: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    await this.authService.resendVerification(dto.email);
    return {
      message: 'If the email is registered, a verification link has been sent',
    };
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle(authThrottle(3))
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    await this.authService.forgotPassword(dto.email);
    return {
      message: 'If the email is registered, a reset link has been sent',
    };
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { message: 'Password reset successfully' };
  }

  @Get('me')
  @ApiOkResponse({ type: UserResponseDto })
  async me(@CurrentUser('id') userId: string): Promise<UserResponseDto> {
    return this.authService.getMe(userId);
  }

  @Get('sessions')
  @ApiOkResponse({ type: [SessionResponseDto] })
  async sessions(
    @CurrentUser('id') userId: string,
  ): Promise<SessionResponseDto[]> {
    return this.authService.getSessions(userId);
  }

  @Post('logout')
  @UseGuards(OriginCheckGuard)
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    const refreshToken = getCookieValue(req, this.cookieRefreshName);

    if (refreshToken) {
      const dotIndex = refreshToken.indexOf('.');
      if (dotIndex !== -1) {
        const sessionId = refreshToken.substring(0, dotIndex);
        await this.authService.logout(sessionId, res);
        return { message: 'Logged out' };
      }
    }

    res.clearCookie(this.cookieRefreshName, {
      httpOnly: true,
      path: '/api/v1/auth',
    });
    return { message: 'Logged out' };
  }

  @Post('logout-all')
  @UseGuards(OriginCheckGuard)
  @HttpCode(HttpStatus.OK)
  async logoutAll(
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    await this.authService.logoutAll(userId, res);
    return { message: 'All sessions revoked' };
  }

  @Post('export')
  @HttpCode(HttpStatus.OK)
  async exportData(
    @CurrentUser('id') userId: string,
    @Body() dto: ConfirmPasswordDto,
  ): Promise<Record<string, unknown>> {
    return this.authService.exportData(userId, dto.password);
  }

  @Delete('account')
  @HttpCode(HttpStatus.OK)
  async deleteAccount(
    @CurrentUser('id') userId: string,
    @Body() dto: ConfirmPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    await this.authService.deleteAccount(userId, dto.password, res);
    return { message: 'Account deleted' };
  }
}

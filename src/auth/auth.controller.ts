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
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { normalizeLanguage, translate } from '../common/i18n/i18n';
import { setLocaleCookie } from '../common/i18n/locale-cookie';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { OriginCheckGuard } from '../common/guards/origin-check.guard';
import { UserResponseDto } from '../users/dto/user-response.dto';
import {
  AccountDeletionResponseDto,
  AccountDeletionStatus,
} from './dto/account-deletion-response.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { ConfirmPasswordDto } from './dto/confirm-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { GoogleMobileAuthDto } from './dto/google-mobile-auth.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RegisterResponseDto } from './dto/register-response.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SessionResponseDto } from './dto/session-response.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { AppleOAuthCallbackGuard } from './guards/apple-oauth-callback.guard';
import { AppleOAuthGuard } from './guards/apple-oauth.guard';
import { GoogleOAuthCallbackGuard } from './guards/google-oauth-callback.guard';
import { GoogleOAuthGuard } from './guards/google-oauth.guard';
import { OAuthIdentityProfile, OAuthProvider } from './oauth/oauth-profile';
import { GoogleIdTokenVerifierService } from './oauth/google-id-token-verifier.service';
import {
  APPLE_OAUTH_CONTEXT_COOKIE,
  APPLE_OAUTH_STATE_COOKIE,
  GOOGLE_OAUTH_CONTEXT_COOKIE,
  GOOGLE_OAUTH_STATE_COOKIE,
  OAuthStartContext,
} from './oauth/oauth-state';
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

type OAuthRequest = Request & {
  user?: OAuthIdentityProfile;
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly cookieRefreshName: string;
  private readonly webAppUrl: string;
  private readonly cookieDomain: string;
  private readonly cookieSecure: boolean;
  private readonly cookieSameSite: 'lax' | 'strict' | 'none';

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly googleIdTokenVerifier: GoogleIdTokenVerifierService,
  ) {
    this.cookieRefreshName = this.configService.getOrThrow(
      'COOKIE_REFRESH_NAME',
    );
    this.webAppUrl = this.configService.getOrThrow('WEB_APP_URL');
    this.cookieDomain = this.configService.getOrThrow('COOKIE_DOMAIN');
    this.cookieSecure = this.configService.getOrThrow('COOKIE_SECURE');
    this.cookieSameSite = this.configService.getOrThrow('COOKIE_SAME_SITE');
  }

  @Post('register')
  @Public()
  @UseGuards(OriginCheckGuard)
  @Throttle(authThrottle(3))
  @ApiOkResponse({ type: RegisterResponseDto })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
  ): Promise<RegisterResponseDto> {
    const language = normalizeLanguage(dto.preferredLanguage);
    const result = await this.authService.register(dto, req.ip);

    return new RegisterResponseDto(
      translate(language, 'messages.auth.register.verifyEmail'),
      result.user,
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
    const authResponse = await this.authService.login(
      dto.email,
      dto.password,
      res,
      req.ip,
      getHeaderValue(req.headers, 'user-agent'),
    );

    const language = normalizeLanguage(authResponse.user.preferredLanguage);
    setLocaleCookie(res, this.configService, language);

    return authResponse;
  }

  @Get('google')
  @Public()
  @UseGuards(GoogleOAuthGuard)
  @Throttle(authThrottle(5))
  startGoogleOAuth(): void {
    // Passport redirects to Google before this handler runs.
  }

  @Get('google/callback')
  @Public()
  @UseGuards(GoogleOAuthCallbackGuard)
  @Throttle(authThrottle(5))
  async completeGoogleOAuth(
    @Req() req: OAuthRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    if (!req.user) {
      await this.authService.recordOAuthFailureForMonitoring(
        OAuthProvider.Google,
        {
          ip: req.ip,
          reason: 'missing_profile',
        },
      );
      throw new UnauthorizedException('Missing Google profile');
    }

    const authResponse = await this.authService.loginWithGoogle(
      req.user,
      this.getOAuthStartContext(req),
      res,
      req.ip,
      getHeaderValue(req.headers, 'user-agent'),
    );

    const language = normalizeLanguage(authResponse.user.preferredLanguage);
    setLocaleCookie(res, this.configService, language);
    this.clearGoogleOAuthCookies(res);

    res.redirect(this.buildFrontendPathUrl('post-login'));
  }

  @Post('google/mobile')
  @Public()
  @UseGuards(OriginCheckGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle(authThrottle(5))
  @ApiOkResponse({ type: AuthResponseDto })
  async loginWithGoogleMobile(
    @Body() dto: GoogleMobileAuthDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ): Promise<AuthResponseDto> {
    let profile: OAuthIdentityProfile;
    try {
      profile = await this.googleIdTokenVerifier.verify(dto.idToken);
    } catch (error) {
      await this.authService.recordOAuthFailureForMonitoring(
        OAuthProvider.Google,
        {
          ip: req.ip,
          reason: 'invalid_id_token',
        },
      );
      throw error;
    }

    const authResponse = await this.authService.loginWithGoogle(
      profile,
      {
        preferredLanguage: dto.preferredLanguage,
        termsAccepted: dto.termsAccepted,
        privacyPolicyAccepted: dto.privacyPolicyAccepted,
      },
      res,
      req.ip,
      getHeaderValue(req.headers, 'user-agent'),
    );

    const language = normalizeLanguage(authResponse.user.preferredLanguage);
    setLocaleCookie(res, this.configService, language);

    return authResponse;
  }

  @Get('apple')
  @Public()
  @UseGuards(AppleOAuthGuard)
  @Throttle(authThrottle(5))
  startAppleOAuth(): void {
    // Passport redirects to Apple before this handler runs.
  }

  @Post('apple/callback')
  @Public()
  @UseGuards(AppleOAuthCallbackGuard)
  @Throttle(authThrottle(5))
  async completeAppleOAuth(
    @Req() req: OAuthRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    if (!req.user) {
      await this.authService.recordOAuthFailureForMonitoring(
        OAuthProvider.Apple,
        {
          ip: req.ip,
          reason: 'missing_profile',
        },
      );
      throw new UnauthorizedException('Missing Apple profile');
    }

    const authResponse = await this.authService.loginWithApple(
      req.user,
      this.getOAuthStartContext(req, APPLE_OAUTH_CONTEXT_COOKIE),
      res,
      req.ip,
      getHeaderValue(req.headers, 'user-agent'),
    );

    const language = normalizeLanguage(authResponse.user.preferredLanguage);
    setLocaleCookie(res, this.configService, language);
    this.clearOAuthCookies(res, {
      stateCookie: APPLE_OAUTH_STATE_COOKIE,
      contextCookie: APPLE_OAUTH_CONTEXT_COOKIE,
      path: '/api/v1/auth/apple',
      sameSite: this.cookieSecure ? 'none' : 'lax',
    });

    res.redirect(this.buildFrontendPathUrl('post-login'));
  }

  @Post('refresh')
  @Public()
  @UseGuards(OriginCheckGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle(authThrottle(20))
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

    const refreshResponse = await this.authService.refreshTokens(
      refreshToken,
      res,
      req.ip,
      getHeaderValue(req.headers, 'user-agent'),
    );

    setLocaleCookie(
      res,
      this.configService,
      normalizeLanguage(refreshResponse.preferredLanguage),
    );

    return { accessToken: refreshResponse.accessToken };
  }

  @Post('verify-email')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle(authThrottle(10))
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<{ message: string }> {
    await this.authService.verifyEmail(dto.token);
    return {
      message: translate(
        normalizeLanguage(dto.language),
        'messages.auth.verifyEmail.success',
      ),
    };
  }

  @Post('resend-verification')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle(authThrottle(3))
  async resendVerification(
    @Body() dto: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    const language = normalizeLanguage(dto.language);
    await this.authService.resendVerification(dto.email, language);
    return {
      message: translate(language, 'messages.auth.resendVerification.success'),
    };
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle(authThrottle(3))
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    const language = normalizeLanguage(dto.language);
    await this.authService.forgotPassword(dto.email, language, req.ip);
    return {
      message: translate(language, 'messages.auth.forgotPassword.success'),
    };
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle(authThrottle(10))
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return {
      message: translate(
        normalizeLanguage(dto.language),
        'messages.auth.resetPassword.success',
      ),
    };
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
    @CurrentUser('language') language: string | undefined,
    @CurrentUser('id') userId: string,
    @CurrentUser('sessionId') sessionId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    const refreshToken = getCookieValue(req, this.cookieRefreshName);

    if (refreshToken) {
      await this.authService.logout(refreshToken, res);
      return {
        message: translate(
          normalizeLanguage(language),
          'messages.auth.logout.success',
        ),
      };
    }

    await this.authService.logoutSession(userId, sessionId, res);
    return {
      message: translate(
        normalizeLanguage(language),
        'messages.auth.logout.success',
      ),
    };
  }

  @Post('logout-all')
  @UseGuards(OriginCheckGuard)
  @HttpCode(HttpStatus.OK)
  async logoutAll(
    @CurrentUser('id') userId: string,
    @CurrentUser('language') language: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    await this.authService.logoutAll(userId, res);
    return {
      message: translate(
        normalizeLanguage(language),
        'messages.auth.logoutAll.success',
      ),
    };
  }

  @Post('export')
  @HttpCode(HttpStatus.OK)
  @Throttle(authThrottle(5))
  async exportData(
    @CurrentUser('id') userId: string,
    @Body() dto: ConfirmPasswordDto,
  ): Promise<Record<string, unknown>> {
    return this.authService.exportData(userId, dto.password);
  }

  @Delete('account')
  @HttpCode(HttpStatus.OK)
  @Throttle(authThrottle(5))
  async deleteAccount(
    @CurrentUser('id') userId: string,
    @CurrentUser('language') language: string | undefined,
    @Body() dto: ConfirmPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccountDeletionResponseDto> {
    const normalizedLanguage = normalizeLanguage(language);
    const result = await this.authService.deleteAccount(
      userId,
      dto.password,
      res,
      normalizedLanguage,
    );
    return this.toAccountDeletionResponse(result, normalizedLanguage);
  }

  @Post('account/deletion/confirm')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle(authThrottle(10))
  async confirmAccountDeletion(
    @Body() dto: VerifyEmailDto,
  ): Promise<AccountDeletionResponseDto> {
    const language = normalizeLanguage(dto.language);
    const result = await this.authService.confirmAccountDeletion(
      dto.token,
      language,
    );
    return this.toAccountDeletionResponse(result, language);
  }

  @Post('account/deletion/cancel')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle(authThrottle(10))
  async cancelAccountDeletion(
    @Body() dto: VerifyEmailDto,
  ): Promise<{ message: string }> {
    const language = normalizeLanguage(dto.language);
    await this.authService.cancelAccountDeletion(dto.token, language);
    return {
      message: translate(language, 'messages.auth.deleteAccount.cancelled'),
    };
  }

  private getOAuthStartContext(
    req: Request,
    contextCookie = GOOGLE_OAUTH_CONTEXT_COOKIE,
  ): OAuthStartContext {
    const rawContext = getCookieValue(req, contextCookie);

    if (!rawContext) {
      return {
        preferredLanguage: 'en',
        termsAccepted: false,
        privacyPolicyAccepted: false,
      };
    }

    try {
      const parsed = JSON.parse(
        Buffer.from(rawContext, 'base64url').toString('utf8'),
      ) as Partial<OAuthStartContext>;

      return {
        preferredLanguage:
          typeof parsed.preferredLanguage === 'string'
            ? parsed.preferredLanguage
            : 'en',
        termsAccepted: parsed.termsAccepted === true,
        privacyPolicyAccepted: parsed.privacyPolicyAccepted === true,
      };
    } catch {
      return {
        preferredLanguage: 'en',
        termsAccepted: false,
        privacyPolicyAccepted: false,
      };
    }
  }

  private clearGoogleOAuthCookies(res: Response): void {
    this.clearOAuthCookies(res, {
      stateCookie: GOOGLE_OAUTH_STATE_COOKIE,
      contextCookie: GOOGLE_OAUTH_CONTEXT_COOKIE,
      path: '/api/v1/auth/google',
      sameSite: this.cookieSameSite,
    });
  }

  private clearOAuthCookies(
    res: Response,
    oauthCookies: {
      stateCookie: string;
      contextCookie: string;
      path: string;
      sameSite: 'lax' | 'strict' | 'none';
    },
  ): void {
    const cookieOptions = {
      path: oauthCookies.path,
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: oauthCookies.sameSite,
      ...(this.cookieDomain ? { domain: this.cookieDomain } : {}),
    } as const;

    res.clearCookie(oauthCookies.stateCookie, cookieOptions);
    res.clearCookie(oauthCookies.contextCookie, cookieOptions);
  }

  private buildFrontendPathUrl(path: string): string {
    const base = new URL(this.webAppUrl);
    const basePath = base.pathname.replace(/\/$/, '');
    base.pathname = `${basePath}/${path.replace(/^\//, '')}`;
    base.search = '';
    base.hash = '';
    return base.toString();
  }

  private toAccountDeletionResponse(
    result: { status: AccountDeletionStatus; scheduledFor?: string },
    language: ReturnType<typeof normalizeLanguage>,
  ): AccountDeletionResponseDto {
    const messageKey =
      result.status === AccountDeletionStatus.Scheduled
        ? 'messages.auth.deleteAccount.scheduled'
        : 'messages.auth.deleteAccount.confirmationRequired';

    return new AccountDeletionResponseDto(
      result.status,
      translate(language, messageKey),
      result.scheduledFor,
    );
  }
}

import { ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { randomBytes } from 'crypto';
import { Request, Response } from 'express';
import { OAuthProvider } from '../oauth/oauth-profile';
import {
  APPLE_OAUTH_CONTEXT_COOKIE,
  APPLE_OAUTH_STATE_COOKIE,
  OAUTH_STATE_BYTES,
} from '../oauth/oauth-state';

type RequestWithOAuthState = Request & {
  oauthState?: string;
};

@Injectable()
export class AppleOAuthGuard extends AuthGuard(OAuthProvider.Apple) {
  private readonly cookieDomain: string;
  private readonly cookieSecure: boolean;
  private readonly cookieSameSite: 'lax' | 'strict' | 'none';

  constructor(private readonly configService: ConfigService) {
    super();
    this.cookieDomain = configService.getOrThrow('COOKIE_DOMAIN');
    this.cookieSecure = configService.getOrThrow('COOKIE_SECURE');
    this.cookieSameSite = this.cookieSecure ? 'none' : 'lax';
  }

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestWithOAuthState>();
    const response = context.switchToHttp().getResponse<Response>();
    const state = randomBytes(OAUTH_STATE_BYTES).toString('hex');
    const preferredLanguage =
      typeof request.query.language === 'string'
        ? request.query.language
        : 'en';
    const startContext = {
      preferredLanguage,
      termsAccepted: request.query.termsAccepted === 'true',
      privacyPolicyAccepted: request.query.privacyPolicyAccepted === 'true',
    };

    request.oauthState = state;
    response.cookie(APPLE_OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: this.cookieSameSite,
      path: '/api/v1/auth/apple',
      maxAge: 5 * 60 * 1000,
      ...(this.cookieDomain ? { domain: this.cookieDomain } : {}),
    });
    response.cookie(
      APPLE_OAUTH_CONTEXT_COOKIE,
      Buffer.from(JSON.stringify(startContext)).toString('base64url'),
      {
        httpOnly: true,
        secure: this.cookieSecure,
        sameSite: this.cookieSameSite,
        path: '/api/v1/auth/apple',
        maxAge: 5 * 60 * 1000,
        ...(this.cookieDomain ? { domain: this.cookieDomain } : {}),
      },
    );

    return super.canActivate(context);
  }

  getAuthenticateOptions(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestWithOAuthState>();

    return {
      state: request.oauthState,
      session: false,
    };
  }
}

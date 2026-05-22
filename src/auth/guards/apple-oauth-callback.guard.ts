import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { AuthService } from '../auth.service';
import { OAuthProvider } from '../oauth/oauth-profile';
import { APPLE_OAUTH_STATE_COOKIE } from '../oauth/oauth-state';

@Injectable()
export class AppleOAuthCallbackGuard extends AuthGuard(OAuthProvider.Apple) {
  constructor(private readonly authService: AuthService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const expectedState = cookies?.[APPLE_OAUTH_STATE_COOKIE];
    const receivedState =
      typeof request.body === 'object' &&
      request.body !== null &&
      'state' in request.body
        ? (request.body as Record<string, unknown>).state
        : request.query.state;

    if (
      typeof expectedState !== 'string' ||
      typeof receivedState !== 'string' ||
      expectedState !== receivedState
    ) {
      await this.authService.recordOAuthFailureForMonitoring(
        OAuthProvider.Apple,
        {
          ip: request.ip,
          reason: 'invalid_state',
        },
      );
      throw new ForbiddenException('Invalid OAuth state');
    }

    return (await super.canActivate(context)) as boolean;
  }

  getAuthenticateOptions() {
    return {
      session: false,
    };
  }
}

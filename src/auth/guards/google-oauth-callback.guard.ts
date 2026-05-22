import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { AuthService } from '../auth.service';
import { OAuthProvider } from '../oauth/oauth-profile';
import { GOOGLE_OAUTH_STATE_COOKIE } from '../oauth/oauth-state';

@Injectable()
export class GoogleOAuthCallbackGuard extends AuthGuard(OAuthProvider.Google) {
  constructor(private readonly authService: AuthService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const expectedState = cookies?.[GOOGLE_OAUTH_STATE_COOKIE];
    const receivedState = request.query.state;

    if (
      typeof expectedState !== 'string' ||
      typeof receivedState !== 'string' ||
      expectedState !== receivedState
    ) {
      await this.authService.recordOAuthFailureForMonitoring(
        OAuthProvider.Google,
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

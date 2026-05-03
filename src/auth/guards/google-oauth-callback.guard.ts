import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { OAuthProvider } from '../oauth/oauth-profile';
import { GOOGLE_OAUTH_STATE_COOKIE } from '../oauth/oauth-state';

@Injectable()
export class GoogleOAuthCallbackGuard extends AuthGuard(OAuthProvider.Google) {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const expectedState = cookies?.[GOOGLE_OAUTH_STATE_COOKIE];
    const receivedState = request.query.state;

    if (
      typeof expectedState !== 'string' ||
      typeof receivedState !== 'string' ||
      expectedState !== receivedState
    ) {
      throw new ForbiddenException('Invalid OAuth state');
    }

    return super.canActivate(context);
  }

  getAuthenticateOptions() {
    return {
      session: false,
    };
  }
}

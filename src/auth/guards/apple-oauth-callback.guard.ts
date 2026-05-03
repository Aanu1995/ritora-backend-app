import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { OAuthProvider } from '../oauth/oauth-profile';
import { APPLE_OAUTH_STATE_COOKIE } from '../oauth/oauth-state';

@Injectable()
export class AppleOAuthCallbackGuard extends AuthGuard(OAuthProvider.Apple) {
  canActivate(context: ExecutionContext) {
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

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { UsersService } from '../../users/users.service';
import { readTimeZoneHeaderFromHeaders } from '../timezone/timezone-header.utils';
import { canonicalizeTimeZone } from '../timezone/timezone.utils';

type AuthenticatedRequest = Request & {
  user?: {
    id?: string;
    timeZone?: string | null;
  };
};

type CapturableUser = {
  id: string;
  timeZone?: string | null;
};

function resolveRequestTimeZone(request: AuthenticatedRequest): string | null {
  return canonicalizeTimeZone(readTimeZoneHeaderFromHeaders(request.headers));
}

@Injectable()
export class AuthenticatedTimezoneCaptureInterceptor implements NestInterceptor {
  private readonly logger = new Logger(
    AuthenticatedTimezoneCaptureInterceptor.name,
  );

  constructor(private readonly usersService: UsersService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    const requestTimeZone = resolveRequestTimeZone(request);

    if (requestTimeZone && this.shouldCaptureTimeZone(user)) {
      await this.captureRequestTimeZone(request, user.id, requestTimeZone);
    }

    return next.handle();
  }

  private shouldCaptureTimeZone(
    user: AuthenticatedRequest['user'],
  ): user is CapturableUser {
    return Boolean(user?.id && !user.timeZone);
  }

  private async captureRequestTimeZone(
    request: AuthenticatedRequest,
    userId: string,
    requestTimeZone: string,
  ): Promise<void> {
    try {
      const persistedUser = await this.usersService.captureTimeZoneIfMissing(
        userId,
        requestTimeZone,
      );
      this.applyCapturedTimeZone(
        request,
        persistedUser.time_zone ?? requestTimeZone,
      );
    } catch {
      this.logger.warn(`Failed to capture timezone for user ${userId}`);
      this.applyCapturedTimeZone(request, requestTimeZone);
    }
  }

  private applyCapturedTimeZone(
    request: AuthenticatedRequest,
    timeZone: string,
  ): void {
    if (!request.user) {
      return;
    }

    request.user = {
      ...request.user,
      timeZone,
    };
  }
}

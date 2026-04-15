import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class OriginCheckGuard implements CanActivate {
  private readonly allowedOrigin: string;

  constructor(private readonly configService: ConfigService) {
    this.allowedOrigin = this.configService.get<string>(
      'FRONTEND_URL',
      'http://localhost:3000',
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.headers['origin'] as string | undefined;
    const referer = request.headers['referer'] as string | undefined;

    if (origin && this.matchesOrigin(origin)) {
      return true;
    }

    if (referer && this.matchesOrigin(referer)) {
      return true;
    }

    throw new ForbiddenException('Origin not allowed');
  }

  private matchesOrigin(value: string): boolean {
    try {
      const url = new URL(value);
      return url.origin === this.allowedOrigin;
    } catch {
      return false;
    }
  }
}

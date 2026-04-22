import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

function readHeaderValue(header: string | string[] | undefined): string | null {
  if (Array.isArray(header)) {
    return header[0] ?? null;
  }

  return typeof header === 'string' ? header : null;
}

@Injectable()
export class OriginCheckGuard implements CanActivate {
  private readonly allowedOrigins: Set<string>;

  constructor(private readonly configService: ConfigService) {
    const configuredOrigins =
      this.configService.get<string>('CORS_ORIGINS') ??
      this.configService.get<string>('WEB_APP_URL', 'http://localhost:3000');

    this.allowedOrigins = new Set(
      configuredOrigins
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
        .map((origin) => {
          try {
            return new URL(origin).origin;
          } catch {
            return origin;
          }
        }),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = readHeaderValue(request.headers['origin']);
    const referer = readHeaderValue(request.headers['referer']);
    const fetchSite = readHeaderValue(request.headers['sec-fetch-site']);

    if (fetchSite === 'cross-site') {
      throw new ForbiddenException('Origin not allowed');
    }

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
      return this.allowedOrigins.has(url.origin);
    } catch {
      return false;
    }
  }
}

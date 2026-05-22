import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import {
  HTTP_CACHE_POLICY_KEY,
  HttpCachePolicy,
} from '../decorators/http-cache.decorator';

enum CacheHeader {
  CacheControl = 'Cache-Control',
  Expires = 'Expires',
  Pragma = 'Pragma',
}

enum ConditionalRequestHeader {
  IfModifiedSince = 'if-modified-since',
  IfNoneMatch = 'if-none-match',
}

const DEFAULT_PRIVATE_NO_STORE = 'private, no-store, max-age=0';
const NO_CACHE = 'no-cache';
const EXPIRED_IMMEDIATELY = '0';

@Injectable()
export class NoCacheInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.shouldAllowBrowserCache(context)) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    delete request.headers[ConditionalRequestHeader.IfNoneMatch];
    delete request.headers[ConditionalRequestHeader.IfModifiedSince];

    response.setHeader(CacheHeader.CacheControl, DEFAULT_PRIVATE_NO_STORE);
    response.setHeader(CacheHeader.Pragma, NO_CACHE);
    response.setHeader(CacheHeader.Expires, EXPIRED_IMMEDIATELY);

    return next.handle();
  }

  private shouldAllowBrowserCache(context: ExecutionContext): boolean {
    const policy = this.reflector.getAllAndOverride<HttpCachePolicy>(
      HTTP_CACHE_POLICY_KEY,
      [context.getHandler(), context.getClass()],
    );

    return policy === HttpCachePolicy.AllowBrowserCache;
  }
}

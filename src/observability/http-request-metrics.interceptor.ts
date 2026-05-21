import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable, catchError, finalize, throwError } from 'rxjs';
import { DataSource } from 'typeorm';
import { ulid } from 'ulid';

const MAX_ROUTE_LENGTH = 180;
const FALLBACK_METHOD = 'UNKNOWN';
const FALLBACK_ROUTE = 'unmatched';
const HEALTH_ROUTE_PREFIXES = ['/health', '/api/v1/health'] as const;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_FLUSH_INTERVAL_MS = 5_000;
const DEFAULT_MAX_BUFFER_SIZE = 2_000;
const DEFAULT_RETENTION_DAYS = 30;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const WARNING_THROTTLE_MS = 60_000;
export const HTTP_REQUEST_METRICS_OPTIONS = 'HTTP_REQUEST_METRICS_OPTIONS';

type RoutedRequest = {
  baseUrl?: unknown;
  method?: unknown;
  route?: unknown;
};

type HttpRequestMetricRecord = {
  durationMs: number;
  method: string;
  occurredAt: Date;
  route: string;
  statusCode: number;
};

type HttpRequestMetricsOptions = {
  batchSize?: number;
  flushIntervalMs?: number;
  maxBufferSize?: number;
  retentionDays?: number;
};

function statusFromError(error: unknown): number {
  if (error instanceof HttpException) {
    return error.getStatus();
  }

  return 500;
}

function normalizeRoute(request: RoutedRequest): string {
  const baseUrl = typeof request.baseUrl === 'string' ? request.baseUrl : '';
  const routeValue = request.route;
  const routePath =
    typeof routeValue === 'object' &&
    routeValue !== null &&
    'path' in routeValue &&
    typeof routeValue.path === 'string'
      ? routeValue.path
      : '';
  const normalizedRoute = `${baseUrl}${routePath}`
    .replace(/\/{2,}/g, '/')
    .trim();

  if (!normalizedRoute || normalizedRoute === '/') {
    return FALLBACK_ROUTE;
  }

  return normalizedRoute.slice(0, MAX_ROUTE_LENGTH);
}

function shouldRecordRoute(route: string): boolean {
  return (
    route !== FALLBACK_ROUTE &&
    !HEALTH_ROUTE_PREFIXES.some((prefix) => route.startsWith(prefix))
  );
}

@Injectable()
export class HttpRequestMetricsInterceptor
  implements NestInterceptor, OnModuleDestroy
{
  private readonly logger = new Logger(HttpRequestMetricsInterceptor.name);
  private readonly batchSize: number;
  private readonly maxBufferSize: number;
  private readonly flushIntervalMs: number;
  private readonly retentionDays: number;
  private readonly buffer: HttpRequestMetricRecord[] = [];
  private flushPromise: Promise<void> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private lastCleanupAt = Date.now();
  private lastWarningAt = 0;

  constructor(
    private readonly dataSource: DataSource,
    @Optional()
    @Inject(HTTP_REQUEST_METRICS_OPTIONS)
    options?: HttpRequestMetricsOptions,
  ) {
    const resolvedOptions = options ?? {};
    this.batchSize = Math.max(
      1,
      resolvedOptions.batchSize ?? DEFAULT_BATCH_SIZE,
    );
    this.maxBufferSize = Math.max(
      1,
      resolvedOptions.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE,
    );
    this.flushIntervalMs = Math.max(
      0,
      resolvedOptions.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
    );
    this.retentionDays = Math.max(
      1,
      resolvedOptions.retentionDays ?? DEFAULT_RETENTION_DAYS,
    );
    this.startFlushTimer();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    await this.flushAll();
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const startedAt = Date.now();
    const http = context.switchToHttp();
    const request = http.getRequest<RoutedRequest>();
    const response = http.getResponse<Response>();
    const method =
      typeof request.method === 'string'
        ? request.method.toUpperCase()
        : FALLBACK_METHOD;
    const route = normalizeRoute(request);
    let errorStatusCode: number | null = null;

    return next.handle().pipe(
      catchError((error: unknown) => {
        errorStatusCode = statusFromError(error);
        return throwError(() => error);
      }),
      finalize(() => {
        if (!shouldRecordRoute(route)) {
          return;
        }

        const finalStatusCode = errorStatusCode ?? response.statusCode;

        this.enqueueMetric({
          durationMs: Math.max(Date.now() - startedAt, 0),
          method,
          occurredAt: new Date(),
          route,
          statusCode: finalStatusCode,
        });
      }),
    );
  }

  private startFlushTimer(): void {
    if (this.flushIntervalMs === 0) {
      return;
    }

    this.flushTimer = setInterval(() => {
      void this.flushBatch();
    }, this.flushIntervalMs);
    this.flushTimer.unref?.();
  }

  private enqueueMetric(input: HttpRequestMetricRecord): void {
    if (this.buffer.length >= this.maxBufferSize) {
      this.warnThrottled(
        'HTTP request metric buffer is full; dropping metric.',
      );
      return;
    }

    this.buffer.push(input);
    if (this.buffer.length >= this.batchSize) {
      void this.flushBatch();
    }
  }

  private async flushAll(): Promise<void> {
    while (this.buffer.length > 0 || this.flushPromise) {
      await this.flushBatch();
    }
  }

  private async flushBatch(): Promise<void> {
    if (this.flushPromise) {
      await this.flushPromise;
      return;
    }

    const batch = this.buffer.splice(0, this.batchSize);
    if (batch.length === 0) {
      return;
    }

    this.flushPromise = this.persistBatch(batch).finally(() => {
      this.flushPromise = null;
    });
    await this.flushPromise;

    if (this.buffer.length >= this.batchSize) {
      void this.flushBatch();
    }
  }

  private async persistBatch(batch: HttpRequestMetricRecord[]): Promise<void> {
    try {
      await this.dataSource.query(
        `
          INSERT INTO http_request_metrics (
            id,
            method,
            route,
            status_code,
            duration_ms,
            occurred_at
          )
          SELECT *
          FROM unnest(
            $1::varchar[],
            $2::varchar[],
            $3::varchar[],
            $4::integer[],
            $5::integer[],
            $6::timestamptz[]
          )
        `,
        [
          batch.map(() => ulid()),
          batch.map((metric) => metric.method),
          batch.map((metric) => metric.route),
          batch.map((metric) => metric.statusCode),
          batch.map((metric) => metric.durationMs),
          batch.map((metric) => metric.occurredAt),
        ],
      );
      void this.deleteExpiredMetricsIfDue();
    } catch {
      this.warnThrottled('Failed to persist HTTP request metrics.');
    }
  }

  private async deleteExpiredMetricsIfDue(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCleanupAt < CLEANUP_INTERVAL_MS) {
      return;
    }

    this.lastCleanupAt = now;
    try {
      await this.dataSource.query(
        `
          DELETE FROM http_request_metrics
          WHERE occurred_at < now() - ($1::integer * interval '1 day')
        `,
        [this.retentionDays],
      );
    } catch {
      this.warnThrottled('Failed to delete expired HTTP request metrics.');
    }
  }

  private warnThrottled(message: string): void {
    const now = Date.now();
    if (now - this.lastWarningAt < WARNING_THROTTLE_MS) {
      return;
    }

    this.lastWarningAt = now;
    this.logger.warn(message);
  }
}

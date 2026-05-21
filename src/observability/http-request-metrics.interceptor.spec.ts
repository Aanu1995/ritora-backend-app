import {
  BadRequestException,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { of, throwError, lastValueFrom } from 'rxjs';
import { DataSource } from 'typeorm';
import { HttpRequestMetricsInterceptor } from './http-request-metrics.interceptor';

type RequestLike = {
  baseUrl?: string;
  method?: string;
  route?: {
    path?: string;
  };
};

type ResponseLike = {
  statusCode?: number;
};

function createExecutionContext(
  request: RequestLike,
  response: ResponseLike,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as ExecutionContext;
}

describe('HttpRequestMetricsInterceptor', () => {
  it('can be resolved by Nest without explicit metrics options', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        HttpRequestMetricsInterceptor,
        {
          provide: DataSource,
          useValue: { query: jest.fn() },
        },
      ],
    }).compile();

    const interceptor = moduleRef.get(HttpRequestMetricsInterceptor);

    expect(interceptor).toBeInstanceOf(HttpRequestMetricsInterceptor);
    await interceptor.onModuleDestroy();
    await moduleRef.close();
  });

  it('records only privacy-safe route metrics for successful requests', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const interceptor = new HttpRequestMetricsInterceptor(
      {
        query,
      } as unknown as DataSource,
      {
        flushIntervalMs: 0,
      },
    );
    const context = createExecutionContext(
      {
        baseUrl: '/admin/users',
        method: 'GET',
        route: { path: '/:id' },
      },
      { statusCode: 200 },
    );

    await lastValueFrom(
      interceptor.intercept(context, { handle: () => of({}) }),
    );

    expect(query).not.toHaveBeenCalled();
    await interceptor.onModuleDestroy();
    expect(query).toHaveBeenCalledWith(expect.stringContaining('unnest'), [
      [expect.any(String)],
      ['GET'],
      ['/admin/users/:id'],
      [200],
      [expect.any(Number)],
      [expect.any(Date)],
    ]);
    expect(JSON.stringify(query.mock.calls)).not.toContain('user-123');
  });

  it('records expected error status without swallowing the request failure', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const interceptor = new HttpRequestMetricsInterceptor(
      {
        query,
      } as unknown as DataSource,
      {
        flushIntervalMs: 0,
      },
    );
    const context = createExecutionContext(
      {
        baseUrl: '/admin/auth',
        method: 'POST',
        route: { path: '/login' },
      },
      { statusCode: 201 },
    );

    await expect(
      lastValueFrom(
        interceptor.intercept(context, {
          handle: () => throwError(() => new BadRequestException('Invalid')),
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await interceptor.onModuleDestroy();
    expect(query).toHaveBeenCalledWith(expect.stringContaining('unnest'), [
      [expect.any(String)],
      ['POST'],
      ['/admin/auth/login'],
      [400],
      [expect.any(Number)],
      [expect.any(Date)],
    ]);
  });

  it('skips noisy health endpoints and never blocks the response on write errors', async () => {
    const query = jest
      .fn()
      .mockRejectedValue(new InternalServerErrorException());
    const interceptor = new HttpRequestMetricsInterceptor(
      {
        query,
      } as unknown as DataSource,
      {
        flushIntervalMs: 0,
      },
    );
    const healthContext = createExecutionContext(
      {
        baseUrl: '/health',
        method: 'GET',
        route: { path: '' },
      },
      { statusCode: 200 },
    );
    const versionedHealthContext = createExecutionContext(
      {
        baseUrl: '/api/v1/health',
        method: 'GET',
        route: { path: '' },
      },
      { statusCode: 200 },
    );
    const adminContext = createExecutionContext(
      {
        baseUrl: '/admin/metrics',
        method: 'GET',
        route: { path: '/overview' },
      },
      { statusCode: 200 },
    );

    await lastValueFrom(
      interceptor.intercept(healthContext, { handle: () => of({}) }),
    );
    await lastValueFrom(
      interceptor.intercept(versionedHealthContext, { handle: () => of({}) }),
    );
    await expect(
      lastValueFrom(
        interceptor.intercept(adminContext, { handle: () => of({}) }),
      ),
    ).resolves.toEqual({});

    await interceptor.onModuleDestroy();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('bounds the in-memory queue when telemetry writes fall behind', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const interceptor = new HttpRequestMetricsInterceptor(
      {
        query,
      } as unknown as DataSource,
      {
        batchSize: 10,
        flushIntervalMs: 0,
        maxBufferSize: 1,
      },
    );
    const context = createExecutionContext(
      {
        baseUrl: '/admin/users',
        method: 'GET',
        route: { path: '' },
      },
      { statusCode: 200 },
    );

    await lastValueFrom(
      interceptor.intercept(context, { handle: () => of({}) }),
    );
    await lastValueFrom(
      interceptor.intercept(context, { handle: () => of({}) }),
    );
    await interceptor.onModuleDestroy();

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual([
      [expect.any(String)],
      ['GET'],
      ['/admin/users'],
      [200],
      [expect.any(Number)],
      [expect.any(Date)],
    ]);
  });
});

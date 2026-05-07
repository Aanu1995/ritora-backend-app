import { randomUUID } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { ConfigService } from '@nestjs/config';
import { trace } from '@opentelemetry/api';
import { Options as PinoHttpOptions } from 'pino-http';

const REDACTED = '[Redacted]';

export function buildPinoHttpOptions(
  configService: ConfigService,
): PinoHttpOptions<IncomingMessage, ServerResponse> {
  return {
    level: toPinoLogLevel(configService.getOrThrow<string>('LOG_LEVEL')),
    redact: {
      censor: REDACTED,
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-csrf-token"]',
        'req.headers["x-api-key"]',
        'res.headers["set-cookie"]',
        '*.password',
        '*.token',
        '*.refreshToken',
        '*.accessToken',
        '*.note',
        '*.notes',
        '*.reason',
        '*.requestContext',
        '*.generationContext',
        '*.generation_context',
        '*.ai_explanation',
        '*.safety_flags',
      ],
    },
    customAttributeKeys: {
      req: 'request',
      res: 'response',
      err: 'error',
      reqId: 'requestId',
      responseTime: 'durationMs',
    },
    genReqId: (request, response) => {
      const incomingId = request.headers['x-request-id'];
      const requestId =
        typeof incomingId === 'string' && incomingId.trim()
          ? incomingId.trim().slice(0, 96)
          : randomUUID();
      response.setHeader('x-request-id', requestId);
      return requestId;
    },
    customProps: () => {
      const spanContext = trace.getActiveSpan()?.spanContext();
      return spanContext
        ? {
            traceId: spanContext.traceId,
            spanId: spanContext.spanId,
          }
        : {};
    },
    customLogLevel: (_request, response, error) => {
      if (error || response.statusCode >= 500) return 'error';
      if (response.statusCode >= 400) return 'warn';
      return 'info';
    },
    customSuccessMessage: (request, response) =>
      `${request.method ?? 'UNKNOWN'} ${request.url ?? ''} ${response.statusCode}`,
    customErrorMessage: (request, response) =>
      `${request.method ?? 'UNKNOWN'} ${request.url ?? ''} ${response.statusCode}`,
  };
}

export function toPinoLogLevel(level: string): PinoHttpOptions['level'] {
  switch (level) {
    case 'error':
    case 'warn':
    case 'debug':
      return level;
    case 'verbose':
      return 'trace';
    case 'log':
    default:
      return 'info';
  }
}

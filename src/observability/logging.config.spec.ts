import { ConfigService } from '@nestjs/config';
import { buildPinoHttpOptions, toPinoLogLevel } from './logging.config';

describe('logging config', () => {
  it('uses structured request logs with sensitive field redaction', () => {
    const options = buildPinoHttpOptions(config({ LOG_LEVEL: 'debug' }));

    expect(options.level).toBe('debug');
    expect(options.redact).toEqual(
      expect.objectContaining({
        censor: '[Redacted]',
        paths: expect.arrayContaining([
          'req.headers.authorization',
          'req.headers.cookie',
          '*.note',
          '*.requestContext',
          '*.generation_context',
          '*.ai_explanation',
        ]),
      }),
    );
    expect(options.customAttributeKeys).toEqual(
      expect.objectContaining({
        reqId: 'requestId',
        responseTime: 'durationMs',
      }),
    );
  });

  it('maps Nest log levels to Pino levels', () => {
    expect(toPinoLogLevel('log')).toBe('info');
    expect(toPinoLogLevel('verbose')).toBe('trace');
    expect(toPinoLogLevel('warn')).toBe('warn');
  });
});

function config(values: Record<string, unknown>): ConfigService {
  return {
    getOrThrow: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

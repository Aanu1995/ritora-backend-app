import { ConfigService } from '@nestjs/config';

export function getNumberConfig(
  configService: ConfigService,
  key: string,
): number {
  const value: unknown = configService.getOrThrow(key);

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  throw new Error(`Configuration value ${key} must be a finite number`);
}

export function getBooleanConfig(
  configService: ConfigService,
  key: string,
): boolean {
  const value: unknown = configService.getOrThrow(key);

  if (typeof value === 'boolean') {
    return value;
  }

  throw new Error(`Configuration value ${key} must be a boolean`);
}

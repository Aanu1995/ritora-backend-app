import { ConfigService } from '@nestjs/config';

export function getNumberConfig(
  configService: ConfigService,
  key: string,
  fallback: number,
): number {
  const value: unknown = configService.get(key);

  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function getBooleanConfig(
  configService: ConfigService,
  key: string,
  fallback: boolean,
): boolean {
  const value: unknown = configService.get(key);

  return typeof value === 'boolean' ? value : fallback;
}

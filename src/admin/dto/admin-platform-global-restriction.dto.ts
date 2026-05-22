import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PlatformGlobalRestrictionCapability } from '../../platform-controls/platform-global-restrictions';

export class AdminPlatformGlobalRestrictionParamDto {
  @IsEnum(PlatformGlobalRestrictionCapability, {
    message: 'validation.capability.invalid',
  })
  capability!: PlatformGlobalRestrictionCapability;
}

export class EnablePlatformGlobalRestrictionDto {
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'validation.expiresAt.invalid' })
  expiresAt?: string | null;

  @IsString()
  @MinLength(8, { message: 'validation.internalNote.required' })
  @MaxLength(1000, { message: 'validation.internalNote.maxLength' })
  internalNote!: string;

  @IsString()
  @MinLength(8, { message: 'validation.reason.required' })
  @MaxLength(500, { message: 'validation.reason.maxLength' })
  reason!: string;
}

export class DisablePlatformGlobalRestrictionDto {
  @IsString()
  @MinLength(8, { message: 'validation.reason.required' })
  @MaxLength(500, { message: 'validation.reason.maxLength' })
  reason!: string;
}

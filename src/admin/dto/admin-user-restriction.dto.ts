import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRestrictionCapability } from '../../users/user-restrictions';

export class AdminUserRestrictionDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'validation.capabilities.required' })
  @ArrayUnique({ message: 'validation.capabilities.unique' })
  @IsEnum(UserRestrictionCapability, {
    each: true,
    message: 'validation.capabilities.invalid',
  })
  capabilities!: UserRestrictionCapability[];

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

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'validation.userMessage.maxLength' })
  userMessage?: string | null;
}

export class AdminUserUnrestrictionDto {
  @IsString()
  @MinLength(8, { message: 'validation.reason.required' })
  @MaxLength(500, { message: 'validation.reason.maxLength' })
  reason!: string;
}

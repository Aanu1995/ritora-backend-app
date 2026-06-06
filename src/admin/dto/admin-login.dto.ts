import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { EmptyStringToUndefined } from '../../common/dto/empty-string.transforms';

export class AdminLoginDto {
  @ApiProperty({ example: 'owner@ritora.app' })
  @IsEmail({}, { message: 'validation.email.invalid' })
  @MaxLength(255, { message: 'validation.email.maxLength' })
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1, { message: 'validation.password.required' })
  @MaxLength(72, { message: 'validation.password.maxLength' })
  password!: string;

  @ApiProperty({ required: false })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsString()
  @Matches(/^[0-9A-Za-z\s-]{6,32}$/, { message: 'validation.mfa.code' })
  mfaCode?: string;

  @ApiProperty({ enum: ['en', 'sv', 'es'], required: false })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn(['en', 'sv', 'es'], { message: 'validation.language.unsupported' })
  language?: string;
}

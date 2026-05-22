import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

const MFA_CODE_PATTERN = /^[0-9A-Za-z\s-]{6,32}$/;

export class AdminMfaPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1, { message: 'validation.password.required' })
  @MaxLength(72, { message: 'validation.password.maxLength' })
  currentPassword!: string;
}

export class AdminMfaEnableDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'validation.mfa.code' })
  code!: string;
}

export class AdminMfaChallengeDto extends AdminMfaPasswordDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(MFA_CODE_PATTERN, { message: 'validation.mfa.code' })
  code!: string;
}

import { IsString, MaxLength, MinLength } from 'class-validator';

export class AdminUserRestrictionDto {
  @IsString()
  @MinLength(8, { message: 'validation.reason.required' })
  @MaxLength(500, { message: 'validation.reason.maxLength' })
  reason!: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class DeleteAdminDto {
  @ApiProperty({ maxLength: 500, minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'validation.reason.required' })
  @MaxLength(500, { message: 'validation.reason.maxLength' })
  reason!: string;
}

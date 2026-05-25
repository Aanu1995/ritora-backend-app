import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, MaxLength } from 'class-validator';
import { EmptyStringToUndefined } from '../../common/dto/empty-string.transforms';

export class AdminForgotPasswordDto {
  @ApiProperty({ example: 'owner@ritora.app' })
  @IsEmail({}, { message: 'validation.email.invalid' })
  @MaxLength(255, { message: 'validation.email.maxLength' })
  email!: string;

  @ApiProperty({ enum: ['en', 'sv', 'es'], required: false })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn(['en', 'sv', 'es'], { message: 'validation.language.unsupported' })
  language?: string;
}

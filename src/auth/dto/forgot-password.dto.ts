import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional } from 'class-validator';
import { EmptyStringToUndefined } from '../../common/dto/empty-string.transforms';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail({}, { message: 'validation.email.invalid' })
  email!: string;

  @ApiProperty({ enum: ['en', 'sv'], required: false })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn(['en', 'sv'], { message: 'validation.language.unsupported' })
  language?: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';
import { EmptyStringToUndefined } from '../../common/dto/empty-string.transforms';

export class LoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail({}, { message: 'validation.email.invalid' })
  email!: string;

  @ApiProperty()
  @IsString()
  password!: string;

  @ApiProperty({ enum: ['en', 'sv'], required: false })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn(['en', 'sv'], { message: 'validation.language.unsupported' })
  language?: string;
}

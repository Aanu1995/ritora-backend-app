import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { EmptyStringToUndefined } from '../../common/dto/empty-string.transforms';

export class CreateAdminDto {
  @ApiProperty({ example: 'ops@ritora.app' })
  @IsEmail({}, { message: 'validation.email.invalid' })
  @MaxLength(255, { message: 'validation.email.maxLength' })
  email!: string;

  @ApiProperty({ example: 'Operations Lead' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'Launch support coverage', maxLength: 500 })
  @IsString()
  @MinLength(8, { message: 'validation.reason.required' })
  @MaxLength(500, { message: 'validation.reason.maxLength' })
  reason!: string;

  @ApiProperty({ enum: ['en', 'sv'], required: false })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn(['en', 'sv'], { message: 'validation.language.unsupported' })
  language?: string;
}

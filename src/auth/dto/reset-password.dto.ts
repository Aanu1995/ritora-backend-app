import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { EmptyStringToUndefined } from '../../common/dto/empty-string.transforms';

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/i, {
    message: 'validation.token.hex64',
  })
  token!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'validation.password.minLength' })
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'validation.password.strong',
  })
  newPassword!: string;

  @ApiProperty({ enum: ['en', 'sv', 'es'], required: false })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn(['en', 'sv', 'es'], { message: 'validation.language.unsupported' })
  language?: string;
}

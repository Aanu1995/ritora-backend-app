import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail({}, { message: 'validation.email.invalid' })
  email!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'validation.password.minLength' })
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: 'validation.password.strong',
  })
  password!: string;

  @ApiProperty({ example: 'Jane' })
  @IsString()
  @MinLength(1, { message: 'validation.name.required' })
  firstName!: string;

  @ApiProperty({ example: 'Doe' })
  @IsString()
  @MinLength(1, { message: 'validation.name.required' })
  lastName!: string;

  @ApiProperty({ enum: ['en', 'sv'], default: 'en' })
  @IsIn(['en', 'sv'], { message: 'validation.language.unsupported' })
  preferredLanguage!: string;

  @ApiProperty({ enum: ['en', 'sv'], required: false })
  @IsOptional()
  @IsIn(['en', 'sv'], { message: 'validation.language.unsupported' })
  language?: string;

  @ApiProperty({ description: 'Must be true to register' })
  @IsBoolean()
  termsAccepted!: boolean;

  @ApiProperty({ description: 'Must be true to register' })
  @IsBoolean()
  privacyPolicyAccepted!: boolean;
}

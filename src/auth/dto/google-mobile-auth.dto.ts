import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { EmptyStringToUndefined } from '../../common/dto/empty-string.transforms';

export class GoogleMobileAuthDto {
  @ApiProperty({ description: 'Google OpenID Connect ID token' })
  @IsString()
  @MinLength(1)
  idToken!: string;

  @ApiProperty({ enum: ['en', 'sv', 'es'] })
  @IsIn(['en', 'sv', 'es'], { message: 'validation.language.unsupported' })
  preferredLanguage!: string;

  @ApiProperty({ enum: ['en', 'sv', 'es'], required: false })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn(['en', 'sv', 'es'], { message: 'validation.language.unsupported' })
  language?: string;

  @ApiProperty({ description: 'Must be true to create a new account' })
  @IsBoolean()
  termsAccepted!: boolean;

  @ApiProperty({ description: 'Must be true to create a new account' })
  @IsBoolean()
  privacyPolicyAccepted!: boolean;
}

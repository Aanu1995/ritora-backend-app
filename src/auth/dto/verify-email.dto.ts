import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/i, {
    message: 'validation.token.hex64',
  })
  token!: string;

  @ApiProperty({ enum: ['en', 'sv'], required: false })
  @IsOptional()
  @IsIn(['en', 'sv'], { message: 'validation.language.unsupported' })
  language?: string;
}

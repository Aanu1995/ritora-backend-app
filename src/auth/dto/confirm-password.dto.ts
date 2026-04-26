import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ConfirmPasswordDto {
  @ApiProperty()
  @IsString()
  password!: string;
}

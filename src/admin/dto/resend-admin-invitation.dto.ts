import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { EmptyStringToUndefined } from '../../common/dto/empty-string.transforms';

export class ResendAdminInvitationDto {
  @ApiProperty({ example: 'Invitation link expired', maxLength: 500 })
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

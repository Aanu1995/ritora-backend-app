import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { EmptyStringToDefault } from '../../common/dto/empty-string.transforms';

export class AdminUserNoteListQueryDto {
  @EmptyStringToDefault(10)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 10;

  @EmptyStringToDefault(1)
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page = 1;
}

export class CreateAdminUserNoteDto {
  @IsString()
  @MinLength(3, { message: 'validation.note.required' })
  @MaxLength(2000, { message: 'validation.note.maxLength' })
  body!: string;
}

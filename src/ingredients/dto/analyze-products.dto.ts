import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { SUPPORTED_LANGUAGES, type AppLanguage } from '../../common/i18n/i18n';
import { EmptyStringToUndefined } from '../../common/dto/empty-string.transforms';

export class AnalyzeProductsDto {
  @IsOptional()
  @IsString()
  @MaxLength(26)
  focusProductId?: string;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(26, { each: true })
  productIds?: string[];

  @EmptyStringToUndefined()
  @IsOptional()
  @IsBoolean()
  withExplanations = false;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn(SUPPORTED_LANGUAGES)
  language?: AppLanguage;
}

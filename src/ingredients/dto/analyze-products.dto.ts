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

export class AnalyzeProductsDto {
  @IsOptional()
  @IsString()
  @MaxLength(26)
  focusProductId?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(26, { each: true })
  productIds?: string[];

  @IsOptional()
  @IsBoolean()
  withExplanations = false;

  @IsOptional()
  @IsIn(SUPPORTED_LANGUAGES)
  language?: AppLanguage;
}

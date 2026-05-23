import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { SUPPORTED_LANGUAGES, type AppLanguage } from '../../common/i18n/i18n';
import { EmptyStringToUndefined } from '../../common/dto/empty-string.transforms';
import {
  MAX_INCI_INGREDIENT_NAME_LENGTH,
  MAX_INCI_INGREDIENTS_PER_PRODUCT,
} from '../../common/constants/product-ingredient-limits';
import {
  LookupConfidence,
  LookupWarningCode,
  ProductCategory,
} from '../../shelf/shelf.types';
import { ProductCheckSource } from '../product-check.types';

export class CheckProductInputDto {
  @IsEnum(ProductCheckSource)
  source!: ProductCheckSource;

  @EmptyStringToUndefined()
  @ValidateIf(
    (dto: CheckProductInputDto) =>
      dto.source === ProductCheckSource.IngredientPaste ||
      (dto.brand !== undefined && dto.brand !== null),
  )
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(255)
  brand?: string | null;

  @EmptyStringToUndefined()
  @ValidateIf(
    (dto: CheckProductInputDto) =>
      dto.source === ProductCheckSource.IngredientPaste ||
      (dto.name !== undefined && dto.name !== null),
  )
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(255)
  name?: string | null;

  @IsEnum(ProductCategory)
  category!: ProductCategory;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_INCI_INGREDIENTS_PER_PRODUCT)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @Matches(/\S/, { each: true })
  @MaxLength(MAX_INCI_INGREDIENT_NAME_LENGTH, { each: true })
  inciIngredients!: string[];

  @EmptyStringToUndefined()
  @IsOptional()
  @IsEnum(LookupConfidence)
  lookupConfidence?: LookupConfidence;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsEnum(LookupWarningCode, { each: true })
  lookupWarnings?: LookupWarningCode[];

  @EmptyStringToUndefined()
  @IsOptional()
  @IsBoolean()
  reviewRequired?: boolean;
}

export class CheckProductDto {
  @ValidateNested()
  @Type(() => CheckProductInputDto)
  product!: CheckProductInputDto;

  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn(SUPPORTED_LANGUAGES)
  language?: AppLanguage;
}

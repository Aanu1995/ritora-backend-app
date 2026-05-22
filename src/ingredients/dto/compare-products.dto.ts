import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsDefined,
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
import { EmptyStringToUndefined } from '../../common/dto/empty-string.transforms';
import { SUPPORTED_LANGUAGES, type AppLanguage } from '../../common/i18n/i18n';
import {
  ProductCompareGoal,
  ProductCompareItemKind,
} from '../product-compare.types';
import { CheckProductInputDto } from './check-product.dto';

export { ProductCompareGoal, ProductCompareItemKind };

export class ProductCompareItemDto {
  @IsEnum(ProductCompareItemKind)
  kind!: ProductCompareItemKind;

  @ValidateIf(
    (dto: ProductCompareItemDto) =>
      dto.kind === ProductCompareItemKind.CheckedProduct,
  )
  @IsDefined()
  @ValidateNested()
  @Type(() => CheckProductInputDto)
  product?: CheckProductInputDto;

  @EmptyStringToUndefined()
  @ValidateIf(
    (dto: ProductCompareItemDto) =>
      dto.kind === ProductCompareItemKind.ShelfProduct,
  )
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/)
  @MaxLength(64)
  productId?: string;
}

export class ProductCompareProductsDto {
  @IsOptional()
  @IsEnum(ProductCompareGoal)
  goal?: ProductCompareGoal;

  @ValidateNested()
  @Type(() => ProductCompareItemDto)
  anchor!: ProductCompareItemDto;

  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ProductCompareItemDto)
  candidates!: ProductCompareItemDto[];

  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn(SUPPORTED_LANGUAGES)
  language?: AppLanguage;
}

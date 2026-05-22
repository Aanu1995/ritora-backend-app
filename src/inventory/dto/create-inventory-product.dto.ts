import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  ApplicationMethod,
  DataProvenance,
  PreferredTimeOfDay,
  ProductCategory,
  Quantity,
  ShelfStatus,
} from '../../shelf/shelf.types';
import { EmptyStringToNull } from '../../common/dto/empty-string.transforms';

export class CreateCatalogueIdentityDto {
  @IsString()
  brand!: string;

  @IsString()
  name!: string;

  @IsEnum(ProductCategory)
  category!: ProductCategory;

  @IsOptional()
  @IsString()
  barcode?: string | null;

  @IsArray()
  @ArrayMaxSize(10)
  @IsUrl(
    {
      protocols: ['http', 'https'],
      require_protocol: true,
      require_tld: false,
    },
    { each: true },
  )
  @IsString({ each: true })
  imageUrls!: string[];

  @IsNumber()
  @Min(0)
  sizeMl!: number;

  @IsString()
  description!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  benefits!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  suitedFor!: string[];

  @IsArray()
  @IsString({ each: true })
  inciIngredients!: string[];

  @EmptyStringToNull()
  @IsOptional()
  @IsISO8601()
  inciLastConfirmedAt?: string | null;
}

export class CreateApplicationGuidanceDto {
  @EmptyStringToNull()
  @IsOptional()
  @IsEnum(ApplicationMethod)
  applicationMethod?: ApplicationMethod | null;

  @EmptyStringToNull()
  @IsOptional()
  @IsEnum(Quantity)
  quantity?: Quantity | null;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  steps!: string[];

  @IsArray()
  @IsString({ each: true })
  cautions!: string[];

  @EmptyStringToNull()
  @IsOptional()
  @IsNumber()
  @Min(0)
  waitMinutes?: number | null;
}

export class CreateManufacturerInfoDto {
  @IsOptional()
  @IsString()
  brand?: string | null;

  @IsOptional()
  @IsString()
  parentCompany?: string | null;

  @IsOptional()
  @IsString()
  countryOfOrigin?: string | null;

  @IsOptional()
  @IsString()
  countryOfManufacture?: string | null;

  @EmptyStringToNull()
  @IsOptional()
  @IsEmail()
  supportEmail?: string | null;

  @EmptyStringToNull()
  @IsOptional()
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
  })
  productUrl?: string | null;

  @EmptyStringToNull()
  @IsOptional()
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
  })
  websiteUrl?: string | null;
}

export class CreateUserFieldsDto {
  @EmptyStringToNull()
  @IsOptional()
  @IsISO8601()
  openedAt?: string | null;

  @EmptyStringToNull()
  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;

  @EmptyStringToNull()
  @IsOptional()
  @IsNumber()
  @Min(0)
  periodAfterOpeningMonths?: number | null;

  @EmptyStringToNull()
  @IsOptional()
  @IsNumber()
  @Min(0)
  pricePaid?: number | null;

  @IsOptional()
  @IsString()
  pricePaidCurrency?: string | null;

  @IsOptional()
  @IsString()
  purchasedFrom?: string | null;

  @IsOptional()
  @IsString()
  personalNotes?: string | null;

  @EmptyStringToNull()
  @IsOptional()
  @IsEnum(PreferredTimeOfDay)
  preferredTimeOfDay?: PreferredTimeOfDay | null;
}

export class CreateInventoryProductDto {
  @ValidateNested()
  @Type(() => CreateCatalogueIdentityDto)
  identity!: CreateCatalogueIdentityDto;

  @ValidateNested()
  @Type(() => CreateApplicationGuidanceDto)
  guidance!: CreateApplicationGuidanceDto;

  @ValidateNested()
  @Type(() => CreateManufacturerInfoDto)
  manufacturer!: CreateManufacturerInfoDto;

  @ValidateNested()
  @Type(() => CreateUserFieldsDto)
  userFields!: CreateUserFieldsDto;

  @EmptyStringToNull()
  @IsOptional()
  @IsEnum(ShelfStatus)
  status?: ShelfStatus | null;

  @EmptyStringToNull()
  @IsOptional()
  @IsEnum(DataProvenance)
  provenance?: DataProvenance | null;
}

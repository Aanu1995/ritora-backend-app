import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsOptional, ValidateNested } from 'class-validator';
import { EmptyStringToNull } from '../../common/dto/empty-string.transforms';
import { DataProvenance, ShelfStatus } from '../../shelf/shelf.types';
import {
  CreateApplicationGuidanceDto,
  CreateCatalogueIdentityDto,
  CreateManufacturerInfoDto,
  CreateUserFieldsDto,
} from './create-inventory-product.dto';

export class UpdateCatalogueIdentityDto extends PartialType(
  CreateCatalogueIdentityDto,
) {}

export class UpdateApplicationGuidanceDto extends PartialType(
  CreateApplicationGuidanceDto,
) {}

export class UpdateManufacturerInfoDto extends PartialType(
  CreateManufacturerInfoDto,
) {}

export class UpdateUserFieldsDto extends PartialType(CreateUserFieldsDto) {}

export class UpdateInventoryProductDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateCatalogueIdentityDto)
  identity?: UpdateCatalogueIdentityDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateApplicationGuidanceDto)
  guidance?: UpdateApplicationGuidanceDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateManufacturerInfoDto)
  manufacturer?: UpdateManufacturerInfoDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateUserFieldsDto)
  userFields?: UpdateUserFieldsDto;

  @EmptyStringToNull()
  @IsOptional()
  @IsEnum(ShelfStatus)
  status?: ShelfStatus | null;

  @EmptyStringToNull()
  @IsOptional()
  @IsEnum(DataProvenance)
  provenance?: DataProvenance | null;
}

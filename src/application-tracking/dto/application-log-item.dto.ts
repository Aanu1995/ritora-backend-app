import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { EmptyStringToNull } from '../../common/dto/empty-string.transforms';
import { toIsoString } from '../../common/utils/date';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import {
  ProductImageUrlResolverOptions,
  resolveInventoryProductImageUrl,
} from '../../inventory/product-image-url-resolver';
import { ApplicationLogItem } from '../entities/application-log-item.entity';
import {
  ApplicationItemProductSnapshot,
  ApplicationItemSource,
  ApplicationItemStatus,
  APPLICATION_ITEM_STATUSES,
} from '../application-tracking.constants';

export class ApplicationProductSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  brand: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  category: string;

  @ApiProperty({ nullable: true })
  imageUrl: string | null;

  @ApiProperty()
  status: string;

  static fromEntity(
    product: InventoryProduct,
    options: ProductImageUrlResolverOptions = {},
  ): ApplicationProductSummaryDto {
    const dto = new ApplicationProductSummaryDto();
    dto.id = product.id;
    dto.brand = product.brand;
    dto.name = product.name;
    dto.category = product.category;
    dto.imageUrl = resolveInventoryProductImageUrl(product, options);
    dto.status = product.status;
    return dto;
  }
}

export class ApplicationLogItemInputDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  stepOrder!: number;

  @ApiPropertyOptional({ nullable: true })
  @EmptyStringToNull()
  @IsOptional()
  @IsString()
  suggestionStepId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @EmptyStringToNull()
  @IsOptional()
  @IsString()
  inventoryProductId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @EmptyStringToNull()
  @IsOptional()
  @IsString()
  substitutedWithProductId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  productBrand?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  productName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  stepLabel?: string | null;

  @ApiProperty({ enum: APPLICATION_ITEM_STATUSES })
  @IsIn([...APPLICATION_ITEM_STATUSES])
  status!: ApplicationItemStatus;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isAdHoc?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  adHocBrand?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  adHocName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  substitutionReason?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @EmptyStringToNull()
  @IsOptional()
  @IsDateString()
  appliedAt?: string | null;
}

export class ApplicationLogItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  stepOrder: number;

  @ApiProperty({ nullable: true })
  suggestionStepId: string | null;

  @ApiProperty({ nullable: true })
  inventoryProductId: string | null;

  @ApiProperty({ nullable: true })
  substitutedWithProductId: string | null;

  @ApiProperty({ nullable: true })
  productBrand: string | null;

  @ApiProperty({ nullable: true })
  productName: string | null;

  @ApiProperty({ nullable: true })
  stepLabel: string | null;

  @ApiProperty({ enum: APPLICATION_ITEM_STATUSES })
  status: ApplicationItemStatus;

  @ApiProperty()
  isAdHoc: boolean;

  @ApiProperty({ enum: ['recommended', 'added_shelf', 'added_off_shelf'] })
  itemSource: ApplicationItemSource;

  @ApiProperty({ nullable: true })
  adHocBrand: string | null;

  @ApiProperty({ nullable: true })
  adHocName: string | null;

  @ApiProperty({ nullable: true })
  notes: string | null;

  @ApiProperty({ nullable: true })
  substitutionReason: string | null;

  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  recommendedSnapshot: ApplicationItemProductSnapshot | null;

  @ApiProperty({ nullable: true, type: 'object', additionalProperties: true })
  appliedSnapshot: ApplicationItemProductSnapshot | null;

  @ApiProperty({ nullable: true })
  appliedAt: string | null;

  @ApiProperty({ nullable: true, type: ApplicationProductSummaryDto })
  product: ApplicationProductSummaryDto | null;

  @ApiProperty({ nullable: true, type: ApplicationProductSummaryDto })
  substitutedWithProduct: ApplicationProductSummaryDto | null;

  static fromEntity(
    item: ApplicationLogItem,
    options: ProductImageUrlResolverOptions = {},
  ): ApplicationLogItemResponseDto {
    const dto = new ApplicationLogItemResponseDto();
    dto.id = item.id;
    dto.stepOrder = item.step_order;
    dto.suggestionStepId = item.suggestion_step_id;
    dto.inventoryProductId = item.inventory_product_id;
    dto.substitutedWithProductId = item.substituted_with_product_id;
    dto.productBrand = item.product_brand_snapshot;
    dto.productName = item.product_name_snapshot;
    dto.stepLabel = item.step_label;
    dto.status = item.status;
    dto.isAdHoc = item.is_ad_hoc;
    dto.itemSource = item.item_source;
    dto.adHocBrand = item.ad_hoc_brand;
    dto.adHocName = item.ad_hoc_name;
    dto.notes = item.notes;
    dto.substitutionReason = item.substitution_reason;
    dto.recommendedSnapshot = item.recommended_snapshot;
    dto.appliedSnapshot = item.applied_snapshot;
    dto.appliedAt = item.applied_at ? toIsoString(item.applied_at) : null;
    dto.product = item.product
      ? ApplicationProductSummaryDto.fromEntity(item.product, options)
      : null;
    dto.substitutedWithProduct = item.substituted_with_product
      ? ApplicationProductSummaryDto.fromEntity(
          item.substituted_with_product,
          options,
        )
      : null;
    return dto;
  }
}

export class RecordApplicationDto {
  @ApiPropertyOptional({ nullable: true })
  @EmptyStringToNull()
  @IsOptional()
  @IsString()
  suggestionInstanceId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @EmptyStringToNull()
  @IsOptional()
  @IsString()
  slotId?: string | null;

  @ApiProperty({ format: 'date' })
  @IsDateString()
  targetDate!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  targetTime?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @EmptyStringToNull()
  @IsOptional()
  @IsDateString()
  appliedAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  generalNotes?: string | null;

  @ApiProperty({ type: [ApplicationLogItemInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApplicationLogItemInputDto)
  items!: ApplicationLogItemInputDto[];
}

export class EditApplicationDto {
  @ApiPropertyOptional({ nullable: true })
  @EmptyStringToNull()
  @IsOptional()
  @IsDateString()
  appliedAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  generalNotes?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  editReason?: string | null;

  @ApiProperty({ type: [ApplicationLogItemInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApplicationLogItemInputDto)
  items!: ApplicationLogItemInputDto[];
}

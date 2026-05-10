import { ApiProperty } from '@nestjs/swagger';
import { toIsoString } from '../../common/utils/date';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import {
  ProductImageUrlResolverOptions,
  resolveInventoryProductImageUrl,
} from '../../inventory/product-image-url-resolver';
import { RoutineStep } from '../entities/routine-step.entity';

export class RoutineStepProductSummaryDto {
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

  constructor(
    id: string,
    brand: string,
    name: string,
    category: string,
    imageUrl: string | null,
    status: string,
  ) {
    this.id = id;
    this.brand = brand;
    this.name = name;
    this.category = category;
    this.imageUrl = imageUrl;
    this.status = status;
  }

  static fromEntity(
    product: InventoryProduct,
    options: ProductImageUrlResolverOptions = {},
  ): RoutineStepProductSummaryDto {
    const imageUrl = resolveInventoryProductImageUrl(product, options);
    return new RoutineStepProductSummaryDto(
      product.id,
      product.brand,
      product.name,
      product.category,
      imageUrl,
      product.status,
    );
  }
}

export class RoutineStepResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  stepOrder: number;

  @ApiProperty({ nullable: true })
  inventoryProductId: string | null;

  @ApiProperty()
  stepLabel: string;

  @ApiProperty({ nullable: true })
  customLabel: string | null;

  @ApiProperty({ nullable: true })
  notes: string | null;

  @ApiProperty()
  optional: boolean;

  @ApiProperty({
    description:
      'When true, AI suggestion engine treats the step as immutable: never modified, reordered, or removed.',
  })
  isSpecialistLocked: boolean;

  @ApiProperty({ nullable: true, type: RoutineStepProductSummaryDto })
  product: RoutineStepProductSummaryDto | null;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  constructor(
    id: string,
    stepOrder: number,
    inventoryProductId: string | null,
    stepLabel: string,
    customLabel: string | null,
    notes: string | null,
    optional: boolean,
    isSpecialistLocked: boolean,
    product: RoutineStepProductSummaryDto | null,
    createdAt: string,
    updatedAt: string,
  ) {
    this.id = id;
    this.stepOrder = stepOrder;
    this.inventoryProductId = inventoryProductId;
    this.stepLabel = stepLabel;
    this.customLabel = customLabel;
    this.notes = notes;
    this.optional = optional;
    this.isSpecialistLocked = isSpecialistLocked;
    this.product = product;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  static fromEntity(
    step: RoutineStep,
    options: ProductImageUrlResolverOptions = {},
  ): RoutineStepResponseDto {
    const product = step.product
      ? RoutineStepProductSummaryDto.fromEntity(step.product, options)
      : null;
    return new RoutineStepResponseDto(
      step.id,
      step.step_order,
      step.inventory_product_id,
      step.step_label,
      step.custom_label,
      step.notes,
      step.optional,
      step.is_specialist_locked,
      product,
      toIsoString(step.created_at),
      toIsoString(step.updated_at),
    );
  }
}

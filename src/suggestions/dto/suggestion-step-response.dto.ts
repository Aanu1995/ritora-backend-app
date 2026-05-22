import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
import {
  ProductImageUrlResolverOptions,
  resolveInventoryProductImageUrl,
} from '../../inventory/product-image-url-resolver';
import {
  SuggestionSafetyFlagJson,
  SuggestionStepChipJson,
  SuggestionStepProvenance,
} from '../suggestions.constants';
import { SuggestionStep } from '../entities/suggestion-step.entity';

export class SuggestionStepProductSummaryDto {
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
  ): SuggestionStepProductSummaryDto {
    const dto = new SuggestionStepProductSummaryDto();
    dto.id = product.id;
    dto.brand = product.brand;
    dto.name = product.name;
    dto.category = product.category;
    dto.imageUrl = resolveInventoryProductImageUrl(product, options);
    dto.status = product.status;
    return dto;
  }
}

export class SuggestionStepResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  stepOrder: number;

  @ApiProperty({ nullable: true })
  routineStepId: string | null;

  @ApiProperty({ nullable: true })
  inventoryProductId: string | null;

  @ApiProperty({ nullable: true })
  productBrand: string | null;

  @ApiProperty({ nullable: true })
  productName: string | null;

  @ApiProperty()
  stepLabel: string;

  @ApiProperty({ nullable: true })
  customLabel: string | null;

  @ApiProperty({ nullable: true })
  applicationMethod: string | null;

  @ApiProperty({ nullable: true })
  quantity: string | null;

  @ApiProperty({ nullable: true })
  waitAfterMinutes: number | null;

  @ApiProperty({ nullable: true })
  explanation: string | null;

  @ApiProperty({ nullable: true })
  routineNote: string | null;

  @ApiProperty({
    enum: ['specialist_locked', 'user_routine', 'ai_added'],
  })
  provenance: SuggestionStepProvenance;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  chips: SuggestionStepChipJson[];

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  safetyWarnings: SuggestionSafetyFlagJson[];

  @ApiPropertyOptional({
    nullable: true,
    type: SuggestionStepProductSummaryDto,
  })
  product: SuggestionStepProductSummaryDto | null;

  static fromEntity(
    step: SuggestionStep,
    options: ProductImageUrlResolverOptions = {},
  ): SuggestionStepResponseDto {
    const dto = new SuggestionStepResponseDto();
    dto.id = step.id;
    dto.stepOrder = step.step_order;
    dto.routineStepId = step.routine_step_id;
    dto.inventoryProductId = step.inventory_product_id;
    dto.productBrand =
      step.product_brand_snapshot ?? step.product?.brand ?? null;
    dto.productName = step.product_name_snapshot ?? step.product?.name ?? null;
    dto.stepLabel = step.step_label;
    dto.customLabel = step.custom_label;
    dto.applicationMethod = step.application_method;
    dto.quantity = step.quantity;
    dto.waitAfterMinutes = step.wait_after_minutes;
    dto.explanation = step.explanation;
    dto.routineNote = step.routine_note_snapshot;
    dto.provenance = step.provenance;
    dto.chips = step.chips ?? [];
    dto.safetyWarnings = step.safety_warnings ?? [];
    dto.product = step.product
      ? SuggestionStepProductSummaryDto.fromEntity(step.product, options)
      : null;
    return dto;
  }
}

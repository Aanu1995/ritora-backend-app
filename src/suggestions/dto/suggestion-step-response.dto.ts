import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InventoryProduct } from '../../inventory/entities/inventory-product.entity';
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
  ): SuggestionStepProductSummaryDto {
    const dto = new SuggestionStepProductSummaryDto();
    dto.id = product.id;
    dto.brand = product.brand;
    dto.name = product.name;
    dto.category = product.category;
    dto.imageUrl = product.identity?.imageUrls?.[0] ?? null;
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

  static fromEntity(step: SuggestionStep): SuggestionStepResponseDto {
    const dto = new SuggestionStepResponseDto();
    dto.id = step.id;
    dto.stepOrder = step.step_order;
    dto.routineStepId = step.routine_step_id;
    dto.inventoryProductId = step.inventory_product_id;
    dto.productBrand =
      step.product?.brand ?? step.product_brand_snapshot ?? null;
    dto.productName = step.product?.name ?? step.product_name_snapshot ?? null;
    dto.stepLabel = step.step_label;
    dto.customLabel = step.custom_label;
    dto.applicationMethod = step.application_method;
    dto.quantity = step.quantity;
    dto.waitAfterMinutes = step.wait_after_minutes;
    dto.explanation = step.explanation;
    dto.provenance = step.provenance;
    dto.chips = step.chips ?? [];
    dto.safetyWarnings = step.safety_warnings ?? [];
    dto.product = step.product
      ? SuggestionStepProductSummaryDto.fromEntity(step.product)
      : null;
    return dto;
  }
}

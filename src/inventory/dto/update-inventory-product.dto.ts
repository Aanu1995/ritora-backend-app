import { PartialType } from '@nestjs/swagger';
import { CreateInventoryProductDto } from './create-inventory-product.dto';

export class UpdateInventoryProductDto extends PartialType(
  CreateInventoryProductDto,
) {}

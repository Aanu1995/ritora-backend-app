import { InventoryProduct } from '../entities/inventory-product.entity';
import { toIsoString } from '../../common/utils/date';

export class InventoryProductResponseDto {
  id: string;
  identity: InventoryProduct['identity'];
  guidance: InventoryProduct['guidance'];
  manufacturer: InventoryProduct['manufacturer'];
  userFields: InventoryProduct['user_fields'];
  status: InventoryProduct['status'];
  provenance: InventoryProduct['provenance'];
  createdAt: string;
  updatedAt: string;

  constructor(
    id: string,
    identity: InventoryProduct['identity'],
    guidance: InventoryProduct['guidance'],
    manufacturer: InventoryProduct['manufacturer'],
    userFields: InventoryProduct['user_fields'],
    status: InventoryProduct['status'],
    provenance: InventoryProduct['provenance'],
    createdAt: string,
    updatedAt: string,
  ) {
    this.id = id;
    this.identity = identity;
    this.guidance = guidance;
    this.manufacturer = manufacturer;
    this.userFields = userFields;
    this.status = status;
    this.provenance = provenance;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  static fromEntity(entity: InventoryProduct): InventoryProductResponseDto {
    return new InventoryProductResponseDto(
      entity.id,
      entity.identity,
      entity.guidance,
      entity.manufacturer,
      entity.user_fields,
      entity.status,
      entity.provenance,
      toIsoString(entity.created_at),
      toIsoString(entity.updated_at),
    );
  }
}

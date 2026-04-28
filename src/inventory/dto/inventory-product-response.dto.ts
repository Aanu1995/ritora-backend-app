import { InventoryProduct } from '../entities/inventory-product.entity';
import { toIsoString } from '../../common/utils/date';
import {
  normalizeApplicationGuidanceSnapshot,
  normalizeCatalogueIdentitySnapshot,
  normalizeManufacturerInfoSnapshot,
  normalizeUserFieldsSnapshot,
} from '../../shelf/shelf-payload-normalizer';
import { DataProvenance } from '../../shelf/shelf.types';

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
    const identity = normalizeCatalogueIdentitySnapshot(entity.identity);
    const guidance = normalizeApplicationGuidanceSnapshot(entity.guidance);
    const manufacturer = normalizeManufacturerInfoSnapshot(
      entity.manufacturer,
      identity.brand,
    );
    const userFields = normalizeUserFieldsSnapshot(entity.user_fields);

    return new InventoryProductResponseDto(
      entity.id,
      identity,
      guidance,
      manufacturer,
      userFields,
      entity.status,
      DataProvenance.PhotoLookup,
      toIsoString(entity.created_at),
      toIsoString(entity.updated_at),
    );
  }
}

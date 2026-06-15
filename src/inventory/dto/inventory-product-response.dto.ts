import { InventoryProduct } from '../entities/inventory-product.entity';
import { toIsoString } from '../../common/utils/date';
import {
  normalizeApplicationGuidanceSnapshot,
  normalizeCatalogueIdentitySnapshot,
  normalizeManufacturerInfoSnapshot,
  normalizeUserFieldsSnapshot,
} from '../../shelf/shelf-payload-normalizer';
import {
  DataProvenance,
  ProductIntroductionStatus,
} from '../../shelf/shelf.types';

export class ProductIntroductionResponseDto {
  status: ProductIntroductionStatus;
  startedAt: string;
  statusUpdatedAt: string;

  constructor(
    status: ProductIntroductionStatus,
    startedAt: string,
    statusUpdatedAt: string,
  ) {
    this.status = status;
    this.startedAt = startedAt;
    this.statusUpdatedAt = statusUpdatedAt;
  }
}

export class InventoryProductResponseDto {
  id: string;
  identity: InventoryProduct['identity'];
  guidance: InventoryProduct['guidance'];
  manufacturer: InventoryProduct['manufacturer'];
  userFields: InventoryProduct['user_fields'];
  introduction: ProductIntroductionResponseDto | null;
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
    introduction: ProductIntroductionResponseDto | null,
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
    this.introduction = introduction;
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
      toProductIntroductionResponse(entity),
      entity.status,
      DataProvenance.PhotoLookup,
      toIsoString(entity.created_at),
      toIsoString(entity.updated_at),
    );
  }
}

function toProductIntroductionResponse(
  entity: InventoryProduct,
): ProductIntroductionResponseDto | null {
  const status =
    entity.introduction_status ?? ProductIntroductionStatus.Tolerated;
  const startedAt =
    entity.introduction_started_at ?? entity.updated_at ?? entity.created_at;
  const statusUpdatedAt =
    entity.introduction_status_updated_at ??
    entity.updated_at ??
    entity.created_at;

  return new ProductIntroductionResponseDto(
    status,
    toIsoString(startedAt),
    toIsoString(statusUpdatedAt),
  );
}

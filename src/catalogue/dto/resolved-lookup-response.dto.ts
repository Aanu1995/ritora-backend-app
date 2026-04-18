import { ApiProperty } from '@nestjs/swagger';
import type {
  CatalogueIdentity,
  DataProvenance,
  ManufacturerInfo,
  ResolvedLookup,
} from '../../shelf/shelf.types';
import { CatalogueProduct } from '../entities/catalogue-product.entity';

export class ResolvedLookupResponseDto implements ResolvedLookup {
  @ApiProperty({ type: Object })
  identity: Partial<CatalogueIdentity>;

  @ApiProperty({ type: Object })
  manufacturer: Partial<ManufacturerInfo>;

  @ApiProperty()
  provenance: DataProvenance;

  constructor(
    identity: Partial<CatalogueIdentity>,
    manufacturer: Partial<ManufacturerInfo>,
    provenance: DataProvenance,
  ) {
    this.identity = identity;
    this.manufacturer = manufacturer;
    this.provenance = provenance;
  }

  static fromEntity(
    product: CatalogueProduct,
    provenance: DataProvenance,
  ): ResolvedLookupResponseDto {
    return new ResolvedLookupResponseDto(
      product.identity,
      product.manufacturer,
      provenance,
    );
  }
}

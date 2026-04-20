import { ApiProperty } from '@nestjs/swagger';
import type {
  ApplicationGuidance,
  CatalogueSource,
  CatalogueIdentity,
  DataProvenance,
  LookupConfidence,
  LookupEvidence,
  LookupWarningCode,
  ManufacturerInfo,
  ResolvedLookup,
} from '../../shelf/shelf.types';
import { normalizeResolvedLookupPayload } from '../../shelf/shelf-payload-normalizer';
import { CatalogueProduct } from '../entities/catalogue-product.entity';
import type { ResolvedProductDraft } from '../product-discovery.types';

export class ResolvedLookupResponseDto implements ResolvedLookup {
  @ApiProperty({ type: Object })
  identity: Partial<CatalogueIdentity>;

  @ApiProperty({ type: Object })
  guidance: Partial<ApplicationGuidance>;

  @ApiProperty({ type: Object })
  manufacturer: Partial<ManufacturerInfo>;

  @ApiProperty()
  provenance: DataProvenance;

  @ApiProperty()
  source: CatalogueSource;

  @ApiProperty()
  confidence: LookupConfidence;

  @ApiProperty()
  reviewRequired: boolean;

  @ApiProperty({ type: [String] })
  warnings: LookupWarningCode[];

  @ApiProperty({ type: [Object] })
  evidence: LookupEvidence[];

  constructor(
    identity: Partial<CatalogueIdentity>,
    guidance: Partial<ApplicationGuidance>,
    manufacturer: Partial<ManufacturerInfo>,
    provenance: DataProvenance,
    source: CatalogueSource,
    confidence: LookupConfidence,
    reviewRequired: boolean,
    warnings: LookupWarningCode[],
    evidence: LookupEvidence[],
  ) {
    this.identity = identity;
    this.guidance = guidance;
    this.manufacturer = manufacturer;
    this.provenance = provenance;
    this.source = source;
    this.confidence = confidence;
    this.reviewRequired = reviewRequired;
    this.warnings = warnings;
    this.evidence = evidence;
  }

  static fromEntity(
    product: CatalogueProduct,
    provenance: DataProvenance,
  ): ResolvedLookupResponseDto {
    const normalized = normalizeResolvedLookupPayload({
      identity: product.identity,
      guidance: product.guidance,
      manufacturer: product.manufacturer,
      provenance,
      source: product.source_type,
      confidence: product.confidence,
      reviewRequired: product.review_required,
      warnings: product.warnings,
      evidence: [],
    });

    return new ResolvedLookupResponseDto(
      normalized.identity,
      normalized.guidance,
      normalized.manufacturer,
      normalized.provenance,
      normalized.source,
      normalized.confidence,
      normalized.reviewRequired,
      normalized.warnings,
      normalized.evidence,
    );
  }

  static fromResolved(
    resolved: ResolvedProductDraft,
  ): ResolvedLookupResponseDto {
    const normalized = normalizeResolvedLookupPayload(resolved);

    return new ResolvedLookupResponseDto(
      normalized.identity,
      normalized.guidance,
      normalized.manufacturer,
      normalized.provenance,
      normalized.source,
      normalized.confidence,
      normalized.reviewRequired,
      normalized.warnings,
      normalized.evidence,
    );
  }
}

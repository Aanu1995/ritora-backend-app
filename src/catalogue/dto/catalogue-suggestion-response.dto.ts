import { ApiProperty } from '@nestjs/swagger';
import { CatalogueProduct } from '../entities/catalogue-product.entity';
import {
  CatalogueSource,
  LookupConfidence,
  ProductCategory,
  type CatalogueSuggestion,
} from '../../shelf/shelf.types';
import { normalizeCatalogueSuggestionPayload } from '../../shelf/shelf-payload-normalizer';
import type { DiscoveredSuggestion } from '../product-discovery.types';

export class CatalogueSuggestionResponseDto implements CatalogueSuggestion {
  @ApiProperty()
  id: string;

  @ApiProperty()
  brand: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  category: ProductCategory;

  @ApiProperty({ type: [String] })
  imageUrls: string[];

  @ApiProperty({ nullable: true })
  sizeMl: number | null;

  @ApiProperty({ nullable: true })
  barcode: string | null;

  @ApiProperty({ enum: CatalogueSource })
  source: CatalogueSource;

  @ApiProperty({ enum: LookupConfidence })
  confidence: LookupConfidence;

  @ApiProperty()
  reviewRequired: boolean;

  constructor(
    id: string,
    brand: string,
    name: string,
    category: ProductCategory,
    imageUrls: string[],
    sizeMl: number | null,
    barcode: string | null,
    source: CatalogueSource,
    confidence: LookupConfidence,
    reviewRequired: boolean,
  ) {
    this.id = id;
    this.brand = brand;
    this.name = name;
    this.category = category;
    this.imageUrls = imageUrls;
    this.sizeMl = sizeMl;
    this.barcode = barcode;
    this.source = source;
    this.confidence = confidence;
    this.reviewRequired = reviewRequired;
  }

  static fromEntity(product: CatalogueProduct): CatalogueSuggestionResponseDto {
    const normalized = normalizeCatalogueSuggestionPayload({
      id: product.id,
      brand: product.brand,
      name: product.name,
      category: product.category,
      imageUrls: product.identity.imageUrls,
      sizeMl: product.identity.sizeMl,
      barcode: product.barcode,
      source: product.source_type,
      confidence: product.confidence,
      reviewRequired: product.review_required,
    });

    return new CatalogueSuggestionResponseDto(
      normalized.id,
      normalized.brand,
      normalized.name,
      normalized.category,
      normalized.imageUrls,
      normalized.sizeMl,
      normalized.barcode,
      normalized.source,
      normalized.confidence,
      normalized.reviewRequired,
    );
  }

  static fromSuggestion(
    suggestion: DiscoveredSuggestion,
  ): CatalogueSuggestionResponseDto {
    const normalized = normalizeCatalogueSuggestionPayload(suggestion);

    return new CatalogueSuggestionResponseDto(
      normalized.id,
      normalized.brand,
      normalized.name,
      normalized.category,
      normalized.imageUrls,
      normalized.sizeMl,
      normalized.barcode,
      normalized.source,
      normalized.confidence,
      normalized.reviewRequired,
    );
  }
}

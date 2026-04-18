import { ApiProperty } from '@nestjs/swagger';
import { CatalogueProduct } from '../entities/catalogue-product.entity';
import {
  ProductCategory,
  type CatalogueSuggestion,
} from '../../shelf/shelf.types';

export class CatalogueSuggestionResponseDto implements CatalogueSuggestion {
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

  constructor(
    brand: string,
    name: string,
    category: ProductCategory,
    imageUrls: string[],
    sizeMl: number | null,
    barcode: string | null,
  ) {
    this.brand = brand;
    this.name = name;
    this.category = category;
    this.imageUrls = imageUrls;
    this.sizeMl = sizeMl;
    this.barcode = barcode;
  }

  static fromEntity(product: CatalogueProduct): CatalogueSuggestionResponseDto {
    return new CatalogueSuggestionResponseDto(
      product.brand,
      product.name,
      product.category,
      product.identity.imageUrls,
      product.identity.sizeMl,
      product.barcode,
    );
  }
}

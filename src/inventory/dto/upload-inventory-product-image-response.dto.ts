import { ApiProperty } from '@nestjs/swagger';

export class UploadInventoryProductImageResponseDto {
  @ApiProperty()
  imageUrl: string;

  constructor(imageUrl: string) {
    this.imageUrl = imageUrl;
  }

  static fromImageUrl(
    imageUrl: string,
  ): UploadInventoryProductImageResponseDto {
    return new UploadInventoryProductImageResponseDto(imageUrl);
  }
}

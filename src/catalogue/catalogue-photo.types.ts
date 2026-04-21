export type UploadedCatalogueImage = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size?: number;
};

export type CataloguePhotoAsset = Pick<
  UploadedCatalogueImage,
  'buffer' | 'mimetype'
>;

export type CataloguePhotoExtractionInput = {
  images: CataloguePhotoAsset[];
  heroImageIndex: number;
};

export type ProcessedCatalogueImage = UploadedCatalogueImage & {
  width: number;
  height: number;
};

export type ProcessedCataloguePhotoBatch = {
  extractionInput: CataloguePhotoExtractionInput;
  heroStorageImage: ProcessedCatalogueImage;
};

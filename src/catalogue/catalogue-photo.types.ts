export type UploadedCatalogueImage = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size?: number;
};

export type CataloguePhotoAssetVariant = 'overview' | 'text-enhanced';

export type CataloguePhotoAsset = Pick<
  UploadedCatalogueImage,
  'buffer' | 'mimetype'
> & {
  sourceIndex?: number;
  isHero?: boolean;
  variant?: CataloguePhotoAssetVariant;
  width?: number;
  height?: number;
};

export type CataloguePhotoExtractionInput = {
  images: CataloguePhotoAsset[];
  heroImageIndex: number;
  sourceImageCount?: number;
};

export type ProcessedCatalogueImage = UploadedCatalogueImage & {
  width: number;
  height: number;
};

export type ProcessedCataloguePhotoBatch = {
  extractionInput: CataloguePhotoExtractionInput;
  heroStorageImage: ProcessedCatalogueImage;
};

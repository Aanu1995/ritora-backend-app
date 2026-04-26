import { resolve } from 'path';

export const CATALOGUE_MEDIA_ROUTE = '/media';
export const CATALOGUE_PRODUCT_IMAGE_DIRECTORY = 'catalogue-front-photos';
export const CATALOGUE_PRODUCT_IMAGE_PREFIX = 'product-images';
export const CATALOGUE_PRODUCT_IMAGE_PROCESSED_PREFIX = `${CATALOGUE_PRODUCT_IMAGE_PREFIX}/processed`;
export const CATALOGUE_PRODUCT_IMAGE_TMP_PREFIX = `${CATALOGUE_PRODUCT_IMAGE_PREFIX}/tmp`;
export const CATALOGUE_PRODUCT_IMAGE_MAX_DIMENSION = 1600;
export const CATALOGUE_PRODUCT_IMAGE_WEBP_QUALITY = 82;
export const CATALOGUE_PRODUCT_EXTRACTION_IMAGE_MAX_DIMENSION = 2400;
export const CATALOGUE_PRODUCT_EXTRACTION_IMAGE_WEBP_QUALITY = 90;

export function resolveCatalogueMediaRootDir(): string {
  return resolve(process.cwd(), 'storage/media');
}

export function resolveCatalogueProductImageDir(): string {
  return resolve(
    resolveCatalogueMediaRootDir(),
    CATALOGUE_PRODUCT_IMAGE_DIRECTORY,
  );
}

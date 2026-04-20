import { resolve } from 'path';

export const CATALOGUE_MEDIA_ROUTE = '/media';
export const CATALOGUE_PRODUCT_IMAGE_DIRECTORY = 'catalogue-front-photos';

export function resolveCatalogueMediaRootDir(): string {
  return resolve(process.cwd(), 'storage/media');
}

export function resolveCatalogueProductImageDir(): string {
  return resolve(
    resolveCatalogueMediaRootDir(),
    CATALOGUE_PRODUCT_IMAGE_DIRECTORY,
  );
}

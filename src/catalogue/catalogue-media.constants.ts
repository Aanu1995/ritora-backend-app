import { resolve } from 'path';

export const CATALOGUE_MEDIA_ROUTE = '/media';
export const CATALOGUE_FRONT_IMAGE_DIRECTORY = 'catalogue-front-photos';

export function resolveCatalogueMediaRootDir(): string {
  return resolve(process.cwd(), 'storage/media');
}

export function resolveCatalogueFrontImageDir(): string {
  return resolve(
    resolveCatalogueMediaRootDir(),
    CATALOGUE_FRONT_IMAGE_DIRECTORY,
  );
}

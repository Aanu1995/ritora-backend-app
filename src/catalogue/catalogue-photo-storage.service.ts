import { Injectable } from '@nestjs/common';
import { mkdir, writeFile } from 'fs/promises';
import { extname } from 'path';
import { ulid } from 'ulid';
import {
  CATALOGUE_FRONT_IMAGE_DIRECTORY,
  CATALOGUE_MEDIA_ROUTE,
  resolveCatalogueFrontImageDir,
} from './catalogue-media.constants';
import type { UploadedCatalogueImage } from './catalogue-photo.types';

const FILE_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
};

@Injectable()
export class CataloguePhotoStorageService {
  async saveHeroImage(
    file: UploadedCatalogueImage,
    publicBaseUrl: string,
  ): Promise<string> {
    const directory = resolveCatalogueFrontImageDir();
    await mkdir(directory, { recursive: true });

    const extension = this.resolveFileExtension(file);
    const fileName = `${ulid()}${extension}`;
    const absolutePath = `${directory}/${fileName}`;

    await writeFile(absolutePath, file.buffer);

    return new URL(
      `${CATALOGUE_MEDIA_ROUTE}/${CATALOGUE_FRONT_IMAGE_DIRECTORY}/${fileName}`,
      publicBaseUrl,
    ).toString();
  }

  private resolveFileExtension(file: UploadedCatalogueImage): string {
    const originalExtension = extname(file.originalname ?? '').toLowerCase();
    if (originalExtension) {
      return originalExtension;
    }

    return FILE_EXTENSION_BY_MIME_TYPE[file.mimetype] ?? '.jpg';
  }
}

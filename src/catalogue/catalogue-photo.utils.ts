import { BadRequestException } from '@nestjs/common';
import {
  CATALOGUE_PHOTO_MAX_IMAGES,
  CATALOGUE_PHOTO_MIN_IMAGES,
  SUPPORTED_CATALOGUE_PHOTO_MIME_TYPES,
} from './catalogue-photo.constants';
import type {
  CataloguePhotoExtractionInput,
  UploadedCatalogueImage,
} from './catalogue-photo.types';

export function parseHeroImageIndex(value: string | undefined): number {
  const normalizedHeroImageIndex = value?.trim() ?? '';
  const heroImageIndex = Number(normalizedHeroImageIndex);

  if (
    !Number.isInteger(heroImageIndex) ||
    normalizedHeroImageIndex !== String(heroImageIndex)
  ) {
    throw new BadRequestException('Invalid heroImageIndex');
  }

  return heroImageIndex;
}

export function assertValidCataloguePhotoRequest(
  images: UploadedCatalogueImage[],
  heroImageIndex: number,
): void {
  if (
    images.length < CATALOGUE_PHOTO_MIN_IMAGES ||
    images.length > CATALOGUE_PHOTO_MAX_IMAGES
  ) {
    throw new BadRequestException(
      `Upload between ${CATALOGUE_PHOTO_MIN_IMAGES} and ${CATALOGUE_PHOTO_MAX_IMAGES} images`,
    );
  }

  images.forEach((image, index) => {
    assertValidCataloguePhoto(image, `images[${index}]`);
  });

  if (
    !Number.isInteger(heroImageIndex) ||
    heroImageIndex < 0 ||
    heroImageIndex >= images.length
  ) {
    throw new BadRequestException('Invalid heroImageIndex');
  }
}

export function toCataloguePhotoExtractionInput(
  images: UploadedCatalogueImage[],
  heroImageIndex: number,
): CataloguePhotoExtractionInput {
  return {
    images: images.map((image) => ({
      buffer: image.buffer,
      mimetype: image.mimetype,
    })),
    heroImageIndex,
  };
}

function assertValidCataloguePhoto(
  file: UploadedCatalogueImage | null | undefined,
  fieldName: string,
): asserts file is UploadedCatalogueImage {
  if (!file || !file.buffer?.length) {
    throw new BadRequestException(`${fieldName} is required`);
  }

  if (!SUPPORTED_CATALOGUE_PHOTO_MIME_TYPES.has(file.mimetype)) {
    throw new BadRequestException(`${fieldName} must be a supported image`);
  }
}

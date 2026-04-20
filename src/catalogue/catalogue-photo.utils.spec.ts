import { BadRequestException } from '@nestjs/common';
import {
  assertValidCataloguePhotoRequest,
  parseHeroImageIndex,
  toCataloguePhotoExtractionInput,
} from './catalogue-photo.utils';
import type { UploadedCatalogueImage } from './catalogue-photo.types';

function createUploadedImage(
  name: string,
  mimetype = 'image/jpeg',
): UploadedCatalogueImage {
  return {
    originalname: `${name}.jpg`,
    mimetype,
    size: name.length,
    buffer: Buffer.from(name),
  };
}

describe('catalogue-photo.utils', () => {
  it('parses a strict hero image index', () => {
    expect(parseHeroImageIndex('2')).toBe(2);
  });

  it('rejects malformed hero image indices', () => {
    expect(() => parseHeroImageIndex('02')).toThrow(BadRequestException);
    expect(() => parseHeroImageIndex('')).toThrow(BadRequestException);
  });

  it('validates the photo request shape and supported types', () => {
    expect(() =>
      assertValidCataloguePhotoRequest(
        [createUploadedImage('product'), createUploadedImage('label')],
        0,
      ),
    ).not.toThrow();

    expect(() =>
      assertValidCataloguePhotoRequest([createUploadedImage('product')], 0),
    ).toThrow(BadRequestException);

    expect(() =>
      assertValidCataloguePhotoRequest(
        [
          createUploadedImage('product'),
          createUploadedImage('label', 'image/gif'),
        ],
        0,
      ),
    ).toThrow(BadRequestException);
  });

  it('builds the extractor payload without leaking original filenames', () => {
    expect(
      toCataloguePhotoExtractionInput(
        [createUploadedImage('product'), createUploadedImage('label')],
        1,
      ),
    ).toEqual({
      images: [
        {
          buffer: Buffer.from('product'),
          mimetype: 'image/jpeg',
        },
        {
          buffer: Buffer.from('label'),
          mimetype: 'image/jpeg',
        },
      ],
      heroImageIndex: 1,
    });
  });
});

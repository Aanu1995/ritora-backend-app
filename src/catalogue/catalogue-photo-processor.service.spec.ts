import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { CataloguePhotoProcessorService } from './catalogue-photo-processor.service';
import type { UploadedCatalogueImage } from './catalogue-photo.types';

async function createBorderedImage(
  width: number,
  height: number,
  options: {
    border: number;
    background: { r: number; g: number; b: number };
    subject: { r: number; g: number; b: number };
  },
): Promise<Buffer> {
  const background = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: options.background,
    },
  });
  const subject = await sharp({
    create: {
      width: width - options.border * 2,
      height: height - options.border * 2,
      channels: 3,
      background: options.subject,
    },
  })
    .png()
    .toBuffer();

  return background
    .composite([
      {
        input: subject,
        left: options.border,
        top: options.border,
      },
    ])
    .png()
    .toBuffer();
}

describe('CataloguePhotoProcessorService', () => {
  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'PRODUCT_EXTRACTION_IMAGE_MAX_DIMENSION') return 2400;
      if (key === 'PRODUCT_EXTRACTION_IMAGE_WEBP_QUALITY') return 90;
      return undefined;
    }),
    getOrThrow: jest.fn((key: string) => {
      if (key === 'PRODUCT_EXTRACTION_IMAGE_MAX_DIMENSION') return 2400;
      if (key === 'PRODUCT_EXTRACTION_IMAGE_WEBP_QUALITY') return 90;
      throw new Error(`Missing config ${key}`);
    }),
  } as unknown as ConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes, crops, and converts uploads before extraction', async () => {
    const service = new CataloguePhotoProcessorService(configService);
    const heroImage: UploadedCatalogueImage = {
      originalname: 'hero.png',
      mimetype: 'image/png',
      buffer: await createBorderedImage(2200, 1400, {
        border: 220,
        background: { r: 255, g: 255, b: 255 },
        subject: { r: 38, g: 74, b: 112 },
      }),
    };
    const labelImage: UploadedCatalogueImage = {
      originalname: 'label.png',
      mimetype: 'image/png',
      buffer: await createBorderedImage(1800, 1800, {
        border: 180,
        background: { r: 255, g: 255, b: 255 },
        subject: { r: 245, g: 245, b: 245 },
      }),
    };

    const result = await service.prepareForExtraction(
      [heroImage, labelImage],
      0,
    );

    expect(result.extractionInput.heroImageIndex).toBe(0);
    expect(result.extractionInput.sourceImageCount).toBe(2);
    expect(result.extractionInput.images).toHaveLength(4);
    expect(result.extractionInput.images.map((image) => image.variant)).toEqual(
      ['overview', 'text-enhanced', 'overview', 'text-enhanced'],
    );
    expect(
      result.extractionInput.images.map((image) => image.sourceIndex),
    ).toEqual([0, 0, 1, 1]);
    expect(result.extractionInput.images[0].isHero).toBe(true);
    expect(result.extractionInput.images[2].isHero).toBe(false);

    expect(result.heroStorageImage.mimetype).toBe('image/webp');
    expect(result.heroStorageImage.originalname).toBe('hero.webp');
    const heroMetadata = await sharp(result.heroStorageImage.buffer).metadata();
    expect(heroMetadata.format).toBe('webp');
    expect(
      Math.max(heroMetadata.width ?? 0, heroMetadata.height ?? 0),
    ).toBeLessThanOrEqual(1600);

    const processedLabelOverview = result.extractionInput.images[2];
    const labelMetadata = await sharp(processedLabelOverview.buffer).metadata();
    expect(labelMetadata.format).toBe('webp');
    expect(
      Math.max(labelMetadata.width ?? 0, labelMetadata.height ?? 0),
    ).toBeLessThanOrEqual(2400);
  }, 15_000);
});

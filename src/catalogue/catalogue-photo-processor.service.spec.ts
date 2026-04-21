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
    get: jest.fn((key: string, fallback?: number) => fallback),
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
    expect(result.heroStorageImage.mimetype).toBe('image/webp');
    expect(result.heroStorageImage.originalname).toBe('hero.webp');
    const heroMetadata = await sharp(result.heroStorageImage.buffer).metadata();
    expect(heroMetadata.format).toBe('webp');
    expect(
      Math.max(heroMetadata.width ?? 0, heroMetadata.height ?? 0),
    ).toBeLessThanOrEqual(1600);

    const processedLabel = result.extractionInput.images[1];
    const labelMetadata = await sharp(processedLabel.buffer).metadata();
    expect(labelMetadata.format).toBe('webp');
    expect(
      Math.max(labelMetadata.width ?? 0, labelMetadata.height ?? 0),
    ).toBeLessThanOrEqual(1600);
  });
});

import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getNumberConfig } from '../config/config-value.utils';
import sharp from 'sharp';
import {
  CATALOGUE_PRODUCT_EXTRACTION_IMAGE_MAX_DIMENSION,
  CATALOGUE_PRODUCT_EXTRACTION_IMAGE_WEBP_QUALITY,
  CATALOGUE_PRODUCT_IMAGE_MAX_DIMENSION,
  CATALOGUE_PRODUCT_IMAGE_WEBP_QUALITY,
} from './catalogue-media.constants';
import type {
  CataloguePhotoAsset,
  ProcessedCatalogueImage,
  ProcessedCataloguePhotoBatch,
  UploadedCatalogueImage,
} from './catalogue-photo.types';

const HERO_BACKGROUND = { r: 246, g: 243, b: 238 };
const LABEL_BACKGROUND = { r: 255, g: 255, b: 255 };
const MIN_TRIMMED_AREA_RATIO = 0.2;

@Injectable()
export class CataloguePhotoProcessorService {
  constructor(private readonly configService: ConfigService) {}

  async prepareHeroImageForStorage(
    image: UploadedCatalogueImage,
  ): Promise<ProcessedCatalogueImage> {
    const processingConfig = this.getProcessingConfig();

    return this.processImage(image, {
      isHero: true,
      maxDimension: processingConfig.storageMaxDimension,
      quality: processingConfig.storageQuality,
    });
  }

  async prepareForExtraction(
    images: UploadedCatalogueImage[],
    heroImageIndex: number,
  ): Promise<ProcessedCataloguePhotoBatch> {
    const processingConfig = this.getProcessingConfig();

    const [heroStorageImage, extractionImages] = await Promise.all([
      this.processImage(images[heroImageIndex], {
        isHero: true,
        maxDimension: processingConfig.storageMaxDimension,
        quality: processingConfig.storageQuality,
      }),
      Promise.all(
        images.map((image, index) =>
          this.prepareExtractionAssets(image, {
            sourceIndex: index,
            isHero: index === heroImageIndex,
            maxDimension: processingConfig.extractionMaxDimension,
            quality: processingConfig.extractionQuality,
          }),
        ),
      ).then((assets) => assets.flat()),
    ]);

    return {
      extractionInput: {
        images: extractionImages,
        heroImageIndex,
        sourceImageCount: images.length,
      },
      heroStorageImage,
    };
  }

  private async processImage(
    image: UploadedCatalogueImage,
    options: {
      isHero: boolean;
      maxDimension: number;
      quality: number;
    },
  ): Promise<ProcessedCatalogueImage> {
    try {
      const normalized = sharp(image.buffer, {
        failOn: 'none',
        limitInputPixels: false,
      }).rotate();
      const croppedBuffer = await this.cropToSubject(
        normalized,
        options.isHero,
      );
      const output = sharp(croppedBuffer, {
        failOn: 'none',
        limitInputPixels: false,
      })
        .resize({
          width: options.maxDimension,
          height: options.maxDimension,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .flatten({
          background: options.isHero ? HERO_BACKGROUND : LABEL_BACKGROUND,
        })
        .webp({
          quality: options.quality,
          alphaQuality: options.quality,
          effort: 4,
        });
      const { data, info } = await output.toBuffer({ resolveWithObject: true });

      return {
        buffer: data,
        mimetype: 'image/webp',
        originalname: this.toProcessedFileName(image.originalname),
        size: info.size,
        width: info.width,
        height: info.height,
      };
    } catch (error) {
      throw new InternalServerErrorException(
        `Failed to process ${options.isHero ? 'product' : 'label'} image`,
        {
          cause: error instanceof Error ? error : undefined,
        },
      );
    }
  }

  private async prepareExtractionAssets(
    image: UploadedCatalogueImage,
    options: {
      sourceIndex: number;
      isHero: boolean;
      maxDimension: number;
      quality: number;
    },
  ): Promise<CataloguePhotoAsset[]> {
    const normalizedBuffer = await sharp(image.buffer, {
      failOn: 'none',
      limitInputPixels: false,
    })
      .rotate()
      .toBuffer();
    const croppedBuffer = await this.cropToSubject(
      sharp(normalizedBuffer, {
        failOn: 'none',
        limitInputPixels: false,
      }),
      options.isHero,
    );
    const overview = await this.encodeExtractionAsset(normalizedBuffer, {
      ...options,
      variant: 'overview',
      enhanceText: false,
    });
    const textEnhanced = await this.encodeExtractionAsset(croppedBuffer, {
      ...options,
      variant: 'text-enhanced',
      enhanceText: true,
    });

    return [overview, textEnhanced];
  }

  private async encodeExtractionAsset(
    buffer: Buffer,
    options: {
      sourceIndex: number;
      isHero: boolean;
      maxDimension: number;
      quality: number;
      variant: CataloguePhotoAsset['variant'];
      enhanceText: boolean;
    },
  ): Promise<CataloguePhotoAsset> {
    let pipeline = sharp(buffer, {
      failOn: 'none',
      limitInputPixels: false,
    })
      .resize({
        width: options.maxDimension,
        height: options.maxDimension,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({
        background: options.isHero ? HERO_BACKGROUND : LABEL_BACKGROUND,
      });

    if (options.enhanceText) {
      pipeline = pipeline.grayscale().normalize().sharpen();
    }

    const { data, info } = await pipeline
      .webp({
        quality: options.quality,
        alphaQuality: options.quality,
        effort: 4,
      })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: data,
      mimetype: 'image/webp',
      sourceIndex: options.sourceIndex,
      isHero: options.isHero,
      variant: options.variant,
      width: info.width,
      height: info.height,
    };
  }

  private getProcessingConfig(): {
    storageMaxDimension: number;
    storageQuality: number;
    extractionMaxDimension: number;
    extractionQuality: number;
  } {
    return {
      storageMaxDimension: getNumberConfig(
        this.configService,
        'PRODUCT_MEDIA_PROCESSED_MAX_DIMENSION',
        CATALOGUE_PRODUCT_IMAGE_MAX_DIMENSION,
      ),
      storageQuality: getNumberConfig(
        this.configService,
        'PRODUCT_MEDIA_WEBP_QUALITY',
        CATALOGUE_PRODUCT_IMAGE_WEBP_QUALITY,
      ),
      extractionMaxDimension: getNumberConfig(
        this.configService,
        'PRODUCT_EXTRACTION_IMAGE_MAX_DIMENSION',
        CATALOGUE_PRODUCT_EXTRACTION_IMAGE_MAX_DIMENSION,
      ),
      extractionQuality: getNumberConfig(
        this.configService,
        'PRODUCT_EXTRACTION_IMAGE_WEBP_QUALITY',
        CATALOGUE_PRODUCT_EXTRACTION_IMAGE_WEBP_QUALITY,
      ),
    };
  }

  private async cropToSubject(
    pipeline: sharp.Sharp,
    isHero: boolean,
  ): Promise<Buffer> {
    const metadata = await pipeline.metadata();
    const originalWidth = metadata.width ?? 0;
    const originalHeight = metadata.height ?? 0;
    const originalArea = originalWidth * originalHeight;

    if (!originalArea) {
      return pipeline.toBuffer();
    }

    const trimmed = await pipeline
      .clone()
      .trim({
        threshold: isHero ? 12 : 18,
      })
      .toBuffer({ resolveWithObject: true });
    const trimmedArea = trimmed.info.width * trimmed.info.height;

    if (trimmedArea < originalArea * MIN_TRIMMED_AREA_RATIO) {
      return pipeline.toBuffer();
    }

    return trimmed.data;
  }

  private toProcessedFileName(originalName: string): string {
    const normalizedBaseName = originalName
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-z0-9-_]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
    const baseName = normalizedBaseName || 'product-photo';

    return `${baseName}.webp`;
  }
}

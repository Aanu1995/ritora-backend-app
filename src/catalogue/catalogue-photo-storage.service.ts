import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl as getSignedCloudFrontUrl } from '@aws-sdk/cloudfront-signer';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getNumberConfig } from '../config/config-value.utils';
import { ulid } from 'ulid';
import { CATALOGUE_PRODUCT_IMAGE_PROCESSED_PREFIX } from './catalogue-media.constants';
import type { UploadedCatalogueImage } from './catalogue-photo.types';

type MediaRuntimeConfig = {
  bucketName: string;
  cloudFrontBaseUrl: string;
  signedUrlTtlSeconds: number;
  cloudFrontKeyPairId: string;
  cloudFrontPrivateKey: string;
  kmsKeyId: string | null;
};

type HeroImageUpload = {
  url: Promise<string | null>;
  cleanup: () => Promise<void>;
};

@Injectable()
export class CataloguePhotoStorageService {
  private readonly s3Client: S3Client;

  constructor(private readonly configService: ConfigService) {
    this.s3Client = new S3Client({
      region: this.configService.get<string>('AWS_REGION', 'eu-west-1'),
    });
  }

  async saveHeroImage(file: UploadedCatalogueImage): Promise<string | null> {
    return this.startHeroImageUpload(file).url;
  }

  startHeroImageUpload(file: UploadedCatalogueImage): HeroImageUpload {
    const runtimeConfig = this.getRuntimeConfig();
    if (!runtimeConfig) {
      return {
        url: Promise.resolve(null),
        cleanup: async () => {},
      };
    }

    const objectKey = `${CATALOGUE_PRODUCT_IMAGE_PROCESSED_PREFIX}/${ulid()}.webp`;
    const upload = this.putHeroImage(file, objectKey, runtimeConfig);
    const url = upload.then(() =>
      this.createSignedManagedUrl(objectKey, runtimeConfig),
    );
    void url.catch(() => undefined);

    return {
      url,
      cleanup: () =>
        this.deleteUploadedHeroImage(upload, objectKey, runtimeConfig),
    };
  }

  private async putHeroImage(
    file: UploadedCatalogueImage,
    objectKey: string,
    runtimeConfig: MediaRuntimeConfig,
  ): Promise<void> {
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: runtimeConfig.bucketName,
        Key: objectKey,
        Body: file.buffer,
        ContentType: file.mimetype,
        CacheControl: 'private, max-age=31536000, immutable',
        ServerSideEncryption: 'aws:kms',
        ...(runtimeConfig.kmsKeyId
          ? {
              SSEKMSKeyId: runtimeConfig.kmsKeyId,
            }
          : {}),
      }),
    );
  }

  private async deleteUploadedHeroImage(
    upload: Promise<void>,
    objectKey: string,
    runtimeConfig: MediaRuntimeConfig,
  ): Promise<void> {
    try {
      await upload;
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: runtimeConfig.bucketName,
          Key: objectKey,
        }),
      );
    } catch {
      return;
    }
  }

  toPersistentImageUrls(imageUrls: string[]): string[] {
    return imageUrls.map((imageUrl) => this.toPersistentImageUrl(imageUrl));
  }

  resolvePublicImageUrls(imageUrls: string[]): string[] {
    return imageUrls.map((imageUrl) => this.resolvePublicImageUrl(imageUrl));
  }

  private toPersistentImageUrl(imageUrl: string): string {
    const objectKey = this.toManagedObjectKey(imageUrl);
    if (!objectKey) {
      return imageUrl;
    }

    const runtimeConfig = this.getRuntimeConfig();
    if (!runtimeConfig) {
      return imageUrl;
    }

    return this.createManagedBaseUrl(objectKey, runtimeConfig);
  }

  private resolvePublicImageUrl(imageUrl: string): string {
    const objectKey = this.toManagedObjectKey(imageUrl);
    if (!objectKey) {
      return imageUrl;
    }

    const runtimeConfig = this.getRuntimeConfig();
    if (!runtimeConfig) {
      return imageUrl;
    }

    return this.createSignedManagedUrl(objectKey, runtimeConfig);
  }

  private createSignedManagedUrl(
    objectKey: string,
    runtimeConfig: MediaRuntimeConfig,
  ): string {
    const canonicalUrl = this.createManagedBaseUrl(objectKey, runtimeConfig);

    return getSignedCloudFrontUrl({
      url: canonicalUrl,
      keyPairId: runtimeConfig.cloudFrontKeyPairId,
      privateKey: runtimeConfig.cloudFrontPrivateKey,
      dateLessThan: new Date(
        Date.now() + runtimeConfig.signedUrlTtlSeconds * 1000,
      ).toISOString(),
    });
  }

  private createManagedBaseUrl(
    objectKey: string,
    runtimeConfig: MediaRuntimeConfig,
  ): string {
    return new URL(
      objectKey,
      runtimeConfig.cloudFrontBaseUrl.endsWith('/')
        ? runtimeConfig.cloudFrontBaseUrl
        : `${runtimeConfig.cloudFrontBaseUrl}/`,
    ).toString();
  }

  private toManagedObjectKey(imageUrl: string): string | null {
    const runtimeConfig = this.getRuntimeConfig();
    if (!runtimeConfig) {
      return null;
    }

    try {
      const parsed = new URL(imageUrl);
      const configuredOrigin = new URL(runtimeConfig.cloudFrontBaseUrl).origin;
      if (parsed.origin !== configuredOrigin) {
        return null;
      }

      const objectKey = parsed.pathname.replace(/^\/+/, '');
      if (
        !objectKey.startsWith(`${CATALOGUE_PRODUCT_IMAGE_PROCESSED_PREFIX}/`)
      ) {
        return null;
      }

      return objectKey;
    } catch {
      return null;
    }
  }

  private getRuntimeConfig(): MediaRuntimeConfig | null {
    const bucketName = this.getBucketName();
    const cloudFrontBaseUrl = this.getCloudFrontBaseUrl();
    const cloudFrontKeyPairId = this.configService
      .get<string>('PRODUCT_MEDIA_CLOUDFRONT_KEY_PAIR_ID', '')
      .trim();
    const cloudFrontPrivateKey = this.configService
      .get<string>('PRODUCT_MEDIA_CLOUDFRONT_PRIVATE_KEY', '')
      .replace(/\\n/g, '\n')
      .trim();

    if (
      !bucketName ||
      !cloudFrontBaseUrl ||
      !cloudFrontKeyPairId ||
      !cloudFrontPrivateKey
    ) {
      return null;
    }

    return {
      bucketName,
      cloudFrontBaseUrl,
      signedUrlTtlSeconds: getNumberConfig(
        this.configService,
        'PRODUCT_MEDIA_SIGNED_URL_TTL_SECONDS',
        3600,
      ),
      cloudFrontKeyPairId,
      cloudFrontPrivateKey,
      kmsKeyId:
        this.configService
          .get<string>('PRODUCT_MEDIA_S3_KMS_KEY_ID', '')
          .trim() || null,
    };
  }

  private getBucketName(): string {
    return this.configService.get<string>('PRODUCT_MEDIA_BUCKET', '');
  }

  private getCloudFrontBaseUrl(): string {
    return this.configService.get<string>('PRODUCT_MEDIA_CLOUDFRONT_URL', '');
  }
}

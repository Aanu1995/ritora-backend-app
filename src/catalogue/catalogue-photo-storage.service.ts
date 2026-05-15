import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl as getSignedCloudFrontUrl } from '@aws-sdk/cloudfront-signer';
import {
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ulid } from 'ulid';
import {
  CATALOGUE_PRODUCT_IMAGE_PROCESSED_PREFIX,
  CATALOGUE_PRODUCT_MEDIA_SIGNED_URL_TTL_SECONDS,
} from './catalogue-media.constants';
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

const SIGNING_KEY_ERROR_MESSAGE =
  'Product image signing is not configured correctly';
const PRIVATE_KEY_HEADER_PATTERN = /^-----BEGIN (?:RSA )?PRIVATE KEY-----$/;
const PRIVATE_KEY_FOOTER_PATTERN = /^-----END (?:RSA )?PRIVATE KEY-----$/;
const S3_DELETE_OBJECTS_BATCH_SIZE = 1000;

@Injectable()
export class CataloguePhotoStorageService implements OnModuleDestroy {
  private readonly s3Client: S3Client;

  constructor(private readonly configService: ConfigService) {
    this.s3Client = new S3Client({
      region: this.configService.getOrThrow<string>('AWS_REGION'),
    });
  }

  onModuleDestroy(): void {
    this.s3Client.destroy();
  }

  async saveHeroImage(
    file: UploadedCatalogueImage,
    ownerId?: string,
  ): Promise<string | null> {
    return this.startHeroImageUpload(file, ownerId).url;
  }

  startHeroImageUpload(
    file: UploadedCatalogueImage,
    ownerId?: string,
  ): HeroImageUpload {
    const runtimeConfig = this.getRuntimeConfig();
    if (!runtimeConfig) {
      return {
        url: Promise.resolve(null),
        cleanup: async () => {},
      };
    }

    this.assertUsableSigningKey(runtimeConfig.cloudFrontPrivateKey);

    const objectKey = `${this.managedOwnerPrefix(ownerId)}/${ulid()}.webp`;
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

  async deleteManagedImageUrls(imageUrls: string[]): Promise<void> {
    const runtimeConfig = this.getRuntimeConfig();
    if (!runtimeConfig) {
      return;
    }

    const objectKeys = Array.from(
      new Set(
        imageUrls
          .map((imageUrl) =>
            this.toManagedObjectKeyWithRuntime(imageUrl, runtimeConfig),
          )
          .filter((objectKey): objectKey is string => objectKey !== null),
      ),
    );

    for (
      let index = 0;
      index < objectKeys.length;
      index += S3_DELETE_OBJECTS_BATCH_SIZE
    ) {
      await this.deleteManagedObjectBatch(
        objectKeys.slice(index, index + S3_DELETE_OBJECTS_BATCH_SIZE),
        runtimeConfig,
      );
    }
  }

  private async deleteManagedObjectBatch(
    objectKeys: string[],
    runtimeConfig: MediaRuntimeConfig,
  ): Promise<void> {
    if (objectKeys.length === 0) {
      return;
    }

    const response = await this.s3Client.send(
      new DeleteObjectsCommand({
        Bucket: runtimeConfig.bucketName,
        Delete: {
          Objects: objectKeys.map((objectKey) => ({ Key: objectKey })),
          Quiet: true,
        },
      }),
    );

    const errorCount = response.Errors?.length ?? 0;
    if (errorCount > 0) {
      throw new Error(
        `Failed to delete ${errorCount} managed product image${
          errorCount === 1 ? '' : 's'
        }`,
      );
    }
  }

  private toManagedObjectKeyWithRuntime(
    imageUrl: string,
    runtimeConfig: MediaRuntimeConfig,
  ): string | null {
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

  async deleteManagedImagesForOwner(ownerId: string): Promise<void> {
    const runtimeConfig = this.getRuntimeConfig();
    if (!runtimeConfig) {
      return;
    }

    const prefix = `${this.managedOwnerPrefix(ownerId)}/`;
    let continuationToken: string | undefined;

    do {
      const response = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: runtimeConfig.bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      const objectKeys = (response.Contents ?? [])
        .map((object) => object.Key)
        .filter(
          (objectKey): objectKey is string => typeof objectKey === 'string',
        );

      await this.deleteManagedObjectBatch(objectKeys, runtimeConfig);
      continuationToken = response.IsTruncated
        ? response.NextContinuationToken
        : undefined;
    } while (continuationToken);
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

    try {
      return this.createSignedManagedUrl(objectKey, runtimeConfig);
    } catch {
      return this.createManagedBaseUrl(objectKey, runtimeConfig);
    }
  }

  private createSignedManagedUrl(
    objectKey: string,
    runtimeConfig: MediaRuntimeConfig,
  ): string {
    this.assertUsableSigningKey(runtimeConfig.cloudFrontPrivateKey);
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

    return this.toManagedObjectKeyWithRuntime(imageUrl, runtimeConfig);
  }

  private managedOwnerPrefix(ownerId?: string): string {
    if (!ownerId) {
      return CATALOGUE_PRODUCT_IMAGE_PROCESSED_PREFIX;
    }

    return `${CATALOGUE_PRODUCT_IMAGE_PROCESSED_PREFIX}/${encodeURIComponent(
      ownerId,
    )}`;
  }

  private getRuntimeConfig(): MediaRuntimeConfig | null {
    const bucketName = this.getBucketName();
    const cloudFrontBaseUrl = this.getCloudFrontBaseUrl();
    const cloudFrontKeyPairId = this.configService
      .getOrThrow<string>('PRODUCT_MEDIA_CLOUDFRONT_KEY_PAIR_ID')
      .trim();
    const cloudFrontPrivateKey = this.configService
      .getOrThrow<string>('PRODUCT_MEDIA_CLOUDFRONT_PRIVATE_KEY')
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
      signedUrlTtlSeconds: CATALOGUE_PRODUCT_MEDIA_SIGNED_URL_TTL_SECONDS,
      cloudFrontKeyPairId,
      cloudFrontPrivateKey,
      kmsKeyId:
        this.configService
          .getOrThrow<string>('PRODUCT_MEDIA_S3_KMS_KEY_ID')
          .trim() || null,
    };
  }

  private getBucketName(): string {
    return this.configService.getOrThrow<string>('PRODUCT_MEDIA_BUCKET');
  }

  private getCloudFrontBaseUrl(): string {
    return this.configService.getOrThrow<string>(
      'PRODUCT_MEDIA_CLOUDFRONT_URL',
    );
  }

  private assertUsableSigningKey(privateKey: string): void {
    const lines = privateKey.split('\n').filter(Boolean);
    const header = lines.at(0);
    const footer = lines.at(-1);

    if (
      !header ||
      !footer ||
      !PRIVATE_KEY_HEADER_PATTERN.test(header) ||
      !PRIVATE_KEY_FOOTER_PATTERN.test(footer)
    ) {
      throw new ServiceUnavailableException(SIGNING_KEY_ERROR_MESSAGE);
    }
  }
}

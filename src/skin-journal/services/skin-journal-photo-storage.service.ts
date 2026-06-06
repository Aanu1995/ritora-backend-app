import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl as getSignedCloudFrontUrl } from '@aws-sdk/cloudfront-signer';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { access, mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { dirname, resolve, sep } from 'path';
import sharp from 'sharp';
import { ulid } from 'ulid';
import {
  SKIN_JOURNAL_LOCAL_DIR,
  SKIN_JOURNAL_LOCAL_MEDIA_URL_PREFIX,
  SKIN_JOURNAL_MEDIA_SIGNED_URL_TTL_SECONDS,
  SKIN_JOURNAL_PHOTO_MAX_BYTES,
  SKIN_JOURNAL_PHOTO_MAX_DIMENSION,
  SKIN_JOURNAL_PHOTO_WEBP_QUALITY,
} from '../skin-journal.constants';

const DEV_LOCAL_MEDIA_SIGNING_SECRET =
  'ritora-dev-skin-journal-local-media-signing-secret-change-me';
const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);
const SIGNING_KEY_ERROR_MESSAGE =
  'Skin journal photo signing is not configured correctly';
const PRIVATE_KEY_HEADER_PATTERN = /^-----BEGIN (?:RSA )?PRIVATE KEY-----$/;
const PRIVATE_KEY_FOOTER_PATTERN = /^-----END (?:RSA )?PRIVATE KEY-----$/;

type StoredPhoto = {
  object_key: string;
  width: number | null;
  height: number | null;
  size: number;
  content_type: string;
  exif_stripped: boolean;
};

type MediaRuntimeConfig = {
  bucketName: string;
  cloudFrontBaseUrl: string;
  signedUrlTtlSeconds: number;
  cloudFrontKeyPairId: string;
  cloudFrontPrivateKey: string;
  kmsKeyId: string | null;
};

type TransformToByteArrayBody = {
  transformToByteArray: () => Promise<Uint8Array>;
};

type LocalSignedPhoto = {
  buffer: Buffer;
  contentType: 'image/webp';
  maxAgeSeconds: number;
};

@Injectable()
export class SkinJournalPhotoStorageService implements OnModuleDestroy {
  private readonly logger = new Logger(SkinJournalPhotoStorageService.name);
  private readonly s3Client: S3Client;

  constructor(private readonly config: ConfigService) {
    this.s3Client = new S3Client({
      region: this.config.getOrThrow<string>('AWS_REGION'),
    });
  }

  onModuleDestroy(): void {
    this.s3Client.destroy?.();
  }

  async storePhoto(params: {
    userId: string;
    entryId: string;
    buffer: Buffer;
    contentType: string;
  }): Promise<StoredPhoto> {
    const contentType = normalizeMimeType(params.contentType);
    if (!SUPPORTED_MIME_TYPES.has(contentType)) {
      throw new BadRequestException('Unsupported photo content type');
    }
    if (params.buffer.length > SKIN_JOURNAL_PHOTO_MAX_BYTES) {
      throw new BadRequestException('Photo exceeds maximum upload size');
    }

    const processed = await this.processPhoto(params.buffer);
    const objectKey = `skin-journal/${safeObjectPart(params.userId)}/${safeObjectPart(params.entryId)}/${ulid()}.webp`;
    const runtimeConfig = this.getRuntimeConfig();

    if (runtimeConfig) {
      this.assertUsableSigningKey(runtimeConfig.cloudFrontPrivateKey);
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: runtimeConfig.bucketName,
          Key: objectKey,
          Body: processed.buffer,
          ContentType: 'image/webp',
          CacheControl: 'private, max-age=31536000, immutable',
          ServerSideEncryption: 'aws:kms',
          ...(runtimeConfig.kmsKeyId
            ? {
                SSEKMSKeyId: runtimeConfig.kmsKeyId,
              }
            : {}),
        }),
      );
    } else {
      const fullPath = this.toLocalPath(objectKey);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, processed.buffer);
    }

    return {
      object_key: objectKey,
      width: processed.width,
      height: processed.height,
      size: processed.buffer.length,
      content_type: 'image/webp',
      exif_stripped: true,
    };
  }

  async deletePhoto(objectKey: string): Promise<void> {
    if (!objectKey) {
      return;
    }
    assertSafeObjectKey(objectKey);
    const runtimeConfig = this.getRuntimeConfig();
    try {
      if (runtimeConfig) {
        await this.s3Client.send(
          new DeleteObjectCommand({
            Bucket: runtimeConfig.bucketName,
            Key: objectKey,
          }),
        );
        return;
      }
      await unlink(this.toLocalPath(objectKey));
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') {
        this.logger.warn(`Failed to delete photo ${objectKey}: ${err.message}`);
      }
    }
  }

  async photoExists(objectKey: string): Promise<boolean> {
    assertSafeObjectKey(objectKey);
    const runtimeConfig = this.getRuntimeConfig();
    if (!runtimeConfig) {
      try {
        await access(this.toLocalPath(objectKey));
        return true;
      } catch {
        return false;
      }
    }

    try {
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: runtimeConfig.bucketName,
          Key: objectKey,
        }),
      );
      return true;
    } catch (error) {
      if (isNotFoundStorageError(error)) {
        return false;
      }
      throw error;
    }
  }

  async readPhotoBuffer(objectKey: string): Promise<Buffer> {
    assertSafeObjectKey(objectKey);
    const runtimeConfig = this.getRuntimeConfig();
    if (!runtimeConfig) {
      return readFile(this.toLocalPath(objectKey));
    }

    const response = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: runtimeConfig.bucketName,
        Key: objectKey,
      }),
    );
    const body = response.Body;
    if (isTransformToByteArrayBody(body)) {
      return Buffer.from(await body.transformToByteArray());
    }

    throw new Error('S3 returned an unreadable photo body');
  }

  /** Returns a short-lived URL the frontend can render. */
  getSignedUrl(
    objectKey: string | null,
    options: { ttlSeconds?: number } = {},
  ): string | null {
    if (!objectKey) {
      return null;
    }
    assertSafeObjectKey(objectKey);
    const runtimeConfig = this.getRuntimeConfig();
    if (!runtimeConfig) {
      const ttlSeconds =
        options.ttlSeconds ?? SKIN_JOURNAL_MEDIA_SIGNED_URL_TTL_SECONDS;
      const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
      const payload = Buffer.from(
        JSON.stringify({ key: objectKey, exp: expiresAt }),
      ).toString('base64url');
      return `${SKIN_JOURNAL_LOCAL_MEDIA_URL_PREFIX}/${payload}.${this.signLocalMediaPayload(payload)}`;
    }

    this.assertUsableSigningKey(runtimeConfig.cloudFrontPrivateKey);
    return getSignedCloudFrontUrl({
      url: new URL(
        objectKey,
        runtimeConfig.cloudFrontBaseUrl.endsWith('/')
          ? runtimeConfig.cloudFrontBaseUrl
          : `${runtimeConfig.cloudFrontBaseUrl}/`,
      ).toString(),
      keyPairId: runtimeConfig.cloudFrontKeyPairId,
      privateKey: runtimeConfig.cloudFrontPrivateKey,
      dateLessThan: new Date(
        Date.now() +
          (options.ttlSeconds ?? runtimeConfig.signedUrlTtlSeconds) * 1000,
      ).toISOString(),
    });
  }

  async readSignedLocalPhotoToken(token: string): Promise<LocalSignedPhoto> {
    const { objectKey, expiresAt } = this.verifyLocalMediaToken(token);
    try {
      const buffer = await readFile(this.toLocalPath(objectKey));
      return {
        buffer,
        contentType: 'image/webp',
        maxAgeSeconds: Math.max(0, expiresAt - Math.floor(Date.now() / 1000)),
      };
    } catch {
      throw new NotFoundException('Media not found');
    }
  }

  newEntryId(): string {
    return ulid();
  }

  private async processPhoto(buffer: Buffer): Promise<{
    buffer: Buffer;
    width: number | null;
    height: number | null;
  }> {
    try {
      const pipeline = sharp(buffer, { failOn: 'none' })
        .rotate()
        .resize({
          width: SKIN_JOURNAL_PHOTO_MAX_DIMENSION,
          height: SKIN_JOURNAL_PHOTO_MAX_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: SKIN_JOURNAL_PHOTO_WEBP_QUALITY });
      const processed = await pipeline.toBuffer({ resolveWithObject: true });
      return {
        buffer: processed.data,
        width: processed.info.width ?? null,
        height: processed.info.height ?? null,
      };
    } catch {
      throw new BadRequestException('Photo could not be processed');
    }
  }

  private toLocalPath(objectKey: string): string {
    assertSafeObjectKey(objectKey);
    const root = resolve(process.cwd(), SKIN_JOURNAL_LOCAL_DIR);
    const path = resolve(root, objectKey);
    if (path !== root && path.startsWith(`${root}${sep}`)) {
      return path;
    }
    throw new BadRequestException('Unsafe media object key');
  }

  private getRuntimeConfig(): MediaRuntimeConfig | null {
    const bucketName = this.config
      .getOrThrow<string>('SKIN_JOURNAL_MEDIA_BUCKET')
      .trim();
    const cloudFrontBaseUrl = this.config
      .getOrThrow<string>('SKIN_JOURNAL_MEDIA_CLOUDFRONT_URL')
      .trim();
    const cloudFrontKeyPairId = this.config
      .getOrThrow<string>('SKIN_JOURNAL_MEDIA_CLOUDFRONT_KEY_PAIR_ID')
      .trim();
    const cloudFrontPrivateKey = this.config
      .getOrThrow<string>('SKIN_JOURNAL_MEDIA_CLOUDFRONT_PRIVATE_KEY')
      .replace(/\\n/g, '\n')
      .trim();

    if (
      !bucketName ||
      !cloudFrontBaseUrl ||
      !cloudFrontKeyPairId ||
      !cloudFrontPrivateKey
    ) {
      if (this.config.getOrThrow<string>('NODE_ENV') === 'production') {
        throw new InternalServerErrorException(
          'Skin Journal media storage is not configured',
        );
      }
      return null;
    }

    return {
      bucketName,
      cloudFrontBaseUrl,
      signedUrlTtlSeconds: SKIN_JOURNAL_MEDIA_SIGNED_URL_TTL_SECONDS,
      cloudFrontKeyPairId,
      cloudFrontPrivateKey,
      kmsKeyId:
        this.config.getOrThrow<string>('SKIN_JOURNAL_S3_KMS_KEY_ID').trim() ||
        this.config.getOrThrow<string>('PRODUCT_MEDIA_S3_KMS_KEY_ID').trim() ||
        null,
    };
  }

  private verifyLocalMediaToken(token: string): {
    objectKey: string;
    expiresAt: number;
  } {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra !== undefined) {
      throw new NotFoundException('Media not found');
    }
    const expected = this.signLocalMediaPayload(payload);
    if (!safeEqual(signature, expected)) {
      throw new NotFoundException('Media not found');
    }

    const decoded = parseLocalMediaPayload(payload);
    if (decoded.expiresAt < Math.floor(Date.now() / 1000)) {
      throw new NotFoundException('Media not found');
    }
    assertSafeObjectKey(decoded.objectKey);
    return decoded;
  }

  private signLocalMediaPayload(payload: string): string {
    return createHmac('sha256', this.localMediaSigningSecret())
      .update(payload)
      .digest('base64url');
  }

  private localMediaSigningSecret(): string {
    return (
      this.config
        .getOrThrow<string>('SKIN_PROFILE_FIELD_ENCRYPTION_KEY')
        .trim() ||
      this.config.getOrThrow<string>('JWT_SECRET').trim() ||
      DEV_LOCAL_MEDIA_SIGNING_SECRET
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

function normalizeMimeType(contentType: string): string {
  return contentType.split(';')[0]?.trim().toLowerCase() ?? '';
}

function safeObjectPart(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new BadRequestException('Unsafe media object key segment');
  }
  return value;
}

function assertSafeObjectKey(objectKey: string): void {
  const parts = objectKey.split('/');
  if (
    parts.length !== 4 ||
    parts[0] !== 'skin-journal' ||
    !parts[3].endsWith('.webp') ||
    parts.some((part) => !part || part === '.' || part === '..') ||
    parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part))
  ) {
    throw new BadRequestException('Unsafe media object key');
  }
}

function safeEqual(value: string, expected: string): boolean {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return (
    valueBuffer.length === expectedBuffer.length &&
    timingSafeEqual(valueBuffer, expectedBuffer)
  );
}

function parseLocalMediaPayload(payload: string): {
  objectKey: string;
  expiresAt: number;
} {
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      typeof (parsed as Record<string, unknown>).key === 'string' &&
      Number.isInteger((parsed as Record<string, unknown>).exp)
    ) {
      return {
        objectKey: (parsed as Record<string, string>).key,
        expiresAt: (parsed as Record<string, number>).exp,
      };
    }
  } catch {
    throw new NotFoundException('Media not found');
  }
  throw new NotFoundException('Media not found');
}

function isTransformToByteArrayBody(
  body: unknown,
): body is TransformToByteArrayBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    'transformToByteArray' in body &&
    typeof body.transformToByteArray === 'function'
  );
}

function isNotFoundStorageError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const metadata = (error as { $metadata?: { httpStatusCode?: number } })
    .$metadata;
  return (
    metadata?.httpStatusCode === 404 ||
    error.name === 'NotFound' ||
    error.name === 'NoSuchKey'
  );
}

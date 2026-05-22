import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as getSignedCloudFrontUrl } from '@aws-sdk/cloudfront-signer';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { SkinJournalPhotoStorageService } from './skin-journal-photo-storage.service';

jest.mock('@aws-sdk/cloudfront-signer', () => ({
  getSignedUrl: jest.fn(() => 'https://signed.example.com/skin.webp'),
}));

function config(values: Record<string, string | number | boolean> = {}) {
  const configValues: Record<string, string | number | boolean> = {
    AWS_REGION: 'eu-north-1',
    NODE_ENV: 'test',
    SKIN_JOURNAL_MEDIA_BUCKET: '',
    SKIN_JOURNAL_MEDIA_CLOUDFRONT_URL: '',
    SKIN_JOURNAL_MEDIA_CLOUDFRONT_KEY_PAIR_ID: '',
    SKIN_JOURNAL_MEDIA_CLOUDFRONT_PRIVATE_KEY: '',
    SKIN_JOURNAL_S3_KMS_KEY_ID: '',
    PRODUCT_MEDIA_S3_KMS_KEY_ID: '',
    SKIN_PROFILE_FIELD_ENCRYPTION_KEY: '',
    JWT_SECRET: 'test-jwt-secret',
    ...values,
  };

  return {
    get: jest.fn((key: string) => configValues[key]),
    getOrThrow: jest.fn((key: string) => {
      if (key in configValues) {
        return configValues[key];
      }
      throw new Error(`Missing config ${key}`);
    }),
  } as unknown as ConfigService;
}

async function imageBuffer(): Promise<Buffer> {
  return sharp({
    create: {
      width: 320,
      height: 240,
      channels: 3,
      background: '#efd8c8',
    },
  })
    .jpeg()
    .toBuffer();
}

describe('SkinJournalPhotoStorageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects unsupported mime types before processing', async () => {
    const service = new SkinJournalPhotoStorageService(config());

    await expect(
      service.storePhoto({
        userId: 'user-1',
        entryId: 'entry-1',
        buffer: Buffer.from('not-image'),
        contentType: 'text/plain',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('processes images to webp, strips metadata, and records dimensions', async () => {
    const service = new SkinJournalPhotoStorageService(config());

    const stored = await service.storePhoto({
      userId: 'user-1',
      entryId: 'entry-1',
      buffer: await imageBuffer(),
      contentType: 'image/jpeg',
    });

    expect(stored.object_key).toMatch(/^skin-journal\/user-1\/entry-1\//);
    expect(stored.content_type).toBe('image/webp');
    expect(stored.width).toBe(320);
    expect(stored.height).toBe(240);
    expect(stored.exif_stripped).toBe(true);
    const signedUrl = service.getSignedUrl(stored.object_key);
    expect(signedUrl).toContain('/api/v1/skin-journal/media/');
    expect(signedUrl).not.toContain('/static/skin-journal/');

    const token = signedUrl?.split('/').at(-1) ?? '';
    const media = await service.readSignedLocalPhotoToken(token);
    expect(media.contentType).toBe('image/webp');
    expect(media.buffer.length).toBeGreaterThan(0);
    expect(media.maxAgeSeconds).toBeGreaterThan(0);
    await service.deletePhoto(stored.object_key);
  });

  it('rejects tampered local media tokens', async () => {
    const service = new SkinJournalPhotoStorageService(config());
    const stored = await service.storePhoto({
      userId: 'user-1',
      entryId: 'entry-1',
      buffer: await imageBuffer(),
      contentType: 'image/jpeg',
    });

    const token = service.getSignedUrl(stored.object_key)?.split('/').at(-1);

    await expect(
      service.readSignedLocalPhotoToken(`${token ?? ''}x`),
    ).rejects.toBeInstanceOf(NotFoundException);
    await service.deletePhoto(stored.object_key);
  });

  it('uses S3 and CloudFront signing when media storage is configured', async () => {
    const service = new SkinJournalPhotoStorageService(
      config({
        AWS_REGION: 'eu-west-1',
        SKIN_JOURNAL_MEDIA_BUCKET: 'ritora-skin-media',
        SKIN_JOURNAL_MEDIA_CLOUDFRONT_URL:
          'https://d111111abcdef8.cloudfront.net',
        SKIN_JOURNAL_MEDIA_CLOUDFRONT_KEY_PAIR_ID: 'K123',
        SKIN_JOURNAL_MEDIA_CLOUDFRONT_PRIVATE_KEY:
          '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
      }),
    );
    const send = jest.fn().mockResolvedValue({});
    (service as unknown as { s3Client: { send: jest.Mock } }).s3Client = {
      send,
    };

    const stored = await service.storePhoto({
      userId: 'user-1',
      entryId: 'entry-1',
      buffer: await imageBuffer(),
      contentType: 'image/jpeg',
    });

    expect(send.mock.calls[0][0]).toBeInstanceOf(PutObjectCommand);
    expect(send.mock.calls[0][0].input).toEqual(
      expect.objectContaining({
        Bucket: 'ritora-skin-media',
        Key: stored.object_key,
        ContentType: 'image/webp',
        ServerSideEncryption: 'aws:kms',
      }),
    );
    expect(service.getSignedUrl(stored.object_key)).toBe(
      'https://signed.example.com/skin.webp',
    );
    expect(getSignedCloudFrontUrl).toHaveBeenCalled();

    await service.deletePhoto(stored.object_key);
    expect(send.mock.calls[1][0]).toBeInstanceOf(DeleteObjectCommand);
  });

  it('rejects malformed CloudFront signing keys before uploading to S3', async () => {
    const service = new SkinJournalPhotoStorageService(
      config({
        AWS_REGION: 'eu-west-1',
        SKIN_JOURNAL_MEDIA_BUCKET: 'ritora-skin-media',
        SKIN_JOURNAL_MEDIA_CLOUDFRONT_URL:
          'https://d111111abcdef8.cloudfront.net',
        SKIN_JOURNAL_MEDIA_CLOUDFRONT_KEY_PAIR_ID: 'K123',
        SKIN_JOURNAL_MEDIA_CLOUDFRONT_PRIVATE_KEY: 'not-a-private-key',
      }),
    );
    const send = jest.fn().mockResolvedValue({});
    (service as unknown as { s3Client: { send: jest.Mock } }).s3Client = {
      send,
    };

    await expect(
      service.storePhoto({
        userId: 'user-1',
        entryId: 'entry-1',
        buffer: await imageBuffer(),
        contentType: 'image/jpeg',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(send).not.toHaveBeenCalled();
  });

  it('does not fall back to local media storage in production', async () => {
    const service = new SkinJournalPhotoStorageService(
      config({
        NODE_ENV: 'production',
      }),
    );

    await expect(
      service.storePhoto({
        userId: 'user-1',
        entryId: 'entry-1',
        buffer: await imageBuffer(),
        contentType: 'image/jpeg',
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('does not sign unsafe object keys', () => {
    const service = new SkinJournalPhotoStorageService(
      config({
        AWS_REGION: 'eu-west-1',
        SKIN_JOURNAL_MEDIA_BUCKET: 'ritora-skin-media',
        SKIN_JOURNAL_MEDIA_CLOUDFRONT_URL:
          'https://d111111abcdef8.cloudfront.net',
        SKIN_JOURNAL_MEDIA_CLOUDFRONT_KEY_PAIR_ID: 'K123',
        SKIN_JOURNAL_MEDIA_CLOUDFRONT_PRIVATE_KEY:
          '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
      }),
    );

    expect(() =>
      service.getSignedUrl('https://evil.example.com/photo.webp'),
    ).toThrow(BadRequestException);
  });

  it('rejects malformed skin journal object keys before storage access', async () => {
    const service = new SkinJournalPhotoStorageService(config());

    await expect(
      service.readPhotoBuffer('skin-journal/user-1/entry-1/photo.webp/extra'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.deletePhoto('skin-journal/user-1/entry-1/photo.png'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

import { getSignedUrl as getSignedCloudFrontUrl } from '@aws-sdk/cloudfront-signer';
import { ConfigService } from '@nestjs/config';
import { CataloguePhotoStorageService } from './catalogue-photo-storage.service';
import type { UploadedCatalogueImage } from './catalogue-photo.types';

jest.mock('@aws-sdk/cloudfront-signer', () => ({
  getSignedUrl: jest.fn(() => 'https://signed.example.com/product-image.webp'),
}));

function createConfigService(
  overrides: Record<string, number | string> = {},
): ConfigService {
  const configValues: Record<string, number | string> = {
    AWS_REGION: 'eu-north-1',
    PRODUCT_MEDIA_BUCKET: '',
    PRODUCT_MEDIA_CLOUDFRONT_URL: '',
    PRODUCT_MEDIA_CLOUDFRONT_KEY_PAIR_ID: '',
    PRODUCT_MEDIA_CLOUDFRONT_PRIVATE_KEY: '',
    PRODUCT_MEDIA_S3_KMS_KEY_ID: '',
    ...overrides,
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

describe('CataloguePhotoStorageService', () => {
  const image: UploadedCatalogueImage = {
    originalname: 'hero.webp',
    mimetype: 'image/webp',
    buffer: Buffer.from('processed-image'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('writes processed hero images to the configured bucket and returns a signed url', async () => {
    const service = new CataloguePhotoStorageService(
      createConfigService({
        AWS_REGION: 'eu-west-1',
        PRODUCT_MEDIA_BUCKET: 'ritora-dev-product-media',
        PRODUCT_MEDIA_CLOUDFRONT_URL: 'https://d111111abcdef8.cloudfront.net',
        PRODUCT_MEDIA_CLOUDFRONT_KEY_PAIR_ID: 'K123',
        PRODUCT_MEDIA_CLOUDFRONT_PRIVATE_KEY:
          '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
      }),
    );
    const send = jest.fn().mockResolvedValue({});
    (service as unknown as { s3Client: { send: jest.Mock } }).s3Client = {
      send,
    };

    const result = await service.saveHeroImage(image);

    expect(send.mock.calls[0][0].input).toEqual(
      expect.objectContaining({
        Bucket: 'ritora-dev-product-media',
        ContentType: 'image/webp',
        ServerSideEncryption: 'aws:kms',
      }),
    );
    expect(getSignedCloudFrontUrl).toHaveBeenCalled();
    expect(result).toBe('https://signed.example.com/product-image.webp');
  });

  it('can clean up a pending hero image upload when extraction fails', async () => {
    const service = new CataloguePhotoStorageService(
      createConfigService({
        AWS_REGION: 'eu-west-1',
        PRODUCT_MEDIA_BUCKET: 'ritora-dev-product-media',
        PRODUCT_MEDIA_CLOUDFRONT_URL: 'https://d111111abcdef8.cloudfront.net',
        PRODUCT_MEDIA_CLOUDFRONT_KEY_PAIR_ID: 'K123',
        PRODUCT_MEDIA_CLOUDFRONT_PRIVATE_KEY:
          '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
      }),
    );
    const send = jest.fn().mockResolvedValue({});
    (service as unknown as { s3Client: { send: jest.Mock } }).s3Client = {
      send,
    };

    const upload = service.startHeroImageUpload(image);
    await upload.cleanup();

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].input).toEqual(
      expect.objectContaining({
        Bucket: 'ritora-dev-product-media',
        Key: expect.stringContaining('product-images/processed/'),
      }),
    );
  });

  it('rejects malformed signing keys before uploading to S3', async () => {
    const service = new CataloguePhotoStorageService(
      createConfigService({
        AWS_REGION: 'eu-west-1',
        PRODUCT_MEDIA_BUCKET: 'ritora-dev-product-media',
        PRODUCT_MEDIA_CLOUDFRONT_URL: 'https://d111111abcdef8.cloudfront.net',
        PRODUCT_MEDIA_CLOUDFRONT_KEY_PAIR_ID: 'K123',
        PRODUCT_MEDIA_CLOUDFRONT_PRIVATE_KEY:
          '-----BEGIN PRIVATE KEY-----\\nabc',
      }),
    );
    const send = jest.fn().mockResolvedValue({});
    (service as unknown as { s3Client: { send: jest.Mock } }).s3Client = {
      send,
    };

    await expect(service.saveHeroImage(image)).rejects.toMatchObject({
      response: expect.objectContaining({
        message: 'Product image signing is not configured correctly',
      }),
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('canonicalizes managed media urls before persistence and re-signs them on reads', () => {
    const service = new CataloguePhotoStorageService(
      createConfigService({
        PRODUCT_MEDIA_BUCKET: 'ritora-dev-product-media',
        PRODUCT_MEDIA_CLOUDFRONT_URL: 'https://d111111abcdef8.cloudfront.net',
        PRODUCT_MEDIA_CLOUDFRONT_KEY_PAIR_ID: 'K123',
        PRODUCT_MEDIA_CLOUDFRONT_PRIVATE_KEY:
          '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
      }),
    );
    const signedInput =
      'https://d111111abcdef8.cloudfront.net/product-images/processed/test.webp?Policy=abc&Signature=123&Key-Pair-Id=K123';

    expect(service.toPersistentImageUrls([signedInput])).toEqual([
      'https://d111111abcdef8.cloudfront.net/product-images/processed/test.webp',
    ]);
    expect(
      service.resolvePublicImageUrls([
        'https://d111111abcdef8.cloudfront.net/product-images/processed/test.webp',
      ]),
    ).toEqual(['https://signed.example.com/product-image.webp']);
  });

  it('falls back to canonical managed media urls when read-time signing fails', () => {
    const service = new CataloguePhotoStorageService(
      createConfigService({
        PRODUCT_MEDIA_BUCKET: 'ritora-dev-product-media',
        PRODUCT_MEDIA_CLOUDFRONT_URL: 'https://d111111abcdef8.cloudfront.net',
        PRODUCT_MEDIA_CLOUDFRONT_KEY_PAIR_ID: 'K123',
        PRODUCT_MEDIA_CLOUDFRONT_PRIVATE_KEY:
          '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
      }),
    );
    jest.mocked(getSignedCloudFrontUrl).mockImplementationOnce(() => {
      throw new Error('Signing failed');
    });

    expect(
      service.resolvePublicImageUrls([
        'https://d111111abcdef8.cloudfront.net/product-images/processed/test.webp',
      ]),
    ).toEqual([
      'https://d111111abcdef8.cloudfront.net/product-images/processed/test.webp',
    ]);
  });

  it('returns null when managed media storage is not configured', async () => {
    const service = new CataloguePhotoStorageService(createConfigService());

    const result = await service.saveHeroImage(image);

    expect(result).toBeNull();
  });
});

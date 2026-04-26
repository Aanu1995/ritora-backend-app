import { BadRequestException } from '@nestjs/common';
import type { UploadedCatalogueImage } from './catalogue-photo.types';
import { CatalogueController } from './catalogue.controller';
import { CatalogueService } from './catalogue.service';

const mockCatalogueService = () => ({
  extractFromImages: jest.fn(),
});

describe('CatalogueController', () => {
  let controller: CatalogueController;
  let catalogueService: ReturnType<typeof mockCatalogueService>;

  beforeEach(() => {
    catalogueService = mockCatalogueService();
    controller = new CatalogueController(
      catalogueService as unknown as CatalogueService,
    );
  });

  it('forwards uploaded images with the parsed hero image index', async () => {
    const files = [
      {
        originalname: 'front.jpg',
        mimetype: 'image/jpeg',
        size: 10,
        buffer: Buffer.from('front'),
      },
      {
        originalname: 'back.jpg',
        mimetype: 'image/jpeg',
        size: 9,
        buffer: Buffer.from('back'),
      },
    ] as UploadedCatalogueImage[];
    const response = { source: 'photo' };
    catalogueService.extractFromImages.mockResolvedValue(response);

    await expect(controller.extractFromImages(files, '1')).resolves.toBe(
      response,
    );
    expect(catalogueService.extractFromImages).toHaveBeenCalledWith(files, 1);
  });

  it('defaults missing files to an empty image list', async () => {
    catalogueService.extractFromImages.mockResolvedValue(null);

    await expect(
      controller.extractFromImages(undefined as never, '0'),
    ).resolves.toBeNull();

    expect(catalogueService.extractFromImages).toHaveBeenCalledWith([], 0);
  });

  it('rejects invalid hero image indexes before calling the service', async () => {
    await expect(controller.extractFromImages([], undefined)).rejects.toThrow(
      BadRequestException,
    );

    expect(catalogueService.extractFromImages).not.toHaveBeenCalled();
  });
});

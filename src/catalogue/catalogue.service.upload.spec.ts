import {
  createCatalogueServiceTestHarness,
  createUploadedImage,
} from './catalogue.service.spec-utils';

describe('CatalogueService photo upload behavior', () => {
  it('cleans up the parallel hero upload when photo extraction fails', async () => {
    const {
      service,
      openAiExtractorProvider,
      cataloguePhotoStorageService,
      officialPageProvider,
    } = createCatalogueServiceTestHarness();
    const cleanup = jest.fn().mockResolvedValue(undefined);

    openAiExtractorProvider.extractFromImages.mockResolvedValue(null);
    cataloguePhotoStorageService.startHeroImageUpload.mockReturnValue({
      url: Promise.resolve(
        'https://signed.example.com/product-images/processed/front-photo.webp',
      ),
      cleanup,
    });

    const result = await service.extractFromImages(
      [createUploadedImage('heroImage'), createUploadedImage('labelImage')],
      0,
    );

    expect(result).toBeNull();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(officialPageProvider.extract).not.toHaveBeenCalled();
  });
});

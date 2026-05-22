import {
  createCatalogueServiceTestHarness,
  createUploadedImage,
} from './catalogue.service.spec-utils';

describe('CatalogueService photo upload behavior', () => {
  it('does not upload a draft hero image when photo extraction fails', async () => {
    const {
      service,
      openAiExtractorProvider,
      cataloguePhotoStorageService,
      officialPageProvider,
    } = createCatalogueServiceTestHarness();

    openAiExtractorProvider.extractFromImages.mockResolvedValue(null);

    const result = await service.extractFromImages(
      [createUploadedImage('heroImage'), createUploadedImage('labelImage')],
      0,
    );

    expect(result).toBeNull();
    expect(
      cataloguePhotoStorageService.startHeroImageUpload,
    ).not.toHaveBeenCalled();
    expect(officialPageProvider.extract).not.toHaveBeenCalled();
  });
});

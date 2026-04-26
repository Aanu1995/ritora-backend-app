import { CataloguePhotoProcessorService } from './catalogue-photo-processor.service';
import { CataloguePhotoStorageService } from './catalogue-photo-storage.service';
import type { UploadedCatalogueImage } from './catalogue-photo.types';
import { CatalogueService } from './catalogue.service';
import { CatalogueSourceRuleService } from './catalogue-source-rule.service';
import { OfficialPageProvider } from './official-page.provider';
import { OpenAiExtractorProvider } from './openai-extractor.provider';

export function createUploadedImage(name: string): UploadedCatalogueImage {
  return {
    originalname: `${name}.jpg`,
    mimetype: 'image/jpeg',
    size: name.length,
    buffer: Buffer.from(name),
  };
}

export function createCatalogueServiceTestHarness() {
  const officialPageProvider = {
    extract: jest.fn(),
  };
  const openAiExtractorProvider = {
    extract: jest.fn(),
    extractFromImages: jest.fn(),
    completeMissingFields: jest.fn(),
  };
  const cataloguePhotoProcessorService = {
    prepareForExtraction: jest.fn(),
  };
  const catalogueSourceRuleService = {
    evaluateUrl: jest.fn(),
  };
  const cataloguePhotoStorageService = {
    saveHeroImage: jest.fn(),
    startHeroImageUpload: jest.fn(),
  };

  catalogueSourceRuleService.evaluateUrl.mockResolvedValue({
    blocked: false,
    scoreAdjustment: 0,
    matchedLabels: [],
  });
  cataloguePhotoProcessorService.prepareForExtraction.mockImplementation(
    async (images: UploadedCatalogueImage[], heroImageIndex: number) => ({
      extractionInput: {
        images: images.map((image) => ({
          buffer: image.buffer,
          mimetype: image.mimetype,
        })),
        heroImageIndex,
      },
      heroStorageImage: {
        ...images[heroImageIndex],
        width: 600,
        height: 600,
      },
    }),
  );
  cataloguePhotoStorageService.saveHeroImage.mockResolvedValue(
    'https://signed.example.com/product-images/processed/front-photo.webp',
  );
  cataloguePhotoStorageService.startHeroImageUpload.mockReturnValue({
    url: Promise.resolve(
      'https://signed.example.com/product-images/processed/front-photo.webp',
    ),
    cleanup: jest.fn().mockResolvedValue(undefined),
  });
  openAiExtractorProvider.completeMissingFields.mockResolvedValue(null);

  return {
    service: new CatalogueService(
      officialPageProvider as unknown as OfficialPageProvider,
      openAiExtractorProvider as unknown as OpenAiExtractorProvider,
      catalogueSourceRuleService as unknown as CatalogueSourceRuleService,
      cataloguePhotoProcessorService as unknown as CataloguePhotoProcessorService,
      cataloguePhotoStorageService as unknown as CataloguePhotoStorageService,
    ),
    officialPageProvider,
    openAiExtractorProvider,
    cataloguePhotoProcessorService,
    catalogueSourceRuleService,
    cataloguePhotoStorageService,
  };
}

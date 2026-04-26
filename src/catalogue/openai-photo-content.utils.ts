import type { CataloguePhotoExtractionInput } from './catalogue-photo.types';
import { describePhotoVariant } from './openai-product-prompts';

export function toPhotoImageContent(input: CataloguePhotoExtractionInput) {
  return input.images.flatMap((image, index) => {
    const imageNumber = index + 1;
    const sourceIndex = image.sourceIndex ?? index;
    const sourceNumber = sourceIndex + 1;
    const isHero =
      image.isHero ??
      (image.sourceIndex !== undefined
        ? image.sourceIndex === input.heroImageIndex
        : index === input.heroImageIndex);
    const dimensions =
      image.width && image.height ? ` ${image.width}x${image.height}` : '';
    const imageLabel = [
      `Image ${imageNumber} is a ${describePhotoVariant(image.variant)}${dimensions} derived from source photo ${sourceNumber}.`,
      isHero
        ? 'That source photo is the selected product photo to save with the item.'
        : 'That source photo is an additional label photo of the same product and may overlap with other label photos.',
      image.variant === 'text-enhanced'
        ? 'Use this variant especially for small, low-contrast, blurred, or curved label text.'
        : 'Use this variant for overall packaging layout, brand, product name, size, and context.',
    ].join(' ');

    return [
      {
        type: 'input_text' as const,
        text: imageLabel,
      },
      {
        type: 'input_image' as const,
        image_url: toDataUrl(image.buffer, image.mimetype),
        detail: 'high' as const,
      },
    ];
  });
}

function toDataUrl(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

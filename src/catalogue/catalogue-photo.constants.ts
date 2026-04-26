export const CATALOGUE_PHOTO_UPLOAD_FIELD = 'images';
export const CATALOGUE_PHOTO_MIN_IMAGES = 2;
export const CATALOGUE_PHOTO_MAX_IMAGES = 6;
export const CATALOGUE_PHOTO_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export const SUPPORTED_CATALOGUE_PHOTO_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

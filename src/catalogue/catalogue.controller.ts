import {
  Body,
  Controller,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  CATALOGUE_PHOTO_MAX_FILE_SIZE_BYTES,
  CATALOGUE_PHOTO_MAX_IMAGES,
  CATALOGUE_PHOTO_MIN_IMAGES,
  CATALOGUE_PHOTO_UPLOAD_FIELD,
} from './catalogue-photo.constants';
import type { UploadedCatalogueImage } from './catalogue-photo.types';
import { parseHeroImageIndex } from './catalogue-photo.utils';
import { CatalogueService } from './catalogue.service';
import { ResolvedLookupResponseDto } from './dto/resolved-lookup-response.dto';
import {
  RequireUnrestrictedUserCapabilities,
  UserRestrictionGuard,
} from '../users/user-restriction.guard';
import { UserRestrictionCapability } from '../users/user-restrictions';

const catalogueThrottle = {
  default: {
    ttl: 60000,
    limit: process.env.NODE_ENV === 'test' ? 100 : 30,
  },
};

@ApiTags('catalogue')
@Controller('catalogue/products')
export class CatalogueController {
  constructor(private readonly catalogueService: CatalogueService) {}

  @Post('extract-from-images')
  @Throttle(catalogueThrottle)
  @RequireUnrestrictedUserCapabilities(
    UserRestrictionCapability.DisableImageUpload,
    UserRestrictionCapability.DisableProductExtraction,
    UserRestrictionCapability.DisableAiGeneration,
  )
  @UseGuards(UserRestrictionGuard)
  @UseInterceptors(
    FilesInterceptor(CATALOGUE_PHOTO_UPLOAD_FIELD, CATALOGUE_PHOTO_MAX_IMAGES, {
      limits: {
        fileSize: CATALOGUE_PHOTO_MAX_FILE_SIZE_BYTES,
        files: CATALOGUE_PHOTO_MAX_IMAGES,
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['images', 'heroImageIndex'],
      properties: {
        heroImageIndex: {
          type: 'integer',
          minimum: 0,
        },
        images: {
          type: 'array',
          minItems: CATALOGUE_PHOTO_MIN_IMAGES,
          maxItems: CATALOGUE_PHOTO_MAX_IMAGES,
          items: {
            type: 'string',
            format: 'binary',
          },
        },
      },
    },
  })
  async extractFromImages(
    @UploadedFiles() files: UploadedCatalogueImage[],
    @Body('heroImageIndex') heroImageIndexValue: string | undefined,
  ): Promise<ResolvedLookupResponseDto | null> {
    const heroImageIndex = parseHeroImageIndex(heroImageIndexValue);

    return this.catalogueService.extractFromImages(files ?? [], heroImageIndex);
  }
}
